-- Add an owner role with full operational access but no admin/configuration access.
-- The frontend role id stays ASCII (`dueno`) while the UI displays "Dueño".

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (role in ('admin', 'dueno', 'local', 'web', 'taller', 'consulta'));

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('admin', 'dueno', 'local')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
