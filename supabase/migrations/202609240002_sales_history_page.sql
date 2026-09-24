-- Historial de ventas paginado desde PostgreSQL.
-- Evita descargar todas las ventas para mostrar una pagina filtrada.

create or replace function public.list_sales_history_page(
  p_order_query text default '',
  p_from date default null,
  p_to date default null,
  p_payment_methods text[] default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_offset integer;
  v_query text := lower(trim(coalesce(p_order_query, '')));
  v_rows jsonb;
  v_total integer;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered as (
    select s.*
    from public.sales s
    where s.archived_at is null
      and (p_from is null or (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_from)
      and (p_to is null or (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_to)
      and (
        v_query = ''
        or lower('#' || lpad(coalesce(s.local_order_number, 0)::text, 4, '0')) like '%' || v_query || '%'
        or lower(coalesce(s.notes, '')) like '%' || v_query || '%'
      )
      and (
        p_payment_methods is null
        or cardinality(p_payment_methods) = 0
        or s.payment_method = any(p_payment_methods)
      )
  )
  select count(*)::integer
  into v_total
  from filtered;

  with filtered as (
    select s.*
    from public.sales s
    where s.archived_at is null
      and (p_from is null or (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_from)
      and (p_to is null or (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_to)
      and (
        v_query = ''
        or lower('#' || lpad(coalesce(s.local_order_number, 0)::text, 4, '0')) like '%' || v_query || '%'
        or lower(coalesce(s.notes, '')) like '%' || v_query || '%'
      )
      and (
        p_payment_methods is null
        or cardinality(p_payment_methods) = 0
        or s.payment_method = any(p_payment_methods)
      )
  ),
  page_rows as (
    select *
    from filtered
    order by sold_at desc, local_order_number desc, id desc
    limit v_page_size
    offset v_offset
  )
  select coalesce(jsonb_agg(row_to_json(row_payload)::jsonb order by row_payload.sold_at desc, row_payload.local_order_number desc, row_payload.id desc), '[]'::jsonb)
  into v_rows
  from (
    select
      s.*,
      coalesce((
        select jsonb_agg(to_jsonb(si) order by si.created_at asc, si.id asc)
        from public.sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb) as sale_items,
      coalesce((
        select jsonb_agg(to_jsonb(p) order by p.paid_at asc, p.created_at asc, p.id asc)
        from public.payments p
        where p.sale_id = s.id
      ), '[]'::jsonb) as payments
    from page_rows s
  ) row_payload;

  return jsonb_build_object(
    'rows', v_rows,
    'totalCount', coalesce(v_total, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.list_sales_history_page(text, date, date, text[], integer, integer) from public, anon;
grant execute on function public.list_sales_history_page(text, date, date, text[], integer, integer) to authenticated;
