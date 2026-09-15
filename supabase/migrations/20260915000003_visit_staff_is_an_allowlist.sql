-- is_brand_staff was a denylist, and the data does not cooperate.
--
-- 20260915000001 defined staff as "a profile of this brand whose role is not
-- 'customer'", reasoning that the brand's own clients are profiles too and must
-- not read the floor's notes about them. That is the right intent and the wrong
-- test: generate_brand_demo_data inserts every client it creates with role
-- NULL, not 'customer' (20260730000005, line 171), and coalesce(NULL,'') is not
-- 'customer'. So every generated client of every demo brand passed as staff —
-- on DEV that was forty Prada clients who could have read, written and edited
-- the visit notes of the boutique that served them.
--
-- Nothing had been written yet when this was caught, so no note was exposed.
--
-- The fix is the shape, not the value: staff is an ALLOWLIST of the roles that
-- actually work here. 'brand' is what every real brand profile carries;
-- brand_admin and brand_user are kept because policies across this schema still
-- name them (see 20260911000005 for what happens when only one vocabulary is
-- honoured). A client — role 'customer', role NULL, or anything else — is not
-- staff, and a role nobody has yet is not staff either, which is the direction
-- an access test should fail in.

create or replace function public.is_brand_staff(p_brand_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = public.get_my_profile_id()
      and p.brand_id = p_brand_id
      and p.role in ('brand', 'brand_admin', 'brand_user')
  );
$$;

-- The master delete policy carried the same denylist inline.
drop policy if exists "store_visits: master delete" on public.store_visits;
create policy "store_visits: master delete"
  on public.store_visits for delete to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = store_visits.brand_id
        and p.role in ('brand', 'brand_admin', 'brand_user')
        and p.is_master
    )
  );
