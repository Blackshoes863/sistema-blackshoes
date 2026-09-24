-- Venta local completa desde PostgreSQL.
-- Reutiliza create_sale para mantener una sola logica transaccional y devuelve
-- la venta normalizada con cliente, items y pagos para actualizar la UI sin bajar toda la base.

create or replace function public.create_sale_complete(
  p_operation_id uuid,
  p_customer_id uuid,
  p_paid_amount numeric,
  p_payment_method text,
  p_manual_total numeric,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));

  v_sale_id := public.create_sale(
    p_operation_id,
    p_customer_id,
    p_paid_amount,
    p_payment_method,
    p_manual_total,
    p_notes,
    p_items
  );

  select to_jsonb(s)
    || jsonb_build_object(
      'customers', case when c.id is null then null else to_jsonb(c) end,
      'sale_items', coalesce((
        select jsonb_agg(to_jsonb(si) order by si.created_at, si.id)
        from public.sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.paid_at, p.created_at, p.id)
        from public.payments p
        where p.sale_id = s.id
      ), '[]'::jsonb)
    )
  into v_sale
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  where s.id = v_sale_id;

  if v_sale is null then
    raise exception 'Venta inexistente';
  end if;

  return v_sale;
end;
$$;

revoke all on function public.create_sale_complete(uuid, uuid, numeric, text, numeric, text, jsonb) from public, anon;
grant execute on function public.create_sale_complete(uuid, uuid, numeric, text, numeric, text, jsonb) to authenticated;
