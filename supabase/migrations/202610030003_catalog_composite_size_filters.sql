-- Permite talles compuestos en catalogo: M/L aparece al filtrar M o L; 40/41 aparece en 40 o 41.

create or replace function public.list_public_catalog_products(
  p_query text default '',
  p_category text default 'all',
  p_subcategory text default 'all',
  p_color text default 'all',
  p_size text default 'all',
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_sort text default 'new',
  p_page integer default 1,
  p_page_size integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 24), 1), 60);
  v_offset integer;
  v_query text := lower(trim(coalesce(p_query, '')));
  v_category text := coalesce(nullif(trim(coalesce(p_category, '')), ''), 'all');
  v_subcategory text := coalesce(nullif(trim(coalesce(p_subcategory, '')), ''), 'all');
  v_color text := coalesce(nullif(trim(coalesce(p_color, '')), ''), 'all');
  v_size text := upper(coalesce(nullif(trim(coalesce(p_size, '')), ''), 'all'));
  v_sort text := coalesce(nullif(trim(coalesce(p_sort, '')), ''), 'new');
  v_rows jsonb;
  v_filters jsonb;
  v_total_count integer;
begin
  v_offset := (v_page - 1) * v_page_size;

  with public_rows as (
    select
      cp.*,
      case
        when coalesce(cp.promo_price, 0) > 0 and cp.promo_price < cp.price then cp.promo_price
        else cp.price
      end as effective_price
    from public.catalog_products cp
    where cp.published = true
  ),
  filtered as (
    select *
    from public_rows pr
    where (v_category = 'all' or pr.category = v_category)
      and (v_subcategory = 'all' or pr.subcategory = v_subcategory)
      and (v_color = 'all' or pr.color = v_color)
      and (p_min_price is null or pr.effective_price >= p_min_price)
      and (p_max_price is null or pr.effective_price <= p_max_price)
      and (
        v_size = 'ALL'
        or exists (
          select 1
          from jsonb_array_elements(pr.variants) variant
          cross join lateral regexp_split_to_table(upper(coalesce(variant->>'size', '')), '\s*/\s*') as size_parts(size_token)
          where size_parts.size_token = v_size
            and coalesce((variant->>'available')::boolean, true) = true
        )
      )
      and (
        v_query = ''
        or lower(coalesce(pr.code, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.name, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.description, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.category, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.subcategory, '')) like '%' || v_query || '%'
        or lower(coalesce(pr.color, '')) like '%' || v_query || '%'
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
          case when v_sort = 'priceAsc' then f.effective_price end asc nulls last,
          case when v_sort = 'priceDesc' then f.effective_price end desc nulls last,
          case when v_sort not in ('priceAsc', 'priceDesc') then f.created_at end desc nulls last,
          f.name asc nulls last,
          f.id asc
      ) as position
    from filtered f
  ),
  page_rows as (
    select
      o.position,
      to_jsonb(o) - 'effective_price' - 'position' as row_data
    from ordered o
    where o.position > v_offset
      and o.position <= v_offset + v_page_size
  ),
  all_filter_rows as (
    select *
    from public_rows
  ),
  size_filter_rows as (
    select *
    from all_filter_rows afr
    where v_category = 'all'
      or afr.category = v_category
  ),
  sizes as (
    select distinct size_parts.size_token as size
    from size_filter_rows sfr
    cross join lateral jsonb_array_elements(sfr.variants) variant
    cross join lateral regexp_split_to_table(upper(coalesce(variant->>'size', '')), '\s*/\s*') as size_parts(size_token)
    where coalesce(variant->>'size', '') <> ''
      and size_parts.size_token <> ''
      and coalesce((variant->>'available')::boolean, true) = true
  )
  select
    coalesce((select total_count from counted), 0),
    coalesce(jsonb_agg(page_rows.row_data order by page_rows.position), '[]'::jsonb),
    jsonb_build_object(
      'categories', coalesce((select jsonb_agg(distinct category order by category) from all_filter_rows where coalesce(category, '') <> ''), '[]'::jsonb),
      'subcategories', coalesce((select jsonb_agg(distinct subcategory order by subcategory) from all_filter_rows where coalesce(subcategory, '') <> ''), '[]'::jsonb),
      'colors', coalesce((select jsonb_agg(distinct color order by color) from all_filter_rows where coalesce(color, '') <> ''), '[]'::jsonb),
      'sizes', coalesce((select jsonb_agg(size order by size) from sizes where size <> ''), '[]'::jsonb)
    )
  into v_total_count, v_rows, v_filters
  from page_rows;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totalCount', coalesce(v_total_count, 0),
    'page', v_page,
    'pageSize', v_page_size,
    'filters', coalesce(v_filters, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.list_public_catalog_products(text, text, text, text, text, numeric, numeric, text, integer, integer) from public;
grant execute on function public.list_public_catalog_products(text, text, text, text, text, numeric, numeric, text, integer, integer) to anon, authenticated;
