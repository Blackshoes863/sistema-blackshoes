-- Exportacion completa para Excel desde PostgreSQL.
-- Evita que el Excel dependa de los datos cargados en memoria por el navegador.

create or replace function public.get_excel_export_data(
  p_month date default date_trunc('month', now())::date,
  p_today date default (now() at time zone 'America/Argentina/Buenos_Aires')::date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary jsonb;
  v_sales jsonb;
  v_products jsonb;
  v_customers jsonb;
  v_expenses jsonb;
  v_raw_expenses jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  v_summary := public.get_dashboard_month_summary(p_month, p_today);

  with ordered_sales as (
    select s.*
    from public.sales s
    where s.archived_at is null
    order by s.sold_at desc, s.local_order_number desc, s.id desc
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
  from ordered_sales s
  left join public.customers c on c.id = s.customer_id;

  with ordered_products as (
    select p.*
    from public.products p
    where p.archived_at is null
      and p.sku <> 'MANUAL_INTERNAL'
    order by p.created_at desc, p.name asc, p.id asc
  )
  select coalesce(jsonb_agg(
    to_jsonb(p)
    || jsonb_build_object(
      'product_categories', case when pc.id is null then null else to_jsonb(pc) end,
      'product_subcategories', case when ps.id is null then null else to_jsonb(ps) end,
      'product_variants', coalesce((
        select jsonb_agg(to_jsonb(pv) order by pv.sort_order asc, pv.size asc, pv.id asc)
        from public.product_variants pv
        where pv.product_id = p.id
          and pv.archived_at is null
      ), '[]'::jsonb),
      'product_images', coalesce((
        select jsonb_agg(to_jsonb(pi) order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc, pi.id asc)
        from public.product_images pi
        where pi.product_id = p.id
          and pi.archived_at is null
      ), '[]'::jsonb)
    )
    order by p.created_at desc, p.name asc, p.id asc
  ), '[]'::jsonb)
  into v_products
  from ordered_products p
  left join public.product_categories pc on pc.id = p.category_id
  left join public.product_subcategories ps on ps.id = p.subcategory_id;

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
        order by p.paid_at desc, p.created_at desc, p.id
      ), '[]'::jsonb) as initial_payments
    from public.payments p
    where p.sale_id is null
      and p.customer_id is not null
    group by p.customer_id
  )
  select coalesce(jsonb_agg(
    to_jsonb(c)
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
    order by c.name asc, c.id asc
  ), '[]'::jsonb)
  into v_customers
  from public.customers c
  left join sale_stats ss on ss.customer_id = c.id
  left join initial_payment_stats ips on ips.customer_id = c.id
  where c.archived_at is null;

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
  )
  select coalesce(jsonb_agg(row_to_json(all_rows)::jsonb order by all_rows.date desc, all_rows.row_order desc, all_rows.key desc), '[]'::jsonb)
  into v_expenses
  from all_rows;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.expense_at desc, e.created_at desc, e.id desc), '[]'::jsonb)
  into v_raw_expenses
  from public.expenses e
  where e.archived_at is null;

  return jsonb_build_object(
    'summary', v_summary,
    'sales', coalesce(v_sales, '[]'::jsonb),
    'products', coalesce(v_products, '[]'::jsonb),
    'customers', coalesce(v_customers, '[]'::jsonb),
    'expenses', coalesce(v_expenses, '[]'::jsonb),
    'rawExpenses', coalesce(v_raw_expenses, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_excel_export_data(date, date) from public, anon;
grant execute on function public.get_excel_export_data(date, date) to authenticated;
