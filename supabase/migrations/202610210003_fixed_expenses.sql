-- Carga mensual atomica de gastos fijos; las plantillas siguen siendo configuracion.
begin;

alter table public.expenses add column if not exists fixed_template_id text;
alter table public.expenses add column if not exists fixed_month date;

alter table public.expenses drop constraint if exists expenses_fixed_month_valid;
alter table public.expenses add constraint expenses_fixed_month_valid check (
  (fixed_template_id is null and fixed_month is null)
  or (
    nullif(btrim(fixed_template_id), '') is not null
    and fixed_month is not null
    and fixed_month = date_trunc('month', fixed_month)::date
    and fixed_month = date_trunc('month', expense_at at time zone 'America/Argentina/Buenos_Aires')::date
  )
);

create unique index if not exists expenses_active_fixed_template_month
on public.expenses(fixed_template_id, fixed_month)
where fixed_template_id is not null and archived_at is null;

create or replace function public.register_fixed_expenses(
  p_operation_id uuid,
  p_date date,
  p_expenses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_payload jsonb;
  v_previous public.audit_log%rowtype;
  v_item jsonb;
  v_template_id text;
  v_category text;
  v_concept text;
  v_amount numeric;
  v_before public.expenses%rowtype;
  v_expense public.expenses%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado para cargar gastos fijos.';
  end if;
  if p_operation_id is null or p_date is null or not isfinite(p_date) then
    raise exception 'Operacion o fecha invalida.';
  end if;
  if jsonb_typeof(p_expenses) is distinct from 'array' then
    raise exception 'La seleccion debe ser una lista de gastos.';
  end if;
  if jsonb_array_length(p_expenses) < 1 or jsonb_array_length(p_expenses) > 100 then
    raise exception 'Selecciona entre 1 y 100 gastos fijos.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_expenses) item
    group by btrim(item->>'template_id') having count(*) > 1
  ) then
    raise exception 'Hay plantillas repetidas en la seleccion.';
  end if;

  v_month := date_trunc('month', p_date)::date;
  select jsonb_build_object('date', p_date, 'expenses', jsonb_agg(item order by item->>'template_id'))
  into v_payload from jsonb_array_elements(p_expenses) item;

  perform pg_advisory_xact_lock(hashtextextended('fixed_expenses:' || p_operation_id::text, 0));
  select * into v_previous from public.audit_log
  where entity_type = 'fixed_expenses' and action = 'register_month' and operation_id = p_operation_id
  limit 1;
  if found then
    if v_previous.payload is distinct from v_payload or v_previous.user_id is distinct from auth.uid() then
      raise exception 'La operacion ya fue utilizada con otros parametros o usuario.';
    end if;
    return v_previous.after_data;
  end if;

  -- Dos usuarios cargando el mismo mes actualizan la misma fila por plantilla.
  perform pg_advisory_xact_lock(hashtextextended('fixed_expenses_month:' || v_month::text, 0));
  for v_item in select item from jsonb_array_elements(p_expenses) item order by item->>'template_id'
  loop
    v_template_id := nullif(btrim(v_item->>'template_id'), '');
    v_category := nullif(btrim(v_item->>'category'), '');
    v_concept := nullif(btrim(v_item->>'concept'), '');
    v_amount := (v_item->>'amount')::numeric;
    if v_template_id is null or length(v_template_id) > 200 or v_concept is null or v_category is null then
      raise exception 'Plantilla, concepto o categoria invalidos.';
    end if;
    if v_category in ('CompraMercaderia', 'Mercaderia') then
      raise exception 'Un gasto fijo no puede ser una compra de mercaderia.';
    end if;
    if v_amount is null or v_amount::text in ('NaN', 'Infinity', '-Infinity') or round(v_amount, 2) <= 0 then
      raise exception 'Importe invalido para %.', v_concept;
    end if;

    select * into v_before from public.expenses
    where fixed_template_id = v_template_id and fixed_month = v_month and archived_at is null
    for update;

    insert into public.expenses (
      operation_id, expense_at, category, amount, payment_method, note, created_by, fixed_template_id, fixed_month
    ) values (
      gen_random_uuid(), p_date::timestamp at time zone 'America/Argentina/Buenos_Aires',
      v_category, round(v_amount, 2), '', v_concept, auth.uid(), v_template_id, v_month
    )
    on conflict (fixed_template_id, fixed_month) where fixed_template_id is not null and archived_at is null
    do update set expense_at = excluded.expense_at, category = excluded.category, amount = excluded.amount, note = excluded.note
    returning * into v_expense;

    perform public.add_audit_log('expense', v_expense.id,
      case when v_before.id is null then 'create' else 'update' end,
      p_operation_id, case when v_before.id is null then null else to_jsonb(v_before) end,
      to_jsonb(v_expense), jsonb_build_object('source', 'fixed-monthly', 'template_id', v_template_id));
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_expense));
  end loop;

  v_result := jsonb_build_object('savedCount', jsonb_array_length(v_rows), 'expenses', v_rows, 'month', v_month);
  perform public.add_audit_log('fixed_expenses', null, 'register_month', p_operation_id, null, v_result, v_payload);
  return v_result;
end;
$$;

revoke all on function public.register_fixed_expenses(uuid, date, jsonb) from public, anon;
grant execute on function public.register_fixed_expenses(uuid, date, jsonb) to authenticated;

-- Las funciones de lectura actualizadas se definen a continuacion.

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
        when e.fixed_template_id is not null or e.category in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios') then 'fijo'
        else 'variable'
      end as behavior,
      'local' as area,
      coalesce(nullif(e.note, ''), e.category) as concept,
      case
        when e.fixed_template_id is not null then 'Gasto fijo mensual'
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

-- Separa ventas generadas, ingresos reales y cobro de deudas en Estadisticas.

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
  v_fake_income numeric := 0;
  v_sales_real_income numeric := 0;
  v_debt_collections numeric := 0;
  v_real_income numeric := 0;
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
  ),
  sale_payment_summary as (
    select
      s.id,
      coalesce(sum(p.amount) filter (where lower(coalesce(p.note, '')) like '%pago registrado al crear la venta%'), 0) as initial_paid,
      count(p.id) as payment_count
    from sales_in_range s
    left join public.payments p on p.sale_id = s.id
    group by s.id
  )
  select
    coalesce(sum(s.total), 0),
    coalesce(sum(case when ps.payment_count > 0 then ps.initial_paid else least(s.paid_amount, s.total) end), 0),
    count(*)::integer
  into v_fake_income, v_sales_real_income, v_sales_count
  from sales_in_range s
  left join sale_payment_summary ps on ps.id = s.id;

  select coalesce(sum(p.amount), 0)
  into v_debt_collections
  from public.payments p
  left join public.sales s on s.id = p.sale_id
  where lower(coalesce(p.note, '')) not like '%pago registrado al crear la venta%'
    and (s.id is null or s.archived_at is null)
    and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
    and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to;

  v_real_income := v_sales_real_income + v_debt_collections;

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
    coalesce(sum(e.amount) filter (where e.fixed_template_id is not null or e.category in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios')), 0),
    coalesce(sum(e.amount) filter (where e.fixed_template_id is null and e.category not in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios')), 0)
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
      and coalesce(p.sku, '') <> 'MANUAL_INTERNAL'
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

  with actual_payment_rows as (
    select
      case lower(coalesce(nullif(p.method, ''), 'sin-medio'))
        when 'efectivo' then 'Efectivo'
        when 'debito' then 'Débito'
        when 'transferencia' then 'Transferencias'
        when 'transferencias' then 'Transferencias'
        when 'qr' then 'QR'
        when 'credito' then 'Crédito'
        when 'web' then 'Web'
        when 'sin-medio' then 'Sin Medio'
        else initcap(replace(coalesce(nullif(p.method, ''), 'Sin Medio'), '-', ' '))
      end as method,
      p.amount
    from public.payments p
    left join public.sales s on s.id = p.sale_id
    where (s.id is null or s.archived_at is null)
      and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
  ),
  legacy_sale_payment_rows as (
    select
      case lower(coalesce(nullif(s.payment_method, ''), 'sin-medio'))
        when 'efectivo' then 'Efectivo'
        when 'debito' then 'Débito'
        when 'transferencia' then 'Transferencias'
        when 'transferencias' then 'Transferencias'
        when 'qr' then 'QR'
        when 'credito' then 'Crédito'
        when 'web' then 'Web'
        when 'sin-medio' then 'Sin Medio'
        else initcap(replace(coalesce(nullif(s.payment_method, ''), 'Sin Medio'), '-', ' '))
      end as method,
      least(s.paid_amount, s.total) as amount
    from public.sales s
    where s.archived_at is null
      and least(s.paid_amount, s.total) > 0
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= v_from
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
      and not exists (select 1 from public.payments p where p.sale_id = s.id)
  ),
  payment_totals as (
    select
      method,
      count(*)::integer as count,
      coalesce(sum(amount), 0) as amount
    from (
      select * from actual_payment_rows
      union all
      select * from legacy_sale_payment_rows
    ) payment_union
    group by method
  )
  select coalesce(jsonb_object_agg(method, jsonb_build_object('amount', amount, 'count', count)), '{}'::jsonb)
  into v_payments
  from payment_totals;

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
      coalesce(sum(s.total), 0) as fake_income,
      coalesce(sum(case when coalesce(ps.payment_count, 0) > 0 then coalesce(ps.initial_paid, 0) else least(s.paid_amount, s.total) end), 0) as sales_real_income
    from public.sales s
    left join (
      select
        p.sale_id,
        coalesce(sum(p.amount) filter (where lower(coalesce(p.note, '')) like '%pago registrado al crear la venta%'), 0) as initial_paid,
        count(p.id) as payment_count
      from public.payments p
      where p.sale_id is not null
      group by p.sale_id
    ) ps on ps.sale_id = s.id
    where s.archived_at is null
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date >= date_trunc('month', v_from)::date
      and (s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by date_trunc('month', s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date
  ),
  monthly_debt_collections as (
    select
      date_trunc('month', p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date as month_start,
      coalesce(sum(p.amount), 0) as debt_collections
    from public.payments p
    left join public.sales s on s.id = p.sale_id
    where lower(coalesce(p.note, '')) not like '%pago registrado al crear la venta%'
      and (s.id is null or s.archived_at is null)
      and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date >= date_trunc('month', v_from)::date
      and (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date <= v_to
    group by date_trunc('month', p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date
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
      'income', coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0),
      'realIncome', coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0),
      'fakeIncome', coalesce(s.fake_income, 0),
      'salesRealIncome', coalesce(s.sales_real_income, 0),
      'debtCollections', coalesce(d.debt_collections, 0),
      'costs', coalesce(e.expenses, 0) + coalesce(c.merchandise_cost, 0),
      'margin', coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0) - coalesce(e.expenses, 0) - coalesce(c.merchandise_cost, 0),
      'marginRate', case when coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0) > 0 then ((coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0) - coalesce(e.expenses, 0) - coalesce(c.merchandise_cost, 0)) / (coalesce(s.sales_real_income, 0) + coalesce(d.debt_collections, 0))) * 100 else 0 end
    )
    order by ms.month_start
  ), '[]'::jsonb)
  into v_trend
  from month_series ms
  left join monthly_sales s on s.month_start = ms.month_start
  left join monthly_debt_collections d on d.month_start = ms.month_start
  left join monthly_expenses e on e.month_start = ms.month_start
  left join monthly_costs c on c.month_start = ms.month_start;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'scope', v_scope,
    'salesCount', v_sales_count,
    'income', v_real_income,
    'fakeIncome', v_fake_income,
    'salesRealIncome', v_sales_real_income,
    'debtCollections', v_debt_collections,
    'realIncome', v_real_income,
    'localIncome', v_real_income,
    'webInsumos', 0,
    'webAccesorios', 0,
    'shipping', 0,
    'fixedExpenses', v_fixed_expenses,
    'variableExpenses', v_variable_expenses,
    'expenseTotal', v_fixed_expenses + v_variable_expenses,
    'merchandiseCost', v_merchandise_cost,
    'margin', v_real_income - v_fixed_expenses - v_variable_expenses - v_merchandise_cost,
    'ticket', case when v_sales_count > 0 then v_fake_income / v_sales_count else 0 end,
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
        when e.fixed_template_id is not null or e.category in ('Alquiler', 'Sueldos', 'Impuestos', 'Honorarios') then 'fijo'
        else 'variable'
      end as behavior,
      'local' as area,
      coalesce(nullif(e.note, ''), e.category) as concept,
      case
        when e.fixed_template_id is not null then 'Gasto fijo mensual'
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

notify pgrst, 'reload schema';
commit;
