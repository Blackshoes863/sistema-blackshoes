-- Detalle de cliente paginado desde PostgreSQL.
-- La ficha ya no depende de que el navegador tenga todo el historial de ventas cargado.

create or replace function public.get_customer_detail(
  p_customer_id uuid,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_offset integer;
  v_customer jsonb;
  v_sales jsonb;
  v_debt_sales jsonb;
  v_payments jsonb;
  v_total_count integer;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if p_customer_id is null then
    raise exception 'Cliente invalido';
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
      and s.customer_id = p_customer_id
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
        order by p.paid_at desc, p.created_at desc, p.id
      ), '[]'::jsonb) as initial_payments
    from public.payments p
    where p.sale_id is null
      and p.customer_id = p_customer_id
    group by p.customer_id
  )
  select to_jsonb(c)
    || jsonb_build_object(
      'initial_payments', coalesce(ips.initial_payments, '[]'::jsonb),
      'stats', jsonb_build_object(
        'total', coalesce(ss.total_amount, 0),
        'sales_count', coalesce(ss.sales_count, 0),
        'local_total', coalesce(ss.total_amount, 0),
        'web_total', 0,
        'last_date', coalesce(ss.last_sale_date, ''),
        'ticket', case when coalesce(ss.sales_count, 0) > 0 then coalesce(ss.total_amount, 0) / ss.sales_count else 0 end,
        'workshop_count', 0,
        'debt', coalesce(ss.sale_debt, 0) + greatest(c.initial_debt - coalesce(ips.paid_amount, 0), 0)
      )
    )
  into v_customer
  from public.customers c
  left join sale_stats ss on ss.customer_id = c.id
  left join initial_payment_stats ips on ips.customer_id = c.id
  where c.id = p_customer_id
    and c.archived_at is null;

  if v_customer is null then
    raise exception 'Cliente inexistente';
  end if;

  select count(*)::integer
  into v_total_count
  from public.sales s
  where s.archived_at is null
    and s.customer_id = p_customer_id;

  with page_sales as (
    select s.*
    from public.sales s
    where s.archived_at is null
      and s.customer_id = p_customer_id
    order by s.sold_at desc, s.local_order_number desc, s.id desc
    limit v_page_size
    offset v_offset
  )
  select coalesce(jsonb_agg(
    to_jsonb(s)
    || jsonb_build_object(
      'customers', v_customer - 'initial_payments' - 'stats',
      'sale_items', coalesce((
        select jsonb_agg(to_jsonb(si) order by si.created_at asc, si.id asc)
        from public.sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.paid_at asc, p.created_at asc, p.id asc)
        from public.payments p
        where p.sale_id = s.id
      ), '[]'::jsonb)
    )
    order by s.sold_at desc, s.local_order_number desc, s.id desc
  ), '[]'::jsonb)
  into v_sales
  from page_sales s;

  with debt_sales as (
    select s.*
    from public.sales s
    where s.archived_at is null
      and s.customer_id = p_customer_id
      and greatest(s.total - s.paid_amount, 0) > 0
    order by s.sold_at desc, s.local_order_number desc, s.id desc
  )
  select coalesce(jsonb_agg(
    to_jsonb(s)
    || jsonb_build_object(
      'customers', v_customer - 'initial_payments' - 'stats',
      'sale_items', coalesce((
        select jsonb_agg(to_jsonb(si) order by si.created_at asc, si.id asc)
        from public.sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.paid_at asc, p.created_at asc, p.id asc)
        from public.payments p
        where p.sale_id = s.id
      ), '[]'::jsonb)
    )
    order by s.sold_at desc, s.local_order_number desc, s.id desc
  ), '[]'::jsonb)
  into v_debt_sales
  from debt_sales s;

  with customer_payments as (
    select
      p.*,
      case
        when p.sale_id is null then 'Deuda inicial'
        else '#' || lpad(coalesce(s.local_order_number, 0)::text, 4, '0')
      end as source_label
    from public.payments p
    left join public.sales s on s.id = p.sale_id
    where p.customer_id = p_customer_id
       or s.customer_id = p_customer_id
    order by p.paid_at desc, p.created_at desc, p.id desc
    limit 10
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'paid_at', p.paid_at,
      'amount', p.amount,
      'method', p.method,
      'note', p.note,
      'created_at', p.created_at,
      'sourceLabel', p.source_label
    )
    order by p.paid_at desc, p.created_at desc, p.id desc
  ), '[]'::jsonb)
  into v_payments
  from customer_payments p;

  return jsonb_build_object(
    'customer', v_customer,
    'sales', coalesce(v_sales, '[]'::jsonb),
    'debtSales', coalesce(v_debt_sales, '[]'::jsonb),
    'payments', coalesce(v_payments, '[]'::jsonb),
    'totalCount', coalesce(v_total_count, 0),
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke all on function public.get_customer_detail(uuid, integer, integer) from public, anon;
grant execute on function public.get_customer_detail(uuid, integer, integer) to authenticated;
