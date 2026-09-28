-- Asegura que el costo estimado de productos sin costo cargado se calcule
-- desde el precio unitario del item, no desde descuentos o total final manual.

create or replace function public.create_sale(
  p_operation_id uuid,
  p_customer_id uuid,
  p_paid_amount numeric,
  p_payment_method text,
  p_manual_total numeric,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale_total numeric(12,2) := 0;
  v_paid numeric(12,2) := greatest(coalesce(p_paid_amount, 0), 0);
  v_item jsonb;
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_qty integer;
  v_unit_price numeric(12,2);
  v_unit_cost numeric(12,2);
  v_missing_cost_rate numeric(5,4) := coalesce((select missing_cost_fallback_rate from public.business_settings where id = 'main'), 0.5000);
  v_sale_item_id uuid;
  v_stock_after integer;
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select id into v_sale_id
  from public.sales
  where operation_id = p_operation_id;

  if v_sale_id is not null then
    return v_sale_id;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and archived_at is null
  ) then
    raise exception 'Cliente inexistente';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(coalesce((v_item->>'quantity')::integer, 0), 0);
    if v_qty <= 0 then
      raise exception 'Cantidad invalida';
    end if;
    v_unit_price := greatest(coalesce((v_item->>'unit_price')::numeric, 0), 0);
    v_sale_total := v_sale_total + (v_qty * v_unit_price);
  end loop;

  if p_manual_total is not null and p_manual_total >= 0 then
    v_sale_total := p_manual_total;
  end if;

  insert into public.sales (
    operation_id,
    customer_id,
    total,
    paid_amount,
    payment_status,
    payment_method,
    manual_total_enabled,
    notes,
    created_by
  )
  values (
    p_operation_id,
    p_customer_id,
    v_sale_total,
    least(v_paid, v_sale_total),
    case
      when least(v_paid, v_sale_total) >= v_sale_total then 'paid'
      when least(v_paid, v_sale_total) > 0 then 'partial'
      else 'unpaid'
    end,
    coalesce(p_payment_method, ''),
    p_manual_total is not null,
    coalesce(p_notes, ''),
    auth.uid()
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest((v_item->>'quantity')::integer, 0);
    v_unit_price := greatest(coalesce((v_item->>'unit_price')::numeric, 0), 0);

    v_variant := null;
    v_product := null;

    if nullif(v_item->>'variant_id', '') is not null then
      select * into v_variant
      from public.product_variants
      where id = (v_item->>'variant_id')::uuid
      for update;

      if v_variant.id is null or v_variant.archived_at is not null then
        raise exception 'Variante inexistente';
      end if;

      select * into v_product
      from public.products
      where id = v_variant.product_id
      for update;
    elsif nullif(v_item->>'product_id', '') is not null then
      select * into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
      for update;
    end if;

    if v_product.id is null then
      raise exception 'Producto inexistente';
    end if;

    if v_product.archived_at is not null then
      raise exception 'Producto archivado';
    end if;

    v_unit_cost := coalesce(
      nullif((v_item->>'unit_cost')::numeric, 0),
      nullif(v_product.cost, 0),
      round(v_unit_price * v_missing_cost_rate, 2)
    );

    insert into public.sale_items (
      sale_id,
      product_id,
      variant_id,
      product_name,
      sku,
      color,
      size,
      quantity,
      unit_price,
      unit_cost
    )
    values (
      v_sale_id,
      v_product.id,
      nullif(v_variant.id, '00000000-0000-0000-0000-000000000000'::uuid),
      v_product.name,
      coalesce(v_variant.sku, v_product.sku),
      v_product.color,
      coalesce(v_variant.size, ''),
      v_qty,
      v_unit_price,
      v_unit_cost
    )
    returning id into v_sale_item_id;

    if v_product.tracks_stock then
      if v_variant.id is null then
        raise exception 'El producto controla stock y requiere variante';
      end if;

      update public.product_variants
      set current_stock = current_stock - v_qty,
          updated_by = auth.uid()
      where id = v_variant.id
        and current_stock >= v_qty
      returning current_stock into v_stock_after;

      if v_stock_after is null then
        raise exception 'Stock insuficiente para % talle %', v_product.name, v_variant.size;
      end if;

      insert into public.stock_movements (
        operation_id,
        product_id,
        variant_id,
        sale_id,
        sale_item_id,
        movement_type,
        quantity_delta,
        stock_after,
        unit_cost,
        note,
        created_by
      )
      values (
        p_operation_id,
        v_product.id,
        v_variant.id,
        v_sale_id,
        v_sale_item_id,
        'sale',
        -v_qty,
        v_stock_after,
        v_unit_cost,
        'Venta local',
        auth.uid()
      );
    end if;
  end loop;

  if least(v_paid, v_sale_total) > 0 then
    insert into public.payments (
      operation_id,
      sale_id,
      customer_id,
      amount,
      method,
      note,
      created_by
    )
    values (
      gen_random_uuid(),
      v_sale_id,
      p_customer_id,
      least(v_paid, v_sale_total),
      coalesce(p_payment_method, ''),
      'Pago registrado al crear la venta',
      auth.uid()
    );
  end if;

  perform public.add_audit_log('sale', v_sale_id, 'create', p_operation_id, null, to_jsonb((select s from public.sales s where s.id = v_sale_id)), jsonb_build_object('items', p_items));
  return v_sale_id;
end;
$$;

revoke all on function public.create_sale(uuid, uuid, numeric, text, numeric, text, jsonb) from public, anon;
grant execute on function public.create_sale(uuid, uuid, numeric, text, numeric, text, jsonb) to authenticated;
