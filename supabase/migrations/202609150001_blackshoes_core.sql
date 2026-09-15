-- BlackShoes core schema.
-- Ejecutar solo en el Supabase nuevo de BlackShoes. No usar en Lupita original.
-- Principios:
-- - Navegar lee.
-- - Las acciones del usuario escriben registros puntuales.
-- - Ventas, pagos y stock se hacen con RPC transaccionales e idempotentes.
-- - El historial importante es append-only.
-- - El catalogo publico solo consume datos publicados.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'local' check (role in ('admin', 'local', 'consulta')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.business_settings (
  id text primary key default 'main' check (id = 'main'),
  business_name text not null default 'BlackShoes',
  whatsapp_number text not null default '+5493564621982',
  default_whatsapp_message text not null default 'Hola {businessName}, quiero consultar por este producto:',
  size_availability_mode text not null default 'show-unavailable' check (size_availability_mode in ('show-unavailable', 'hide-unavailable')),
  out_of_stock_product_mode text not null default 'show' check (out_of_stock_product_mode in ('show', 'hide')),
  missing_cost_fallback_rate numeric(5,4) not null default 0.5000 check (missing_cost_fallback_rate >= 0 and missing_cost_fallback_rate <= 1),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.business_settings (id)
values ('main')
on conflict (id) do nothing;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  code text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.product_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories(id),
  name text not null,
  slug text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (category_id, slug)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  slug text unique not null,
  name text not null,
  color text not null default '',
  category_id uuid references public.product_categories(id),
  subcategory_id uuid references public.product_subcategories(id),
  description text not null default '',
  cost numeric(12,2),
  margin_percent numeric(8,3) not null default 0,
  price numeric(12,2) not null default 0 check (price >= 0),
  promo_price numeric(12,2) not null default 0 check (promo_price >= 0),
  wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  tracks_stock boolean not null default true,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  size text not null,
  sku text unique,
  current_stock integer not null default 0 check (current_stock >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (product_id, size)
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  storage_path text not null,
  public_url text,
  alt_text text not null default '',
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dni text,
  phone text,
  city text,
  notes text not null default '',
  initial_debt numeric(12,2) not null default 0 check (initial_debt >= 0),
  initial_debt_note text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  local_order_number bigint generated by default as identity unique,
  customer_id uuid references public.customers(id),
  sold_at timestamptz not null default now(),
  total numeric(12,2) not null check (total >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('paid', 'partial', 'unpaid')),
  payment_method text not null default '',
  manual_total_enabled boolean not null default false,
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  product_id uuid references public.products(id),
  variant_id uuid references public.product_variants(id),
  product_name text not null,
  sku text,
  color text not null default '',
  size text not null default '',
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  sale_id uuid references public.sales(id),
  customer_id uuid references public.customers(id),
  paid_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  sale_id uuid references public.sales(id),
  sale_item_id uuid references public.sale_items(id),
  movement_type text not null check (movement_type in ('initial', 'purchase', 'sale', 'adjustment', 'return', 'gift')),
  quantity_delta integer not null check (quantity_delta <> 0),
  stock_after integer,
  unit_cost numeric(12,2),
  note text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (operation_id, variant_id, movement_type)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  expense_at timestamptz not null default now(),
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  operation_id uuid,
  before_data jsonb,
  after_data jsonb,
  payload jsonb not null default '{}'::jsonb,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated_at on public.product_categories;
create trigger trg_categories_updated_at before update on public.product_categories
for each row execute function public.set_updated_at();

drop trigger if exists trg_subcategories_updated_at on public.product_subcategories;
create trigger trg_subcategories_updated_at before update on public.product_subcategories
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_variants_updated_at on public.product_variants;
create trigger trg_variants_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();

create or replace function public.is_active_staff()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('admin', 'local')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'admin'
  );
$$;

create or replace function public.add_audit_log(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_operation_id uuid,
  p_before jsonb default null,
  p_after jsonb default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (
    entity_type,
    entity_id,
    action,
    operation_id,
    before_data,
    after_data,
    payload,
    user_id
  )
  values (
    p_entity_type,
    p_entity_id,
    p_action,
    p_operation_id,
    p_before,
    p_after,
    coalesce(p_payload, '{}'::jsonb),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

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
      round(v_unit_price * (select missing_cost_fallback_rate from public.business_settings where id = 'main'), 2)
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

create or replace function public.register_customer_payment(
  p_operation_id uuid,
  p_customer_id uuid,
  p_sale_id uuid,
  p_amount numeric,
  p_method text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_sale public.sales%rowtype;
  v_total_paid numeric(12,2);
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select id into v_payment_id
  from public.payments
  where operation_id = p_operation_id;

  if v_payment_id is not null then
    return v_payment_id;
  end if;

  if p_amount <= 0 then
    raise exception 'Importe invalido';
  end if;

  if p_sale_id is not null then
    select * into v_sale
    from public.sales
    where id = p_sale_id
    for update;

    if v_sale.id is null then
      raise exception 'Venta inexistente';
    end if;
  end if;

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
    p_operation_id,
    p_sale_id,
    coalesce(p_customer_id, v_sale.customer_id),
    p_amount,
    coalesce(p_method, ''),
    coalesce(p_note, ''),
    auth.uid()
  )
  returning id into v_payment_id;

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
    where id = p_sale_id;
  end if;

  perform public.add_audit_log('payment', v_payment_id, 'create', p_operation_id, null, to_jsonb((select p from public.payments p where p.id = v_payment_id)), '{}'::jsonb);
  return v_payment_id;
end;
$$;

create or replace function public.register_stock_movement(
  p_operation_id uuid,
  p_variant_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_unit_cost numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_variant public.product_variants%rowtype;
  v_stock_after integer;
  v_movement_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  select id into v_existing
  from public.stock_movements
  where operation_id = p_operation_id
    and variant_id = p_variant_id
    and movement_type = p_movement_type;

  if v_existing is not null then
    return v_existing;
  end if;

  if p_quantity_delta = 0 then
    raise exception 'Movimiento de stock invalido';
  end if;

  select * into v_variant
  from public.product_variants
  where id = p_variant_id
  for update;

  if v_variant.id is null then
    raise exception 'Variante inexistente';
  end if;

  update public.product_variants
  set current_stock = current_stock + p_quantity_delta,
      updated_by = auth.uid()
  where id = p_variant_id
    and current_stock + p_quantity_delta >= 0
  returning current_stock into v_stock_after;

  if v_stock_after is null then
    raise exception 'Stock insuficiente';
  end if;

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
    p_movement_type,
    p_quantity_delta,
    v_stock_after,
    p_unit_cost,
    coalesce(p_note, ''),
    auth.uid()
  )
  returning id into v_movement_id;

  perform public.add_audit_log('stock_movement', v_movement_id, p_movement_type, p_operation_id, null, to_jsonb((select m from public.stock_movements m where m.id = v_movement_id)), '{}'::jsonb);
  return v_movement_id;
end;
$$;

create or replace view public.catalog_products as
select
  p.id,
  p.sku as code,
  p.slug,
  p.name,
  p.description,
  p.color,
  c.name as category,
  sc.name as subcategory,
  p.price,
  p.promo_price,
  p.published,
  p.created_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'size', v.size,
      'available', v.current_stock > 0,
      'sort_order', v.sort_order
    ) order by v.sort_order, v.size)
    from public.product_variants v
    where v.product_id = p.id
      and v.active = true
      and v.archived_at is null
  ), '[]'::jsonb) as variants,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'url', coalesce(i.public_url, i.storage_path),
      'path', i.storage_path,
      'alt', i.alt_text,
      'is_primary', i.is_primary,
      'sort_order', i.sort_order
    ) order by i.is_primary desc, i.sort_order, i.created_at)
    from public.product_images i
    where i.product_id = p.id
      and i.archived_at is null
  ), '[]'::jsonb) as images
from public.products p
left join public.product_categories c on c.id = p.category_id
left join public.product_subcategories sc on sc.id = p.subcategory_id
where p.published = true
  and p.archived_at is null;

create index if not exists idx_profiles_active_role on public.profiles(active, role);
create index if not exists idx_product_categories_active_order on public.product_categories(active, sort_order, name);
create index if not exists idx_product_subcategories_category_order on public.product_subcategories(category_id, active, sort_order, name);
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_products_published_created on public.products(published, created_at desc);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_subcategory on public.products(subcategory_id);
create index if not exists idx_products_color on public.products(color);
create index if not exists idx_product_variants_product_size on public.product_variants(product_id, size);
create index if not exists idx_product_variants_stock on public.product_variants(product_id, current_stock);
create index if not exists idx_product_images_product_order on public.product_images(product_id, is_primary desc, sort_order);
create index if not exists idx_sales_customer on public.sales(customer_id, sold_at desc);
create index if not exists idx_sales_created_at on public.sales(sold_at desc);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_payments_customer on public.payments(customer_id, paid_at desc);
create index if not exists idx_payments_sale on public.payments(sale_id);
create index if not exists idx_stock_movements_variant_created on public.stock_movements(variant_id, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id, created_at desc);
create index if not exists idx_audit_log_operation on public.audit_log(operation_id);

alter table public.profiles enable row level security;
alter table public.business_settings enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_subcategories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

grant select on public.catalog_products to anon;
grant select on public.business_settings to anon;
grant select on public.product_categories to anon;
grant select on public.product_subcategories to anon;
grant execute on function public.create_sale(uuid, uuid, numeric, text, numeric, text, jsonb) to authenticated;
grant execute on function public.register_customer_payment(uuid, uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.register_stock_movement(uuid, uuid, integer, text, numeric, text) to authenticated;

create policy "profiles self read"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy "profiles admin update"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "profiles self insert pending"
on public.profiles for insert
to authenticated
with check (id = auth.uid() and active = false);

create policy "public reads business catalog settings"
on public.business_settings for select
to anon
using (id = 'main');

create policy "staff reads business settings"
on public.business_settings for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "admin updates business settings"
on public.business_settings for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "public reads active categories"
on public.product_categories for select
to anon
using (active = true and archived_at is null);

create policy "public reads active subcategories"
on public.product_subcategories for select
to anon
using (active = true and archived_at is null);

create policy "staff reads categories"
on public.product_categories for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff writes categories"
on public.product_categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "staff reads subcategories"
on public.product_subcategories for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff writes subcategories"
on public.product_subcategories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "staff reads products"
on public.products for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff inserts products"
on public.products for insert
to authenticated
with check (public.is_active_staff());

create policy "staff updates products"
on public.products for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

create policy "staff reads variants"
on public.product_variants for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff writes variants"
on public.product_variants for all
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

create policy "staff reads images"
on public.product_images for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff writes images"
on public.product_images for all
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

create policy "staff manages customers"
on public.customers for all
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

create policy "staff reads sales"
on public.sales for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff reads sale items"
on public.sale_items for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff reads payments"
on public.payments for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff reads stock movements"
on public.stock_movements for select
to authenticated
using (public.is_active_staff() or public.is_admin());

create policy "staff manages expenses"
on public.expenses for all
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

create policy "staff reads audit"
on public.audit_log for select
to authenticated
using (public.is_active_staff() or public.is_admin());

insert into public.product_categories (name, slug, code, sort_order)
values
  ('Accesorios', 'accesorios', 'A', 10),
  ('Camperas', 'camperas', 'C', 20),
  ('Conjuntos', 'conjuntos', 'J', 30),
  ('Hoodies', 'hoodies', 'H', 40),
  ('Pantalones', 'pantalones', 'P', 50),
  ('Remeras', 'remeras', 'R', 60),
  ('RompeVientos', 'rompevientos', 'V', 70),
  ('Shorts', 'shorts', 'S', 80),
  ('Zapatillas', 'zapatillas', 'Z', 90)
on conflict (slug) do nothing;

insert into public.product_subcategories (category_id, name, slug, sort_order)
select c.id, s.name, s.slug, s.sort_order
from public.product_categories c
cross join (
  values
    ('Deportivo', 'deportivo', 10),
    ('Urbano', 'urbano', 20)
) as s(name, slug, sort_order)
where c.slug <> 'accesorios'
on conflict (category_id, slug) do nothing;

insert into public.product_subcategories (category_id, name, slug, sort_order)
select c.id, s.name, s.slug, s.sort_order
from public.product_categories c
join (
  values
    ('Bijouterie', 'bijouterie', 10),
    ('Gorras', 'gorras', 20),
    ('Lentes', 'lentes', 30),
    ('Medias', 'medias', 40)
) as s(name, slug, sort_order) on true
where c.slug = 'accesorios'
on conflict (category_id, slug) do nothing;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public reads product images"
on storage.objects for select
to anon
using (bucket_id = 'product-images');

create policy "staff writes product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_active_staff());

create policy "staff updates product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_active_staff())
with check (bucket_id = 'product-images' and public.is_active_staff());

create policy "staff deletes product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_active_staff());
