-- Audit item 4, the signed-in half: any signed-in user — a customer of any house included —
-- could read every brand's commercial terms (activation fee, insurance premium, AION fee,
-- Chubb prefix, covered-value limits, legal entity). "public: read brands by slug" is
-- `using (slug is not null)` for role PUBLIC, and authenticated holds table-level SELECT, so
-- the anon column grants of 20260911000008 never applied to it.
--
-- Step 1 of 2 (additive; the deployed client is unaffected):
--   • brands_public — the 19 presentation columns of every brand with a slug, the same
--     rows the slug policy exposes today. Owned by postgres, so it reads past RLS by design:
--     it is the one thing a logged-out visitor, or a customer opening another house's
--     portal, needs. The tenant lookup, the landing page and the slug checks move to it.
--   • brands_guard_staff_updates — "brand: update own brand" let brand staff rewrite ANY
--     column of their own row through the API, fees and status included. Nothing in the app
--     asks for that (BrandSettings, unrouted, edits name and email). Staff may change the
--     contact fields below; everything else is AION's.
-- Step 2 (20261019000006, after the client reads the view) drops the slug policies.

create or replace view public.brands_public as
  select id, slug, name, status, description, website,
         logo_big, logo_small, auth_background_image, top_banner_image, theme_settings,
         faq_en, faq_it, faq_image, feedback_image, damage_image, theft_image,
         demo_assistant_only, assistant_enabled
  from public.brands
  where slug is not null and slug <> '';

revoke all on public.brands_public from public;
grant select on public.brands_public to anon, authenticated, service_role;

create or replace function public.brands_guard_staff_updates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable constant text[] := array['name', 'email', 'website', 'description',
                                    'hq_address', 'hq_city', 'hq_postcode', 'hq_country'];
begin
  -- Service role, cron and migrations carry no user; admins edit everything.
  if auth.uid() is null or public.get_my_role() = 'admin' then
    return new;
  end if;
  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'only AION can change a brand''s terms, status or settings'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.brands_guard_staff_updates() from public, anon, authenticated;

drop trigger if exists brands_guard_staff_updates on public.brands;
create trigger brands_guard_staff_updates
  before update on public.brands
  for each row execute function public.brands_guard_staff_updates();
