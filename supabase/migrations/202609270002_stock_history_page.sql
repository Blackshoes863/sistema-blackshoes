-- Historial de stock paginado desde PostgreSQL.
-- Permite auditar movimientos viejos sin descargar toda la tabla al ingresar.

create index if not exists idx_stock_movements_created
on public.stock_movements(created_at desc, id desc);

create index if not exists idx_stock_movements_product_created
on public.stock_movements(product_id, created_at desc, id desc);

create or replace function public.list_stock_history_page(
  p_product_id uuid default null,
  p_query text default '',
  p_type text default 'all',
  p_from date default null,
  p_to date default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_type text := lower(coalesce(nullif(trim(p_type), ''), 'all'));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_offset integer;
  v_total integer;
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered as (
    select
      sm.id,
      sm.created_at,
      sm.product_id,
      sm.variant_id,
      coalesce(p.sku, '') as product_code,
      coalesce(p.name, 'Producto') as product_name,
      coalesce(pv.size, '') as size,
      case sm.movement_type
        when 'initial' then 'entrada'
        when 'purchase' then 'entrada'
        when 'sale' then 'venta'
        else 'ajuste'
      end as app_type,
      sm.quantity_delta,
      sm.stock_after,
      sm.unit_cost,
      sm.note
    from public.stock_movements sm
    left join public.products p on p.id = sm.product_id
    left join public.product_variants pv on pv.id = sm.variant_id
    where (p_product_id is null or sm.product_id = p_product_id)
      and (
        v_query = ''
        or lower(coalesce(p.sku, '')) like '%' || v_query || '%'
        or lower(coalesce(p.name, '')) like '%' || v_query || '%'
        or lower(coalesce(pv.size, '')) like '%' || v_query || '%'
        or lower(coalesce(sm.note, '')) like '%' || v_query || '%'
      )
      and (
        v_type = 'all'
        or case sm.movement_type
          when 'initial' then 'entrada'
          when 'purchase' then 'entrada'
          when 'sale' then 'venta'
          else 'ajuste'
        end = v_type
      )
      and (p_from is null or (sm.created_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_from)
      and (p_to is null or (sm.created_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_to)
  )
  select count(*)
    into v_total
  from filtered;

  with filtered as (
    select
      sm.id,
      sm.created_at,
      sm.product_id,
      sm.variant_id,
      coalesce(p.sku, '') as product_code,
      coalesce(p.name, 'Producto') as product_name,
      coalesce(pv.size, '') as size,
      case sm.movement_type
        when 'initial' then 'entrada'
        when 'purchase' then 'entrada'
        when 'sale' then 'venta'
        else 'ajuste'
      end as app_type,
      sm.quantity_delta,
      sm.stock_after,
      sm.unit_cost,
      sm.note
    from public.stock_movements sm
    left join public.products p on p.id = sm.product_id
    left join public.product_variants pv on pv.id = sm.variant_id
    where (p_product_id is null or sm.product_id = p_product_id)
      and (
        v_query = ''
        or lower(coalesce(p.sku, '')) like '%' || v_query || '%'
        or lower(coalesce(p.name, '')) like '%' || v_query || '%'
        or lower(coalesce(pv.size, '')) like '%' || v_query || '%'
        or lower(coalesce(sm.note, '')) like '%' || v_query || '%'
      )
      and (
        v_type = 'all'
        or case sm.movement_type
          when 'initial' then 'entrada'
          when 'purchase' then 'entrada'
          when 'sale' then 'venta'
          else 'ajuste'
        end = v_type
      )
      and (p_from is null or (sm.created_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_from)
      and (p_to is null or (sm.created_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_to)
    order by sm.created_at desc, sm.id desc
    limit v_page_size
    offset v_offset
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'date', ((created_at at time zone 'America/Argentina/Buenos_Aires')::date)::text,
      'createdAt', created_at,
      'productId', product_id,
      'productCode', product_code,
      'productName', product_name,
      'variantId', variant_id,
      'size', size,
      'type', app_type,
      'quantity', quantity_delta,
      'stockAfter', coalesce(stock_after, 0),
      'unitCost', coalesce(unit_cost, 0),
      'note', coalesce(note, '')
    )
    order by created_at desc, id desc
  ), '[]'::jsonb)
    into v_rows
  from filtered;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totalCount', coalesce(v_total, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.list_stock_history_page(uuid, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.list_stock_history_page(uuid, text, text, date, date, integer, integer) to authenticated;
