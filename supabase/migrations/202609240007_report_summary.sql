-- Estadisticas agregadas por rango.
-- Evita depender de descargar ventas/gastos completos para renderizar reportes.

create or replace function public.get_report_summary(
  p_from date,
  p_to date default null,
  p_scope text default 'total'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_to, current_date);
  v_scope text := coalesce(nullif(trim(coalesce(p_scope, '')), ''), 'total');
  v_income numeric := 0;
  v_sales_count integer := 0;
  v_merchandise_cost numeric := 0;
  v_fixed_expenses numeric := 0;
  v_variable_expenses numeric := 0;
  v_categories jsonb := '{}'::jsonb;
  v_subcategories jsonb := '{}'::jsonb;
  v_subcategory_categories jsonb := '{}'::jsonb;
  v_payments jsonb := '{}'::jsonb;
  v_expense_details jsonb := '{}'::jsonb;
  v_trend jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if v_to < v_from then
    v_from := v_to;
  end if;

  with sales_in_range as (
    select *
    from public.sales s
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
  )
  select coalesce(sum(total), 0), count(*)::integer
  into v_income, v_sales_count
  from sales_in_range;

  with sales_in_range as (
    select *
    from public.sales s
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
  )
  select coalesce(sum(si.quantity * si.unit_cost), 0)
  into v_merchandise_cost
  from public.sale_items si
  join sales_in_range s on s.id = si.sale_id;

  select
    coalesce(sum(e.amount) filter (where e.category in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios')), 0),
    coalesce(sum(e.amount) filter (where e.category not in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios')), 0)
  into v_fixed_expenses, v_variable_expenses
  from public.expenses e
  where e.archived_at is null
    and e.category not in ('CompraMercaderia', 'Mercaderia')
    and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
    and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to;

  with item_rows as (
    select
      coalesce(pc.name, 'Sin Categoria') as category,
      coalesce(ps.name, '') as subcategory,
      si.quantity
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    left join public.products p on p.id = si.product_id
    left join public.product_categories pc on pc.id = p.category_id
    left join public.product_subcategories ps on ps.id = p.subcategory_id
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
  ),
  category_rows as (
    select category, sum(quantity)::integer as quantity
    from item_rows
    where coalesce(category, '') <> ''
    group by category
  ),
  subcategory_rows as (
    select subcategory, sum(quantity)::integer as quantity, string_agg(distinct category, ' / ' order by category) as categories
    from item_rows
    where coalesce(subcategory, '') <> ''
    group by subcategory
  )
  select
    coalesce((select jsonb_object_agg(category, quantity) from category_rows), '{}'::jsonb),
    coalesce((select jsonb_object_agg(subcategory, quantity) from subcategory_rows), '{}'::jsonb),
    coalesce((select jsonb_object_agg(subcategory, categories) from subcategory_rows), '{}'::jsonb)
  into v_categories, v_subcategories, v_subcategory_categories;

  with payment_rows as (
    select
      coalesce(nullif(s.payment_method, ''), 'sin-medio') as method,
      count(*)::integer as count,
      coalesce(sum(s.total), 0) as amount
    from public.sales s
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by coalesce(nullif(s.payment_method, ''), 'sin-medio')
  )
  select coalesce(jsonb_object_agg(method, jsonb_build_object('amount', amount, 'count', count)), '{}'::jsonb)
  into v_payments
  from payment_rows;

  with expense_rows as (
    select
      coalesce(nullif(e.note, ''), e.category, 'Sin detalle') as label,
      count(*)::integer as count,
      coalesce(sum(e.amount), 0) as amount
    from public.expenses e
    where e.archived_at is null
      and e.category not in ('CompraMercaderia', 'Mercaderia')
      and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by coalesce(nullif(e.note, ''), e.category, 'Sin detalle')
  )
  select coalesce(jsonb_object_agg(label, jsonb_build_object('amount', amount, 'count', count)), '{}'::jsonb)
  into v_expense_details
  from expense_rows;

  with month_series as (
    select generate_series(date_trunc('month', v_from)::date, date_trunc('month', v_to)::date, interval '1 month')::date as month_start
  ),
  monthly_sales as (
    select
      date_trunc('month', s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date as month_start,
      coalesce(sum(s.total), 0) as income
    from public.sales s
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= date_trunc('month', v_from)::date
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by date_trunc('month', s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date
  ),
  monthly_costs as (
    select
      date_trunc('month', s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date as month_start,
      coalesce(sum(si.quantity * si.unit_cost), 0) as merchandise_cost
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= date_trunc('month', v_from)::date
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by date_trunc('month', s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date
  ),
  monthly_expenses as (
    select
      date_trunc('month', e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date as month_start,
      coalesce(sum(e.amount), 0) as expenses
    from public.expenses e
    where e.archived_at is null
      and e.category not in ('CompraMercaderia', 'Mercaderia')
      and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date >= date_trunc('month', v_from)::date
      and (e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by date_trunc('month', e.expense_at at time zone 'America/Argentina/Buenos_Aires')::date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', to_char(ms.month_start, 'YYYY-MM'),
      'income', coalesce(s.income, 0),
      'costs', coalesce(e.expenses, 0) + coalesce(c.merchandise_cost, 0),
      'margin', coalesce(s.income, 0) - coalesce(e.expenses, 0) - coalesce(c.merchandise_cost, 0),
      'marginRate', case when coalesce(s.income, 0) > 0 then ((coalesce(s.income, 0) - coalesce(e.expenses, 0) - coalesce(c.merchandise_cost, 0)) / coalesce(s.income, 0)) * 100 else 0 end
    )
    order by ms.month_start
  ), '[]'::jsonb)
  into v_trend
  from month_series ms
  left join monthly_sales s on s.month_start = ms.month_start
  left join monthly_expenses e on e.month_start = ms.month_start
  left join monthly_costs c on c.month_start = ms.month_start;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'scope', v_scope,
    'salesCount', v_sales_count,
    'income', v_income,
    'realIncome', v_income,
    'localIncome', v_income,
    'webInsumos', 0,
    'webAccesorios', 0,
    'shipping', 0,
    'fixedExpenses', v_fixed_expenses,
    'variableExpenses', v_variable_expenses,
    'expenseTotal', v_fixed_expenses + v_variable_expenses,
    'merchandiseCost', v_merchandise_cost,
    'margin', v_income - v_fixed_expenses - v_variable_expenses - v_merchandise_cost,
    'ticket', case when v_sales_count > 0 then v_income / v_sales_count else 0 end,
    'categories', v_categories,
    'subcategories', v_subcategories,
    'subcategoryCategories', v_subcategory_categories,
    'provinces', '{}'::jsonb,
    'payments', v_payments,
    'expenseDetails', v_expense_details,
    'trend', v_trend
  );
end;
$$;

revoke all on function public.get_report_summary(date, date, text) from public, anon;
grant execute on function public.get_report_summary(date, date, text) to authenticated;
