-- Gastos y mercaderia paginados desde PostgreSQL.
-- Devuelve filas listas para la tabla, total de registros y total filtrado.

create or replace function public.list_expenses_page(
  p_query text default '',
  p_year text default null,
  p_month text default null,
  p_category text default 'all',
  p_type text default 'all',
  p_behavior text default 'all',
  p_hide_commissions boolean default false,
  p_page integer default 1,
  p_page_size integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 40), 1), 100);
  v_offset integer;
  v_query text := lower(trim(coalesce(p_query, '')));
  v_year text := nullif(trim(coalesce(p_year, '')), '');
  v_month text := coalesce(nullif(trim(coalesce(p_month, '')), ''), 'all');
  v_category text := coalesce(nullif(trim(coalesce(p_category, '')), ''), 'all');
  v_type text := coalesce(nullif(trim(coalesce(p_type, '')), ''), 'all');
  v_behavior text := coalesce(nullif(trim(coalesce(p_behavior, '')), ''), 'all');
  v_rows jsonb;
  v_total_count integer;
  v_total_amount numeric;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with all_rows as (
    select
      case when e.category in ('CompraMercaderia', 'Mercaderia') then 'purchase:' || e.id else 'expense:' || e.id end as key,
      case when e.category in ('CompraMercaderia', 'Mercaderia') then 'purchase' else 'expense' end as source,
      e.id,
      ((e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date)::text as date,
      case when e.category in ('CompraMercaderia', 'Mercaderia') then 'purchase' else 'expense' end as type,
      e.category,
      case
        when e.category in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios') then 'fijo'
        else 'variable'
      end as behavior,
      'local' as area,
      coalesce(nullif(e.note, ''), e.category) as concept,
      case
        when e.category in ('CompraMercaderia', 'Mercaderia') then 'Compra cargada manualmente'
        else 'Gasto cargado manualmente'
      end as detail,
      e.amount,
      e.category not in ('CompraMercaderia', 'Mercaderia') as affects_result,
      true as deletable,
      false as editable_amount,
      false as automatic,
      extract(epoch from e.created_at)::numeric as row_order
    from public.expenses e
    where e.archived_at is null

    union all

    select
      'sale-cost:' || s.id as key,
      'sale-cost' as source,
      s.id,
      ((s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date)::text as date,
      'purchase' as type,
      'Mercaderia' as category,
      'variable' as behavior,
      'local' as area,
      'Costo venta local #' || lpad(coalesce(s.local_order_number, 0)::text, 4, '0') as concept,
      'Productos vendidos en Local' as detail,
      sum(si.quantity * si.unit_cost) as amount,
      true as affects_result,
      false as deletable,
      false as editable_amount,
      true as automatic,
      extract(epoch from s.created_at)::numeric as row_order
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.archived_at is null
    group by s.id, s.sold_at, s.local_order_number, s.created_at
    having sum(si.quantity * si.unit_cost) > 0
  ),
  filtered as (
    select *
    from all_rows r
    where (v_year is null or left(r.date, 4) = v_year)
      and (v_month = 'all' or substring(r.date from 6 for 2) = v_month)
      and (v_category = 'all' or r.category = v_category)
      and (v_type = 'all' or r.type = v_type)
      and (v_behavior = 'all' or r.behavior = v_behavior)
      and (
        v_query = ''
        or lower(coalesce(r.concept, '')) like '%' || v_query || '%'
        or lower(coalesce(r.category, '')) like '%' || v_query || '%'
        or lower(coalesce(r.detail, '')) like '%' || v_query || '%'
      )
      and (
        p_hide_commissions is distinct from true
        or (
          r.category <> 'Comisiones'
          and lower(coalesce(r.concept, '')) not like '%comision%'
          and lower(coalesce(r.concept, '')) not like '%comisión%'
        )
      )
  ),
  counted as (
    select
      count(*)::integer as total_count,
      coalesce(sum(amount), 0) as total_amount
    from filtered
  ),
  page_rows as (
    select *
    from filtered
    order by date desc, row_order desc, key desc
    limit v_page_size
    offset v_offset
  )
  select
    coalesce((select total_count from counted), 0),
    coalesce((select total_amount from counted), 0),
    coalesce(jsonb_agg(row_to_json(page_rows)::jsonb order by page_rows.date desc, page_rows.row_order desc, page_rows.key desc), '[]'::jsonb)
  into v_total_count, v_total_amount, v_rows
  from page_rows;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totalCount', coalesce(v_total_count, 0),
    'totalAmount', coalesce(v_total_amount, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.list_expenses_page(text, text, text, text, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.list_expenses_page(text, text, text, text, text, text, boolean, integer, integer) to authenticated;
