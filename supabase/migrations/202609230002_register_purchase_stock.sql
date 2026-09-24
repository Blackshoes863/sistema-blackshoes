-- Registra una reposicion de mercaderia de forma atomica:
-- suma stock, guarda movimiento, registra gasto de compra y actualiza costo/precio opcional.

create or replace function public.register_purchase_stock(
  p_operation_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_unit_cost numeric default 0,
  p_stock_note text default '',
  p_expense_at timestamptz default now(),
  p_expense_note text default '',
  p_payment_method text default '',
  p_update_product_cost boolean default false,
  p_next_cost numeric default null,
  p_next_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant public.product_variants%rowtype;
  v_existing_movement_id uuid;
  v_existing_expense_id uuid;
  v_movement_id uuid;
  v_expense_id uuid;
  v_stock_after integer;
  v_unit_cost numeric := greatest(coalesce(p_unit_cost, 0), 0);
  v_expense_amount numeric;
  v_product_before jsonb;
  v_product_after jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id requerido';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad de reposicion invalida';
  end if;

  select *
    into v_variant
  from public.product_variants
  where id = p_variant_id
    and active = true
    and archived_at is null
  for update;

  if v_variant.id is null then
    raise exception 'Variante inexistente o archivada';
  end if;

  select id
    into v_existing_movement_id
  from public.stock_movements
  where operation_id = p_operation_id
    and variant_id = p_variant_id
    and movement_type = 'purchase';

  select id
    into v_existing_expense_id
  from public.expenses
  where operation_id = p_operation_id
    and archived_at is null;

  if v_existing_movement_id is null then
    update public.product_variants
    set current_stock = current_stock + p_quantity,
        updated_by = auth.uid()
    where id = p_variant_id
    returning current_stock into v_stock_after;

    insert into public.stock_movements (
      operation_id,
      product_id,
      variant_id,
      movement_type,
      quantity_delta,
      stock_after,
      unit_cost,
      note,
      created_by
    )
    values (
      p_operation_id,
      v_variant.product_id,
      p_variant_id,
      'purchase',
      p_quantity,
      v_stock_after,
      v_unit_cost,
      coalesce(p_stock_note, ''),
      auth.uid()
    )
    returning id into v_movement_id;

    perform public.add_audit_log(
      'stock_movement',
      v_movement_id,
      'purchase',
      p_operation_id,
      null,
      to_jsonb((select m from public.stock_movements m where m.id = v_movement_id)),
      '{}'::jsonb
    );
  else
    v_movement_id := v_existing_movement_id;

    select stock_after
      into v_stock_after
    from public.stock_movements
    where id = v_movement_id;
  end if;

  if p_update_product_cost and p_next_cost is not null then
    select to_jsonb(p)
      into v_product_before
    from public.products p
    where p.id = v_variant.product_id;

    update public.products
    set cost = greatest(p_next_cost, 0),
        price = case
          when p_next_price is null then price
          else greatest(p_next_price, 0)
        end,
        updated_by = auth.uid()
    where id = v_variant.product_id;

    select to_jsonb(p)
      into v_product_after
    from public.products p
    where p.id = v_variant.product_id;

    if v_product_before is distinct from v_product_after then
      perform public.add_audit_log(
        'product',
        v_variant.product_id,
        'update_cost',
        p_operation_id,
        v_product_before,
        v_product_after,
        jsonb_build_object('source', 'register_purchase_stock')
      );
    end if;
  end if;

  v_expense_amount := round(v_unit_cost * p_quantity);

  if v_expense_amount > 0 then
    if v_existing_expense_id is null then
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
        'CompraMercaderia',
        v_expense_amount,
        coalesce(p_payment_method, ''),
        coalesce(nullif(p_expense_note, ''), coalesce(p_stock_note, '')),
        auth.uid()
      )
      returning id into v_expense_id;

      perform public.add_audit_log(
        'expense',
        v_expense_id,
        'create',
        p_operation_id,
        null,
        to_jsonb((select e from public.expenses e where e.id = v_expense_id)),
        jsonb_build_object('source', 'register_purchase_stock', 'stock_movement_id', v_movement_id)
      );
    else
      v_expense_id := v_existing_expense_id;
    end if;
  end if;

  return jsonb_build_object(
    'movementId', v_movement_id,
    'expenseId', v_expense_id,
    'stockAfter', v_stock_after,
    'expenseAmount', v_expense_amount
  );
end;
$$;

revoke all on function public.register_purchase_stock(uuid, uuid, integer, numeric, text, timestamptz, text, text, boolean, numeric, numeric) from public, anon;
grant execute on function public.register_purchase_stock(uuid, uuid, integer, numeric, text, timestamptz, text, text, boolean, numeric, numeric) to authenticated;
