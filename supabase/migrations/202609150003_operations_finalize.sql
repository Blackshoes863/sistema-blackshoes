-- BlackShoes operational helpers.
-- Ejecutar en el Supabase nuevo de BlackShoes despues de las migraciones anteriores.

create or replace function public.ensure_manual_product()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_category_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select id into v_product_id
  from public.products
  where sku = 'MANUAL_INTERNAL'
  limit 1;

  if v_product_id is not null then
    update public.products
    set archived_at = null,
        published = false,
        tracks_stock = false,
        updated_by = auth.uid()
    where id = v_product_id;
    return v_product_id;
  end if;

  select id into v_category_id
  from public.product_categories
  where slug = 'accesorios'
  limit 1;

  if v_category_id is null then
    insert into public.product_categories (name, slug, code, sort_order, created_by, updated_by)
    values ('Accesorios', 'accesorios', 'A', 10, auth.uid(), auth.uid())
    returning id into v_category_id;
  end if;

  insert into public.products (
    sku,
    slug,
    name,
    color,
    category_id,
    description,
    cost,
    margin_percent,
    price,
    promo_price,
    wholesale_price,
    tracks_stock,
    published,
    created_by,
    updated_by
  )
  values (
    'MANUAL_INTERNAL',
    'manual-interno',
    'Manual interno',
    '',
    v_category_id,
    'Producto interno para ventas manuales',
    null,
    0,
    0,
    0,
    0,
    false,
    false,
    auth.uid(),
    auth.uid()
  )
  returning id into v_product_id;

  return v_product_id;
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_stock_after integer;
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if v_sale.id is null then
    raise exception 'Venta inexistente';
  end if;

  if v_sale.archived_at is not null then
    return;
  end if;

  for v_item in
    select si.*, p.tracks_stock
    from public.sale_items si
    join public.products p on p.id = si.product_id
    where si.sale_id = p_sale_id
  loop
    if v_item.tracks_stock and v_item.variant_id is not null then
      update public.product_variants
      set current_stock = current_stock + v_item.quantity,
          updated_by = auth.uid()
      where id = v_item.variant_id
      returning current_stock into v_stock_after;

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
        gen_random_uuid(),
        v_item.product_id,
        v_item.variant_id,
        p_sale_id,
        v_item.id,
        'return',
        v_item.quantity,
        v_stock_after,
        v_item.unit_cost,
        'Venta anulada',
        auth.uid()
      );
    end if;
  end loop;

  update public.sales
  set archived_at = now()
  where id = p_sale_id;

  perform public.add_audit_log('sale', p_sale_id, 'cancel', gen_random_uuid(), to_jsonb(v_sale), null, '{}'::jsonb);
end;
$$;

create or replace function public.archive_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  update public.customers
  set archived_at = now(),
      updated_by = auth.uid()
  where id = p_customer_id
    and archived_at is null;
end;
$$;

create or replace function public.archive_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  update public.expenses
  set archived_at = now()
  where id = p_expense_id
    and archived_at is null;
end;
$$;

create or replace function public.archive_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  update public.products
  set archived_at = now(),
      published = false,
      updated_by = auth.uid()
  where id = p_product_id
    and archived_at is null;

  update public.product_variants
  set archived_at = now(),
      active = false,
      updated_by = auth.uid()
  where product_id = p_product_id
    and archived_at is null;

  update public.product_images
  set archived_at = now()
  where product_id = p_product_id
    and archived_at is null;
end;
$$;

grant execute on function public.ensure_manual_product() to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.archive_customer(uuid) to authenticated;
grant execute on function public.archive_expense(uuid) to authenticated;
grant execute on function public.archive_product(uuid) to authenticated;
