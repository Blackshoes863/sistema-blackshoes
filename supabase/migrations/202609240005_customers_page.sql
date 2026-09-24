-- Clientes paginados desde PostgreSQL.
-- Incluye metricas y deuda para no descargar toda la cartera al entrar.

create or replace function public.list_customers_page(
  p_query text default '',
  p_sort text default 'alpha',
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
  v_query_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_sort text := coalesce(nullif(trim(coalesce(p_sort, '')), ''), 'alpha');
  v_rows jsonb;
  v_total_count integer;
  v_active_count integer;
  v_total_amount numeric;
  v_debt_amount numeric;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with sale_stats as (
    select
      s.customer_id,
      count(*)::integer as sales_count,
      coalesce(sum(s.total), 0) as total_amount,
      max((s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date)::text as last_sale_date,
      coalesce(sum(greatest(s.total - s.paid_amount, 0)), 0) as sale_debt
    from public.sales s
    where s.archived_at is null
      and s.customer_id is not null
    group by s.customer_id
  ),
  initial_payment_stats as (
    select
      p.customer_id,
      coalesce(sum(p.amount), 0) as paid_amount,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'paid_at', p.paid_at,
          'amount', p.amount,
          'method', p.method,
          'note', p.note,
          'created_at', p.created_at
        )
        order by p.paid_at desc, p.created_at desc
      ), '[]'::jsonb) as initial_payments
    from public.payments p
    where p.sale_id is null
      and p.customer_id is not null
    group by p.customer_id
  ),
  customer_rows as (
    select
      c.*,
      coalesce(ss.sales_count, 0) as sales_count,
      coalesce(ss.total_amount, 0) as total_amount,
      coalesce(ss.last_sale_date, '') as last_sale_date,
      coalesce(ss.sale_debt, 0) as sale_debt,
      greatest(c.initial_debt - coalesce(ips.paid_amount, 0), 0) as initial_debt_outstanding,
      coalesce(ips.initial_payments, '[]'::jsonb) as initial_payments
    from public.customers c
    left join sale_stats ss on ss.customer_id = c.id
    left join initial_payment_stats ips on ips.customer_id = c.id
    where c.archived_at is null
  ),
  filtered as (
    select
      cr.*,
      (cr.sale_debt + cr.initial_debt_outstanding) as debt_amount,
      case when cr.sales_count > 0 then cr.total_amount / cr.sales_count else 0 end as ticket
    from customer_rows cr
    where (
      v_query = ''
      or lower(coalesce(cr.name, '')) like '%' || v_query || '%'
      or lower(coalesce(cr.phone, '')) like '%' || v_query || '%'
      or lower(coalesce(cr.city, '')) like '%' || v_query || '%'
      or (v_query_digits <> '' and regexp_replace(coalesce(cr.dni, ''), '\D', '', 'g') like '%' || v_query_digits || '%')
    )
  ),
  counted as (
    select
      count(*)::integer as total_count,
      count(*) filter (where sales_count > 0)::integer as active_count,
      coalesce(sum(total_amount), 0) as total_amount,
      coalesce(sum(debt_amount), 0) as debt_amount
    from filtered
  ),
  ordered as (
    select
      f.*,
      row_number() over (
        order by
          case when v_sort = 'amount' then f.total_amount end desc nulls last,
          case when v_sort = 'amount' then f.name end asc nulls last,
          case when v_sort <> 'amount' then f.name end asc nulls last,
          f.id asc
      ) as position
    from filtered f
  ),
  page_rows as (
    select
      o.position,
      jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'dni', o.dni,
        'phone', o.phone,
        'city', o.city,
        'notes', o.notes,
        'initial_debt', o.initial_debt,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'initial_payments', o.initial_payments,
        'stats', jsonb_build_object(
          'total', o.total_amount,
          'sales_count', o.sales_count,
          'local_total', o.total_amount,
          'web_total', 0,
          'last_date', o.last_sale_date,
          'ticket', o.ticket,
          'workshop_count', 0,
          'debt', o.debt_amount
        )
      ) as row_data
    from ordered o
    where o.position > v_offset
      and o.position <= v_offset + v_page_size
  )
  select
    coalesce((select total_count from counted), 0),
    coalesce((select active_count from counted), 0),
    coalesce((select total_amount from counted), 0),
    coalesce((select debt_amount from counted), 0),
    coalesce(jsonb_agg(page_rows.row_data order by page_rows.position), '[]'::jsonb)
  into v_total_count, v_active_count, v_total_amount, v_debt_amount, v_rows
  from page_rows;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totalCount', coalesce(v_total_count, 0),
    'activeCount', coalesce(v_active_count, 0),
    'totalAmount', coalesce(v_total_amount, 0),
    'debtAmount', coalesce(v_debt_amount, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.list_customers_page(text, text, integer, integer) from public, anon;
grant execute on function public.list_customers_page(text, text, integer, integer) to authenticated;
