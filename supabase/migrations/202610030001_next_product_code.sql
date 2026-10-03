-- Genera el proximo codigo de producto desde PostgreSQL.
-- Usa toda la tabla products, no solo la pagina cargada en el navegador.

create or replace function public.get_next_product_code(
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
  v_used text[];
  v_index integer;
  v_code text;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'No autorizado';
  end if;

  if v_prefix = '' then
    v_prefix := 'X';
  end if;

  select coalesce(array_agg(upper(coalesce(sku, ''))), array[]::text[])
    into v_used
  from public.products
  where coalesce(sku, '') <> '';

  for v_index in 1..999 loop
    v_code := v_prefix || lpad(v_index::text, 3, '0');
    if not (v_code = any(v_used)) then
      return v_code;
    end if;
  end loop;

  return v_prefix || to_char(floor(extract(epoch from clock_timestamp()))::bigint % 10000, 'FM0000');
end;
$$;

revoke all on function public.get_next_product_code(text) from public, anon;
grant execute on function public.get_next_product_code(text) to authenticated;
