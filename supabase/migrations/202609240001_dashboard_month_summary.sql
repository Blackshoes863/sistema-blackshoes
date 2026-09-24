-- Resumen mensual calculado en PostgreSQL para que el dashboard no dependa
-- de descargar todas las ventas/gastos del mes en el navegador.

create or replace function public.get_dashboard_month_summary(
  p_month date,
  p_today date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_month_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  v_today date := coalesce(p_today, current_date);
  v_month_revenue numeric := 0;
  v_month_expenses numeric := 0;
  v_month_merchandise_cost numeric := 0;
  v_month_sales_count integer := 0;
  v_today_revenue numeric := 0;
  v_today_paid_total numeric := 0;
  v_today_payment_methods jsonb := '[]'::jsonb;
  v_sales_receivable numeric := 0;
  v_initial_debt_receivable numeric := 0;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select
    coalesce(sum(s.total), 0),
    count(*)::integer
  into v_month_revenue, v_month_sales_count
  from public.sales s
  where s.archived_at is null
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_month_start
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date < v_month_end;

  select coalesce(sum(si.quantity * si.unit_cost), 0)
  into v_month_merchandise_cost
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.archived_at is null
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_month_start
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date < v_month_end;

  select coalesce(sum(e.amount), 0)
  into v_month_expenses
  from public.expenses e
  where e.archived_at is null
    and e.category not in ('CompraMercaderia', 'Mercaderia')
    and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_month_start
    and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date < v_month_end;

  select coalesce(sum(s.total), 0)
  into v_today_revenue
  from public.sales s
  where s.archived_at is null
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today;

  select coalesce(sum(s.paid_amount), 0)
  into v_today_paid_total
  from public.sales s
  where s.archived_at is null
    and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today;

  select coalesce(jsonb_agg(row_to_json(method_rows)::jsonb order by method_rows.total desc), '[]'::jsonb)
  into v_today_payment_methods
  from (
    select
      coalesce(nullif(s.payment_method, ''), 'sin-medio') as method,
      count(*)::integer as count,
      coalesce(sum(s.paid_amount), 0) as total
    from public.sales s
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
    group by coalesce(nullif(s.payment_method, ''), 'sin-medio')
  ) method_rows;

  select coalesce(sum(greatest(s.total - s.paid_amount, 0)), 0)
  into v_sales_receivable
  from public.sales s
  where s.archived_at is null;

  select coalesce(sum(greatest(c.initial_debt - coalesce(p.paid_amount, 0), 0)), 0)
  into v_initial_debt_receivable
  from public.customers c
  left join (
    select customer_id, sum(amount) as paid_amount
    from public.payments
    where sale_id is null
    group by customer_id
  ) p on p.customer_id = c.id
  where c.archived_at is null;

  return jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'monthRevenue', v_month_revenue,
    'monthExpenses', v_month_expenses,
    'monthMerchandiseCost', v_month_merchandise_cost,
    'monthResult', v_month_revenue - v_month_expenses - v_month_merchandise_cost,
    'monthSalesCount', v_month_sales_count,
    'receivablesTotal', v_sales_receivable + v_initial_debt_receivable,
    'salesReceivable', v_sales_receivable,
    'initialDebtReceivable', v_initial_debt_receivable,
    'todayRevenue', v_today_revenue,
    'todayOnlineRevenue', 0,
    'todayPaymentTotal', v_today_paid_total,
    'todayPaymentMethods', v_today_payment_methods
  );
end;
$$;

revoke all on function public.get_dashboard_month_summary(date, date) from public, anon;
grant execute on function public.get_dashboard_month_summary(date, date) to authenticated;
