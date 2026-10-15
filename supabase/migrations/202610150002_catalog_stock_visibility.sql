-- La visibilidad se filtra antes de contar o paginar: cubre listado,
-- filtros, detalle, relacionados y la lectura directa del catalogo publico.
-- Se conserva el orden de columnas de la vista y se agrega tracks_stock.

create or replace view public.catalog_products as
select
  p.id,
  p.sku as code,
  p.slug,
  p.name,
  p.description,
  p.color,
  c.name as category,
  sc.name as subcategory,
  p.price,
  p.promo_price,
  p.published,
  p.created_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'size', v.size,
      'available', not p.tracks_stock or v.current_stock > 0,
      'sort_order', v.sort_order
    ) order by v.sort_order, v.size)
    from public.product_variants v
    where v.product_id = p.id
      and v.active = true
      and v.archived_at is null
  ), '[]'::jsonb) as variants,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'url', coalesce(i.public_url, i.storage_path),
      'path', i.storage_path,
      'alt', i.alt_text,
      'is_primary', i.is_primary,
      'sort_order', i.sort_order
    ) order by i.is_primary desc, i.sort_order, i.created_at)
    from public.product_images i
    where i.product_id = p.id
      and i.archived_at is null
  ), '[]'::jsonb) as images,
  p.tracks_stock
from public.products p
left join public.product_categories c on c.id = p.category_id
left join public.product_subcategories sc on sc.id = p.subcategory_id
where p.published = true
  and p.archived_at is null
  and (
    coalesce((select bs.out_of_stock_product_mode from public.business_settings bs where bs.id = 'main'), 'show') <> 'hide'
    or not p.tracks_stock
    or exists (
      select 1 from public.product_variants v
      where v.product_id = p.id
        and v.active = true
        and v.archived_at is null
        and v.current_stock > 0
    )
  );

notify pgrst, 'reload schema';
