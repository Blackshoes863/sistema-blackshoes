-- Cambia la limpieza automatica de productos sin stock de 60 a 30 dias.

create or replace function public.list_stale_out_of_stock_product_assets(p_days integer default 30)
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
    and p.out_of_stock_since <= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
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

revoke all on function public.list_stale_out_of_stock_product_assets(integer) from public, anon, authenticated;
grant execute on function public.list_stale_out_of_stock_product_assets(integer) to service_role;
