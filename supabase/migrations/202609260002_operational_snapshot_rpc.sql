-- Carga operativa inicial por RPC.
-- Evita que el navegador consulte tablas grandes directamente al ingresar.

create or replace function public.get_operational_snapshot(
  p_sales_days integer default 60,
  p_expense_days integer default 60,
  p_stock_limit integer default 500,
  p_sales_limit integer default 1000,
  p_expense_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_days integer := coalesce(p_sales_days, 60);
  v_expense_days integer := coalesce(p_expense_days, 60);
  v_stock_limit integer := least(greatest(coalesce(p_stock_limit, 500), 1), 1000);
  v_sales_limit integer := least(greatest(coalesce(p_sales_limit, 1000), 1), 2000);
  v_expense_limit integer := least(greatest(coalesce(p_expense_limit, 1000), 1), 2000);
  v_sales_since timestamptz;
  v_expense_since timestamptz;
  v_sales jsonb;
  v_expenses jsonb;
  v_stock jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if v_sales_days > 0 then
    v_sales_since := (((now() at time zone 'America/Argentina/Buenos_Aires')::date - v_sales_days)::timestamp at time zone 'America/Argentina/Buenos_Aires');
  end if;

  if v_expense_days > 0 then
    v_expense_since := (((now() at time zone 'America/Argentina/Buenos_Aires')::date - v_expense_days)::timestamp at time zone 'America/Argentina/Buenos_Aires');
  end if;

  with scoped_sales as (
    select s.*
    from public.sales s
    where s.archived_at is null
      and (
        v_sales_since is null
        or s.sold_at >= v_sales_since
        or s.payment_status <> 'paid'
      )
    order by s.sold_at desc, s.local_order_number desc, s.id desc
    limit v_sales_limit
  )
  select coalesce(jsonb_agg(
    to_jsonb(s)
    || jsonb_build_object(
      'customers', case when c.id is null then null else to_jsonb(c) end,
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
  from scoped_sales s
  left join public.customers c on c.id = s.customer_id;

  with scoped_expenses as (
    select e.*
    from public.expenses e
    where e.archived_at is null
      and (
        v_expense_since is null
        or e.expense_at >= v_expense_since
      )
    order by e.expense_at desc, e.created_at desc, e.id desc
    limit v_expense_limit
  )
  select coalesce(jsonb_agg(to_jsonb(e) order by e.expense_at desc, e.created_at desc, e.id desc), '[]'::jsonb)
  into v_expenses
  from scoped_expenses e;

  with scoped_stock as (
    select sm.*
    from public.stock_movements sm
    order by sm.created_at desc, sm.id desc
    limit v_stock_limit
  )
  select coalesce(jsonb_agg(to_jsonb(sm) order by sm.created_at desc, sm.id desc), '[]'::jsonb)
  into v_stock
  from scoped_stock sm;

  return jsonb_build_object(
    'sales', coalesce(v_sales, '[]'::jsonb),
    'expenses', coalesce(v_expenses, '[]'::jsonb),
    'stock', coalesce(v_stock, '[]'::jsonb),
    'salesDays', v_sales_days,
    'expenseDays', v_expense_days
  );
end;
$$;

revoke all on function public.get_operational_snapshot(integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.get_operational_snapshot(integer, integer, integer, integer, integer) to authenticated;
