-- Pago de deuda completo desde PostgreSQL.
-- Valida deuda pendiente, respeta la fecha elegida y devuelve pago + cliente + venta actualizados.

create or replace function public.register_customer_payment_complete(
  p_operation_id uuid,
  p_customer_id uuid,
  p_sale_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_payment public.payments%rowtype;
  v_sale public.sales%rowtype;
  v_customer public.customers%rowtype;
  v_customer_id uuid;
  v_total_paid numeric(12,2) := 0;
  v_outstanding numeric(12,2) := 0;
  v_sale_json jsonb := null;
  v_customer_json jsonb := null;
  v_payment_json jsonb := null;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if p_operation_id is null then
    raise exception 'Operacion invalida';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_operation_id::text));

  select * into v_payment
  from public.payments
  where operation_id = p_operation_id;

  if v_payment.id is not null then
    v_payment_id := v_payment.id;
    v_customer_id := v_payment.customer_id;
  else
    if coalesce(p_amount, 0) <= 0 then
      raise exception 'Importe invalido';
    end if;

    if p_sale_id is not null then
      select * into v_sale
      from public.sales
      where id = p_sale_id
      for update;

      if v_sale.id is null or v_sale.archived_at is not null then
        raise exception 'Venta inexistente';
      end if;

      v_customer_id := coalesce(v_sale.customer_id, p_customer_id);
      if v_customer_id is null then
        raise exception 'La venta no tiene cliente asociado';
      end if;

      select coalesce(sum(amount), 0)
      into v_total_paid
      from public.payments
      where sale_id = p_sale_id;

      v_outstanding := greatest(v_sale.total - v_total_paid, 0);
    else
      v_customer_id := p_customer_id;
      if v_customer_id is null then
        raise exception 'Cliente inexistente';
      end if;

      select * into v_customer
      from public.customers
      where id = v_customer_id
      for update;

      if v_customer.id is null or v_customer.archived_at is not null then
        raise exception 'Cliente inexistente';
      end if;

      select coalesce(sum(amount), 0)
      into v_total_paid
      from public.payments
      where sale_id is null
        and customer_id = v_customer_id;

      v_outstanding := greatest(v_customer.initial_debt - v_total_paid, 0);
    end if;

    if p_amount > v_outstanding then
      raise exception 'El pago supera la deuda pendiente';
    end if;

    insert into public.payments (
      operation_id,
      sale_id,
      customer_id,
      paid_at,
      amount,
      method,
      note,
      created_by
    )
    values (
      p_operation_id,
      p_sale_id,
      v_customer_id,
      coalesce(p_paid_at, now()),
      p_amount,
      coalesce(p_method, ''),
      coalesce(p_note, ''),
      auth.uid()
    )
    returning * into v_payment;

    v_payment_id := v_payment.id;

    if p_sale_id is not null then
      select coalesce(sum(amount), 0)
      into v_total_paid
      from public.payments
      where sale_id = p_sale_id;

      update public.sales
      set paid_amount = least(v_total_paid, total),
          payment_status = case
            when least(v_total_paid, total) >= total then 'paid'
            when least(v_total_paid, total) > 0 then 'partial'
            else 'unpaid'
          end
      where id = p_sale_id
      returning * into v_sale;
    end if;

    perform public.add_audit_log(
      'payment',
      v_payment_id,
      'create',
      p_operation_id,
      null,
      to_jsonb(v_payment),
      jsonb_build_object('source', 'register_customer_payment_complete')
    );
  end if;

  if v_customer_id is null and v_payment.customer_id is not null then
    v_customer_id := v_payment.customer_id;
  end if;

  if p_sale_id is not null or v_payment.sale_id is not null then
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
    into v_sale_json
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = coalesce(p_sale_id, v_payment.sale_id);
  end if;

  select to_jsonb(c)
    || jsonb_build_object(
      'initial_payments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'paid_at', p.paid_at,
            'amount', p.amount,
            'method', p.method,
            'note', p.note,
            'created_at', p.created_at
          )
          order by p.paid_at desc, p.created_at desc, p.id
        )
        from public.payments p
        where p.sale_id is null
          and p.customer_id = c.id
      ), '[]'::jsonb),
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
  into v_customer_json
  from public.customers c
  left join (
    select
      s.customer_id,
      count(*)::integer as sales_count,
      coalesce(sum(s.total), 0) as total_amount,
      max((s.sold_at at time zone 'America/Argentina/Buenos_Aires')::date)::text as last_sale_date,
      coalesce(sum(greatest(s.total - s.paid_amount, 0)), 0) as sale_debt
    from public.sales s
    where s.archived_at is null
      and s.customer_id = v_customer_id
    group by s.customer_id
  ) ss on ss.customer_id = c.id
  left join (
    select
      p.customer_id,
      coalesce(sum(p.amount), 0) as paid_amount
    from public.payments p
    where p.sale_id is null
      and p.customer_id = v_customer_id
    group by p.customer_id
  ) ips on ips.customer_id = c.id
  where c.id = v_customer_id;

  select to_jsonb(p)
  into v_payment_json
  from public.payments p
  where p.id = v_payment_id;

  return jsonb_build_object(
    'payment', v_payment_json,
    'sale', v_sale_json,
    'customer', v_customer_json
  );
end;
$$;

revoke all on function public.register_customer_payment_complete(uuid, uuid, uuid, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.register_customer_payment_complete(uuid, uuid, uuid, numeric, text, text, timestamptz) to authenticated;
