-- Fix recursive RLS checks on profile-based permission helpers.
-- Without SECURITY DEFINER, policies that call is_admin/is_active_staff can
-- query profiles and re-enter the profiles policies until Postgres hits the
-- stack depth limit.

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
      and p.role in ('admin', 'local')
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
