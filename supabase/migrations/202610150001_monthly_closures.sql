-- Los cierres mensuales son snapshots persistentes, independientes del cache
-- del navegador. Un cierre por mes; recalcularlo actualiza el mismo registro.

create table if not exists public.monthly_closures (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  archived_at timestamptz
);

alter table public.monthly_closures enable row level security;
revoke all on public.monthly_closures from public, anon, authenticated;
grant select on public.monthly_closures to authenticated;

drop policy if exists monthly_closures_staff_read on public.monthly_closures;
create policy monthly_closures_staff_read on public.monthly_closures
for select to authenticated
using (public.is_active_staff());

create or replace function public.save_monthly_closure(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_start timestamptz;
  v_end timestamptz;
  v_summary jsonb;
  v_before public.monthly_closures%rowtype;
  v_closure public.monthly_closures%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;
  if p_month is null then
    raise exception 'Mes invalido';
  end if;

  perform pg_advisory_xact_lock(hashtext('monthly-closure:' || v_month::text));
  select * into v_before from public.monthly_closures where month = v_month;

  v_start := v_month::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_end := (v_month + interval '1 month') at time zone 'America/Argentina/Buenos_Aires';

  -- Un solo SELECT mantiene ventas, costos y gastos en el mismo snapshot,
  -- incluso si otra persona registra una venta mientras se hace el cierre.
  with month_sales as materialized (
    select s.id, s.total
    from public.sales s
    where s.archived_at is null and s.sold_at >= v_start and s.sold_at < v_end
  ), sales_totals as (
    select coalesce(sum(total), 0) as income, count(*) as sales_count from month_sales
  ), cost_totals as (
    select coalesce(sum(si.quantity * si.unit_cost), 0) as cost
    from public.sale_items si join month_sales s on s.id = si.sale_id
  ), expense_totals as (
    select coalesce(sum(e.amount), 0) as expense
    from public.expenses e
    where e.archived_at is null
      and e.category not in ('CompraMercaderia', 'Mercaderia')
      and e.expense_at >= v_start and e.expense_at < v_end
  )
  select jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'monthRevenue', s.income,
    'monthExpenses', e.expense,
    'monthMerchandiseCost', c.cost,
    'monthResult', s.income - e.expense - c.cost,
    'monthSalesCount', s.sales_count
  ) into v_summary
  from sales_totals s cross join cost_totals c cross join expense_totals e;

  insert into public.monthly_closures (month, summary, closed_at, closed_by)
  values (v_month, v_summary, now(), auth.uid())
  on conflict (month) do update set
    summary = excluded.summary,
    closed_at = excluded.closed_at,
    closed_by = excluded.closed_by,
    archived_at = null
  returning * into v_closure;

  perform public.add_audit_log(
    'monthly_closure', v_closure.id,
    case when v_before.id is null then 'create' else 'update' end,
    gen_random_uuid(),
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_closure),
    jsonb_build_object('source', 'save_monthly_closure')
  );
  return to_jsonb(v_closure);
end;
$$;

create or replace function public.archive_monthly_closure(p_closure_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_before public.monthly_closures%rowtype;
  v_closure public.monthly_closures%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;
  select month into v_month from public.monthly_closures where id = p_closure_id;
  if v_month is null then
    raise exception 'Cierre mensual inexistente';
  end if;
  perform pg_advisory_xact_lock(hashtext('monthly-closure:' || v_month::text));
  select * into v_before from public.monthly_closures where id = p_closure_id;
  if v_before.archived_at is not null then return; end if;

  update public.monthly_closures set archived_at = now()
  where id = p_closure_id returning * into v_closure;
  perform public.add_audit_log(
    'monthly_closure', v_closure.id, 'archive', gen_random_uuid(),
    to_jsonb(v_before), to_jsonb(v_closure),
    jsonb_build_object('source', 'archive_monthly_closure')
  );
end;
$$;

revoke all on function public.save_monthly_closure(date) from public, anon;
grant execute on function public.save_monthly_closure(date) to authenticated;
revoke all on function public.archive_monthly_closure(uuid) from public, anon;
grant execute on function public.archive_monthly_closure(uuid) to authenticated;

notify pgrst, 'reload schema';
