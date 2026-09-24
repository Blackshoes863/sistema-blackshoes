-- Productos paginados desde PostgreSQL.
-- Evita descargar todo el catalogo interno al abrir el sistema.

create or replace function public.list_products_page(
  p_query text default '',
  p_sort text default 'recent',
  p_category text default 'all',
  p_subcategory text default 'all',
  p_stock text default 'all',
  p_published text default 'all',
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 30), 1), 100);
  v_offset integer;
  v_query text := lower(trim(coalesce(p_query, '')));
  v_sort text := coalesce(nullif(trim(coalesce(p_sort, '')), ''), 'recent');
  v_category text := coalesce(nullif(trim(coalesce(p_category, '')), ''), 'all');
  v_subcategory text := coalesce(nullif(trim(coalesce(p_subcategory, '')), ''), 'all');
  v_stock text := coalesce(nullif(trim(coalesce(p_stock, '')), ''), 'all');
  v_published text := coalesce(nullif(trim(coalesce(p_published, '')), ''), 'all');
  v_rows jsonb;
  v_total_count integer;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with product_rows as (
    select
      p.*,
      coalesce(c.name, '') as category_name,
      coalesce(s.name, '') as subcategory_name,
      coalesce((
        select sum(pv.current_stock)
        from public.product_variants pv
        where pv.product_id = p.id
          and pv.active = true
          and pv.archived_at is null
      ), 0) as stock_total,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pv.id,
            'size', pv.size,
            'current_stock', pv.current_stock,
            'active', pv.active,
            'sort_order', pv.sort_order,
            'archived_at', pv.archived_at
          )
          order by pv.sort_order asc, pv.size asc
        )
        from public.product_variants pv
        where pv.product_id = p.id
          and pv.active = true
          and pv.archived_at is null
      ), '[]'::jsonb) as product_variants,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pi.id,
            'storage_path', pi.storage_path,
            'public_url', pi.public_url,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary,
            'sort_order', pi.sort_order,
            'archived_at', pi.archived_at
          )
          order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
        )
        from public.product_images pi
        where pi.product_id = p.id
          and pi.archived_at is null
      ), '[]'::jsonb) as product_images
    from public.products p
    left join public.product_categories c on c.id = p.category_id
    left join public.product_subcategories s on s.id = p.subcategory_id
    where p.archived_at is null
      and coalesce(p.sku, '') <> 'MANUAL_INTERNAL'
  ),
  filtered as (
    select *
    from product_rows pr
    where (v_category = 'all' or pr.category_name = v_category)
      and (v_subcategory = 'all' or pr.subcategory_name = v_subcategory)
      and (
        v_stock = 'all'
        or (v_stock = 'tracked' and pr.tracks_stock = true)
        or (v_stock = 'untracked' and pr.tracks_stock = false)
      )
      and (
        v_published = 'all'
        or (v_published = 'published' and pr.published = true)
        or (v_published = 'unpublished' and pr.published = false)
      )
      and (
        v_query = ''
        or lower(coalesce(pr.sku, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.name, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.color, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.category_name, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.subcategory_name, '')) like '%' || v_query || '%'
      )
  ),
  counted as (
    select count(*)::integer as total_count
    from filtered
  ),
  ordered as (
    select
      f.*,
      row_number() over (
        order by
          case when v_sort = 'recent' then f.updated_at end desc nulls last,
          case when v_sort = 'recent' then f.created_at end desc nulls last,
          case when v_sort = 'alphaDesc' then f.sku end desc nulls last,
          case when v_sort = 'alphaDesc' then f.name end desc nulls last,
          case when v_sort not in ('recent', 'alphaDesc') then f.sku end asc nulls last,
          case when v_sort not in ('recent', 'alphaDesc') then f.name end asc nulls last,
          f.id asc
      ) as position
    from filtered f
  ),
  page_rows as (
    select
      f.position,
      jsonb_build_object(
        'id', f.id,
        'sku', f.sku,
        'slug', f.slug,
        'name', f.name,
        'color', f.color,
        'description', f.description,
        'cost', f.cost,
        'margin_percent', f.margin_percent,
        'price', f.price,
        'promo_price', f.promo_price,
        'wholesale_price', f.wholesale_price,
        'tracks_stock', f.tracks_stock,
        'published', f.published,
        'created_at', f.created_at,
        'updated_at', f.updated_at,
        'product_categories', jsonb_build_object('name', f.category_name),
        'product_subcategories', jsonb_build_object('name', f.subcategory_name),
        'product_variants', f.product_variants,
        'product_images', f.product_images
      ) as row_data
    from ordered f
    where f.position > v_offset
      and f.position <= v_offset + v_page_size
  )
  select
    coalesce((select total_count from counted), 0),
    coalesce(jsonb_agg(page_rows.row_data order by page_rows.position), '[]'::jsonb)
  into v_total_count, v_rows
  from page_rows;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totalCount', coalesce(v_total_count, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.list_products_page(text, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.list_products_page(text, text, text, text, text, text, integer, integer) to authenticated;
