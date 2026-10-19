-- Audit item 6: the sign-in checks answered questions about any email, to anyone.
--
-- check_brand_eligibility(email, brand) and check_admin_eligibility(email) ran BEFORE the
-- password, for anon, so a stranger could ask "is this person a Roberto Coin client?" or
-- "is this address an AION admin?" and get a straight answer. For a luxury house the first
-- is the sensitive one: a client list is the asset.
--
-- Step 1 of 2 (additive; the deployed client keeps working):
--   • check_my_brand_access / check_my_admin_access — the same answers, about the caller
--     only. The portals now sign in on a throwaway client first and ask these with that
--     session, so the question costs a correct password.
--   • check_admin_invitation — admin registration still has to ask before an account
--     exists; it now learns only "this address has a pending admin invite".
--   • check_brand_invitation — signup has to ask before an account exists too. It no longer
--     tells "registered" from "never heard of you"; both are 'none'. A pending invitation
--     is still visible — closing that needs a token in the invitation link, and the
--     invitation is sent by the house's own system, not by AION.
-- Step 2 (20261019000008, after the client): the two email-taking checks lose anon.

create or replace function public.check_my_brand_access(p_brand_id integer)
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when exists (select 1 from public.admins a
                 where a.user_id = auth.uid() or lower(a.email) = lower(auth.email())) then 'is_admin'
    when not exists (select 1 from public.profiles p
                     where p.brand_id = p_brand_id
                       and (p.user_id = auth.uid() or lower(p.email) = lower(auth.email()))) then 'wrong_brand'
    when exists (select 1 from public.profiles p
                 where p.brand_id = p_brand_id and p.status = 'pending'
                   and (p.user_id = auth.uid() or lower(p.email) = lower(auth.email()))) then 'unconfirmed'
    else 'ok'
  end
$$;

create or replace function public.check_my_admin_access()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when not exists (select 1 from public.admins a
                     where a.user_id = auth.uid() or lower(a.email) = lower(auth.email())) then 'not_admin'
    when exists (select 1 from public.admins a
                 where (a.user_id = auth.uid() or lower(a.email) = lower(auth.email()))
                   and a.status = 'pending') then 'unconfirmed'
    else 'ok'
  end
$$;

create or replace function public.check_admin_invitation(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.admins a
                 where lower(a.email) = lower(btrim(p_email)) and a.status = 'pending') then 'invited'
    else 'none'
  end
$$;

create or replace function public.check_brand_invitation(p_email text, p_brand_id integer)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles
                 where email = p_email and brand_id = p_brand_id and user_id is null) then 'invited'
    else 'none'
  end
$$;

revoke all on function public.check_my_brand_access(integer) from public, anon;
revoke all on function public.check_my_admin_access() from public, anon;
grant execute on function public.check_my_brand_access(integer) to authenticated, service_role;
grant execute on function public.check_my_admin_access() to authenticated, service_role;
revoke all on function public.check_admin_invitation(text) from public;
grant execute on function public.check_admin_invitation(text) to anon, authenticated, service_role;
