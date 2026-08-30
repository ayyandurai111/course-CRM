-- Re-sync an existing user's avatar_url from their Google account on
-- every login, not just their very first one. Previously
-- get_or_create_user_profile() used `on conflict (id) do nothing`, so
-- a user's avatar_url was frozen forever at whatever it was the day
-- their profile row was first created — if they changed their Google
-- photo later, the Live Meeting camera-off tile (and anywhere else the
-- profile photo is shown) kept showing the old one.
--
-- Only avatar_url is ever touched here. role, is_active, name, and
-- created_at of an existing row are left completely alone (nothing
-- else uses `excluded.*`), so this cannot be used to silently
-- re-promote/demote or reactivate an account. The update only fires
-- when the newly-supplied avatar_url is non-null and actually
-- different from what's stored, so a login where the provider's photo
-- URL is briefly missing/rejected can never wipe out a previously
-- synced photo.
drop function if exists public.get_or_create_user_profile(uuid, text, text, text);
create or replace function public.get_or_create_user_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_avatar_url text,
  p_seed_admin_email text default null
) returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_role text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_seed_admin_email is not null
     and length(trim(p_seed_admin_email)) > 0
     and lower(trim(p_email)) = lower(trim(p_seed_admin_email)) then
    v_role := 'ADMIN';
  else
    v_role := 'STUDENT';
  end if;

  insert into public.users (id, email, name, avatar_url, role, is_active)
    values (p_user_id, coalesce(p_email, ''), coalesce(p_name, ''), p_avatar_url, v_role, true)
  on conflict (id) do update
    set avatar_url = excluded.avatar_url
    where excluded.avatar_url is not null
      and public.users.avatar_url is distinct from excluded.avatar_url;

  select * into v_user from public.users where id = p_user_id;
  return v_user;
end;
$$;

revoke execute on function public.get_or_create_user_profile(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_or_create_user_profile(uuid, text, text, text, text) to service_role;
