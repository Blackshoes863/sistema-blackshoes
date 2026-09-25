-- Operaciones atomicas de gastos y mercaderia.
-- register_expense guarda con operation_id idempotente.
-- archive_expense queda redeclarada para asegurar que exista en bases ya migradas parcialmente.

create or replace function public.register_expense(
  p_operation_id uuid,
  p_expense_at timestamptz,
  p_category text,
  p_amount numeric,
  p_payment_method text default '',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if p_operation_id is null then
    raise exception 'Operacion invalida';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Importe invalido';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));

  select * into v_expense
  from public.expenses
  where operation_id = p_operation_id;

  if v_expense.id is null then
    insert into public.expenses (
      operation_id,
      expense_at,
      category,
      amount,
      payment_method,
      note,
      created_by
    )
    values (
      p_operation_id,
      coalesce(p_expense_at, now()),
      coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Otros'),
      p_amount,
      coalesce(p_payment_method, ''),
      coalesce(p_note, ''),
      auth.uid()
    )
    returning * into v_expense;

    perform public.add_audit_log(
      'expense',
      v_expense.id,
      'create',
      p_operation_id,
      null,
      to_jsonb(v_expense),
      jsonb_build_object('source', 'register_expense')
    );
  end if;

  return to_jsonb(v_expense);
end;
$$;

create or replace function public.archive_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  update public.expenses
  set archived_at = coalesce(archived_at, now())
  where id = p_expense_id
  returning * into v_expense;

  if v_expense.id is null then
    raise exception 'Gasto inexistente';
  end if;

  perform public.add_audit_log(
    'expense',
    v_expense.id,
    'archive',
    gen_random_uuid(),
    null,
    to_jsonb(v_expense),
    jsonb_build_object('source', 'archive_expense')
  );
end;
$$;

revoke all on function public.register_expense(uuid, timestamptz, text, numeric, text, text) from public, anon;
grant execute on function public.register_expense(uuid, timestamptz, text, numeric, text, text) to authenticated;

revoke all on function public.archive_expense(uuid) from public, anon;
grant execute on function public.archive_expense(uuid) to authenticated;
