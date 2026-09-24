-- Guarda producto + variantes + referencias de imagenes en una sola transaccion.
-- El frontend sube los archivos a Storage y esta RPC deja atomicas las filas finales.

create or replace function public.save_product_with_assets(
  p_operation_id uuid,
  p_product_id uuid,
  p_product jsonb,
  p_variants jsonb default '[]'::jsonb,
  p_images jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_slug text;
  v_sku text;
  v_category_id uuid;
  v_subcategory_id uuid;
  v_tracks_stock boolean;
  v_user_id uuid := auth.uid();
  v_variant jsonb;
  v_variant_size text;
  v_variant_stock integer;
  v_variant_sort integer;
  v_active_variant_keys text[] := array[]::text[];
  v_image jsonb;
  v_image_storage_path text;
  v_image_public_url text;
  v_image_alt_text text;
  v_image_sort integer;
begin
  if v_user_id is null or not public.is_active_staff() then
    raise exception 'No autorizado para guardar productos.';
  end if;

  if p_operation_id is null then
    raise exception 'operation_id requerido.';
  end if;

  if p_product_id is null then
    raise exception 'product_id requerido.';
  end if;

  v_product_id := p_product_id;
  v_sku := nullif(trim(p_product->>'sku'), '');
  v_slug := nullif(trim(p_product->>'slug'), '');
  v_category_id := nullif(p_product->>'category_id', '')::uuid;
  v_subcategory_id := nullif(p_product->>'subcategory_id', '')::uuid;
  v_tracks_stock := coalesce((p_product->>'tracks_stock')::boolean, true);

  if v_slug is null then
    raise exception 'slug requerido.';
  end if;

  if nullif(trim(p_product->>'name'), '') is null then
    raise exception 'nombre de producto requerido.';
  end if;

  if not exists (
    select 1
    from public.product_categories c
    where c.id = v_category_id
      and c.archived_at is null
      and c.active = true
  ) then
    raise exception 'categoria invalida.';
  end if;

  if v_subcategory_id is not null and not exists (
    select 1
    from public.product_subcategories s
    where s.id = v_subcategory_id
      and s.category_id = v_category_id
      and s.archived_at is null
      and s.active = true
  ) then
    raise exception 'subcategoria invalida.';
  end if;

  select to_jsonb(p)
    into v_before
  from public.products p
  where p.id = v_product_id;

  insert into public.products (
    id,
    sku,
    slug,
    name,
    color,
    category_id,
    subcategory_id,
    description,
    cost,
    margin_percent,
    price,
    promo_price,
    wholesale_price,
    tracks_stock,
    published,
    created_by,
    updated_by,
    archived_at
  )
  values (
    v_product_id,
    v_sku,
    v_slug,
    trim(p_product->>'name'),
    coalesce(p_product->>'color', ''),
    v_category_id,
    v_subcategory_id,
    coalesce(p_product->>'description', ''),
    nullif(p_product->>'cost', '')::numeric,
    coalesce(nullif(p_product->>'margin_percent', '')::numeric, 0),
    coalesce(nullif(p_product->>'price', '')::numeric, 0),
    coalesce(nullif(p_product->>'promo_price', '')::numeric, 0),
    coalesce(nullif(p_product->>'wholesale_price', '')::numeric, 0),
    v_tracks_stock,
    coalesce((p_product->>'published')::boolean, false),
    v_user_id,
    v_user_id,
    null
  )
  on conflict (id) do update
  set
    sku = excluded.sku,
    slug = excluded.slug,
    name = excluded.name,
    color = excluded.color,
    category_id = excluded.category_id,
    subcategory_id = excluded.subcategory_id,
    description = excluded.description,
    cost = excluded.cost,
    margin_percent = excluded.margin_percent,
    price = excluded.price,
    promo_price = excluded.promo_price,
    wholesale_price = excluded.wholesale_price,
    tracks_stock = excluded.tracks_stock,
    published = excluded.published,
    updated_by = v_user_id,
    archived_at = null;

  if v_tracks_stock then
    for v_variant in select * from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
    loop
      v_variant_size := nullif(trim(v_variant->>'size'), '');
      if v_variant_size is null then
        continue;
      end if;

      v_variant_stock := greatest(coalesce(nullif(v_variant->>'stock', '')::integer, 0), 0);
      v_variant_sort := coalesce(nullif(v_variant->>'sort_order', '')::integer, array_length(v_active_variant_keys, 1) + 1, 1);
      v_active_variant_keys := array_append(v_active_variant_keys, lower(v_variant_size));

      insert into public.product_variants (
        product_id,
        size,
        current_stock,
        active,
        sort_order,
        created_by,
        updated_by,
        archived_at
      )
      values (
        v_product_id,
        v_variant_size,
        v_variant_stock,
        true,
        v_variant_sort,
        v_user_id,
        v_user_id,
        null
      )
      on conflict (product_id, size) do update
      set
        current_stock = excluded.current_stock,
        active = true,
        sort_order = excluded.sort_order,
        updated_by = v_user_id,
        archived_at = null;
    end loop;
  end if;

  update public.product_variants
  set
    active = false,
    archived_at = now(),
    updated_by = v_user_id
  where product_id = v_product_id
    and archived_at is null
    and (
      v_tracks_stock = false
      or not (lower(size) = any(v_active_variant_keys))
    );

  update public.product_images
  set archived_at = now()
  where product_id = v_product_id
    and archived_at is null;

  for v_image in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
  loop
    v_image_storage_path := nullif(trim(v_image->>'storage_path'), '');
    v_image_public_url := nullif(trim(v_image->>'public_url'), '');
    v_image_alt_text := coalesce(v_image->>'alt_text', trim(p_product->>'name'));
    v_image_sort := coalesce(nullif(v_image->>'sort_order', '')::integer, 1);

    if v_image_storage_path is null and v_image_public_url is null then
      continue;
    end if;

    insert into public.product_images (
      product_id,
      storage_path,
      public_url,
      alt_text,
      is_primary,
      sort_order,
      created_by
    )
    values (
      v_product_id,
      coalesce(v_image_storage_path, v_image_public_url),
      coalesce(v_image_public_url, v_image_storage_path),
      v_image_alt_text,
      v_image_sort = 1,
      v_image_sort,
      v_user_id
    );
  end loop;

  perform public.refresh_product_out_of_stock_since(v_product_id);

  select to_jsonb(p)
    into v_after
  from public.products p
  where p.id = v_product_id;

  perform public.add_audit_log(
    'product',
    v_product_id,
    case when v_before is null then 'create' else 'update' end,
    p_operation_id,
    v_before,
    v_after,
    jsonb_build_object('variants', p_variants, 'images', p_images)
  );

  return jsonb_build_object(
    'id', v_product_id,
    'slug', v_slug,
    'imageUrls',
      coalesce(
        (
          select jsonb_agg(coalesce(i.public_url, i.storage_path) order by i.is_primary desc, i.sort_order)
          from public.product_images i
          where i.product_id = v_product_id
            and i.archived_at is null
        ),
        '[]'::jsonb
      )
  );
end;
$$;

revoke all on function public.save_product_with_assets(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_product_with_assets(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
