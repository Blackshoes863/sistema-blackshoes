-- BlackShoes security hardening.
-- Ejecutar en el Supabase nuevo de BlackShoes despues de la migracion core.
-- Objetivo: anon solo puede leer lo necesario para catalogo publico.

revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all functions in schema public from anon;

revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all sequences in schema public from authenticated;
revoke all privileges on all functions in schema public from authenticated;

grant select on public.catalog_products to anon;
grant select on public.business_settings to anon;
grant select on public.product_categories to anon;
grant select on public.product_subcategories to anon;

grant select, insert, update on public.profiles to authenticated;
grant select, update on public.business_settings to authenticated;
grant select, insert, update on public.product_categories to authenticated;
grant select, insert, update on public.product_subcategories to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.product_variants to authenticated;
grant select, insert, update on public.product_images to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select on public.sales to authenticated;
grant select on public.sale_items to authenticated;
grant select on public.payments to authenticated;
grant select on public.stock_movements to authenticated;
grant select, insert, update on public.expenses to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.catalog_products to authenticated;

grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_sale(uuid, uuid, numeric, text, numeric, text, jsonb) to authenticated;
grant execute on function public.register_customer_payment(uuid, uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.register_stock_movement(uuid, uuid, integer, text, numeric, text) to authenticated;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on functions from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
