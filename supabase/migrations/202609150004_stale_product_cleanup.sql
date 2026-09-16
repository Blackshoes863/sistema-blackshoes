-- BlackShoes stale product cleanup.
-- Regla: si un producto queda sin stock y pasan 60 dias sin reposicion,
-- se archiva automaticamente y luego se eliminan sus imagenes de Storage
-- desde una Edge Function.

alter table public.products
  add column if not exists out_of_stock_since timestamptz,
  add column if not exists cleanup_deleted_at timestamptz;

create index if not exists idx_products_stale_cleanup
on public.products(out_of_stock_since)
where archived_at is null and cleanup_deleted_at is null;

create or replace function public.refresh_product_out_of_stock_since(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracks_stock boolean;
  v_active_variants integer;
  v_total_stock integer;
begin
  select p.tracks_stock
    into v_tracks_stock
  from public.products p
  where p.id = p_product_id
    and p.archived_at is null;

  if v_tracks_stock is distinct from true then
    update public.products
    set out_of_stock_since = null
    where id = p_product_id
      and out_of_stock_since is not null;
    return;
  end if;

  select
    count(*)::integer,
    coalesce(sum(v.current_stock), 0)::integer
    into v_active_variants, v_total_stock
  from public.product_variants v
  where v.product_id = p_product_id
    and v.active = true
    and v.archived_at is null;

  if v_active_variants > 0 and v_total_stock <= 0 then
    update public.products
    set out_of_stock_since = coalesce(out_of_stock_since, now())
    where id = p_product_id
      and out_of_stock_since is null;
  else
    update public.products
    set out_of_stock_since = null
    where id = p_product_id
      and out_of_stock_since is not null;
  end if;
end;
$$;

create or replace function public.product_variants_refresh_out_of_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_product_out_of_stock_since(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_product_variants_refresh_out_of_stock on public.product_variants;
create trigger trg_product_variants_refresh_out_of_stock
after insert or update of current_stock, active, archived_at or delete
on public.product_variants
for each row execute function public.product_variants_refresh_out_of_stock();

create or replace function public.products_refresh_out_of_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_product_out_of_stock_since(new.id);
  return new;
end;
$$;

drop trigger if exists trg_products_refresh_out_of_stock on public.products;
create trigger trg_products_refresh_out_of_stock
after update of tracks_stock, archived_at
on public.products
for each row execute function public.products_refresh_out_of_stock();

-- Inicializa el reloj de limpieza para productos que ya esten sin stock.
-- Arranca desde hoy para evitar borrados accidentales de productos existentes.
update public.products p
set out_of_stock_since = coalesce(p.out_of_stock_since, now())
where p.archived_at is null
  and p.tracks_stock = true
  and coalesce(p.sku, '') <> 'MANUAL_INTERNAL'
  and exists (
    select 1
    from public.product_variants v
    where v.product_id = p.id
      and v.active = true
      and v.archived_at is null
  )
  and not exists (
    select 1
    from public.product_variants v
    where v.product_id = p.id
      and v.active = true
      and v.archived_at is null
      and v.current_stock > 0
  );

create or replace function public.list_stale_out_of_stock_product_assets(p_days integer default 60)
returns table(product_id uuid, storage_paths text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    p.id as product_id,
    coalesce(
      array_agg(i.storage_path order by i.is_primary desc, i.sort_order, i.created_at)
        filter (where i.id is not null and i.archived_at is null),
      array[]::text[]
    ) as storage_paths
  from public.products p
  left join public.product_images i on i.product_id = p.id
  where p.archived_at is null
    and p.cleanup_deleted_at is null
    and p.tracks_stock = true
    and coalesce(p.sku, '') <> 'MANUAL_INTERNAL'
    and p.out_of_stock_since is not null
    and p.out_of_stock_since <= now() - make_interval(days => greatest(coalesce(p_days, 60), 1))
    and not exists (
      select 1
      from public.product_variants v
      where v.product_id = p.id
        and v.active = true
        and v.archived_at is null
        and v.current_stock > 0
    )
  group by p.id;
end;
$$;

create or replace function public.archive_stale_out_of_stock_products(p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived integer := 0;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return 0;
  end if;

  with archived_products as (
    update public.products p
    set archived_at = now(),
        published = false,
        cleanup_deleted_at = now()
    where p.id = any(p_product_ids)
      and p.archived_at is null
      and p.cleanup_deleted_at is null
      and p.tracks_stock = true
      and coalesce(p.sku, '') <> 'MANUAL_INTERNAL'
      and p.out_of_stock_since is not null
      and not exists (
        select 1
        from public.product_variants v
        where v.product_id = p.id
          and v.active = true
          and v.archived_at is null
          and v.current_stock > 0
      )
    returning p.id
  )
  select count(*)::integer into v_archived
  from archived_products;

  update public.product_variants v
  set archived_at = coalesce(v.archived_at, now()),
      active = false
  where v.product_id = any(p_product_ids)
    and v.archived_at is null;

  update public.product_images i
  set archived_at = coalesce(i.archived_at, now())
  where i.product_id = any(p_product_ids)
    and i.archived_at is null;

  return v_archived;
end;
$$;

revoke all on function public.refresh_product_out_of_stock_since(uuid) from public, anon, authenticated;
revoke all on function public.product_variants_refresh_out_of_stock() from public, anon, authenticated;
revoke all on function public.products_refresh_out_of_stock() from public, anon, authenticated;
revoke all on function public.list_stale_out_of_stock_product_assets(integer) from public, anon, authenticated;
revoke all on function public.archive_stale_out_of_stock_products(uuid[]) from public, anon, authenticated;

grant execute on function public.list_stale_out_of_stock_product_assets(integer) to service_role;
grant execute on function public.archive_stale_out_of_stock_products(uuid[]) to service_role;
