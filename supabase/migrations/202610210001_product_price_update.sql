-- Actualiza precios sobre toda la base, sin depender de paginas descargadas.
begin;

create or replace function public.get_product_price_update_preview(p_category text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text := nullif(btrim(p_category), '');
  v_count integer;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado para consultar precios.';
  end if;

  select count(*)::integer into v_count
  from public.products p
  left join public.product_categories c on c.id = p.category_id
  where p.archived_at is null
    and p.sku is distinct from 'MANUAL_INTERNAL'
    and (v_category is null or c.name = v_category);

  return jsonb_build_object('totalCount', v_count);
end;
$$;

create or replace function public.update_product_prices(
  p_operation_id uuid,
  p_percent numeric,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text := nullif(btrim(p_category), '');
  v_payload jsonb;
  v_previous public.audit_log%rowtype;
  v_before jsonb;
  v_products jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado para actualizar precios.';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id requerido.';
  end if;
  if p_percent is null or p_percent::text in ('NaN', 'Infinity', '-Infinity')
    or p_percent < -100 or p_percent = 0 then
    raise exception 'Porcentaje invalido: debe ser distinto de cero y mayor o igual a -100.';
  end if;

  v_payload := jsonb_build_object('category', v_category, 'percent', p_percent);
  perform pg_advisory_xact_lock(hashtextextended('product_prices:' || p_operation_id::text, 0));
  select * into v_previous
  from public.audit_log
  where entity_type = 'product_prices' and action = 'bulk_update'
    and operation_id = p_operation_id
  limit 1;
  if found then
    if v_previous.payload is distinct from v_payload or v_previous.user_id is distinct from auth.uid() then
      raise exception 'La operacion ya fue utilizada con otros parametros o usuario.';
    end if;
    return v_previous.after_data;
  end if;

  if v_category is not null and not exists (
    select 1 from public.product_categories where name = v_category and archived_at is null
  ) then
    raise exception 'Categoria invalida.';
  end if;

  -- Bloquear en orden estable evita perder aumentos concurrentes.
  with targets as materialized (
    select p.id, p.price
    from public.products p
    left join public.product_categories c on c.id = p.category_id
    where p.archived_at is null
      and p.sku is distinct from 'MANUAL_INTERNAL'
      and (v_category is null or c.name = v_category)
    order by p.id
    for update of p
  ), updated as (
    update public.products p
    set price = round(t.price * (1 + p_percent / 100), 0), updated_by = auth.uid()
    from targets t
    where p.id = t.id
    returning p.id, p.price, p.updated_at
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'price', price) order by id) from targets), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from updated u), '[]'::jsonb)
  into v_before, v_products;

  v_result := jsonb_build_object('updatedCount', jsonb_array_length(v_products), 'products', v_products);
  perform public.add_audit_log('product_prices', null, 'bulk_update', p_operation_id, v_before, v_result, v_payload);
  return v_result;
end;
$$;

revoke all on function public.get_product_price_update_preview(text) from public, anon;
revoke all on function public.update_product_prices(uuid, numeric, text) from public, anon;
grant execute on function public.get_product_price_update_preview(text) to authenticated;
grant execute on function public.update_product_prices(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
