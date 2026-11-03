-- Whether a brand's staff get Discussions (threads, @mentions, the bell and the
-- notification emails). An AION admin switches it per brand: Admin → brand →
-- "Discussions". Same shape as assistant_enabled (20261019000002).
--
-- Default true: a house being onboarded gets the feature it is being shown.
-- Roberto Coin — the live programme, whose boutique staff did not ask for a new
-- screen — is off, so the promotion to prod changes nothing it sees.
--
-- The tenant lookup reads this through brands_public and runs for logged-out
-- visitors, so anon needs the column grant, and the view gains the column. The
-- view change is additive: apply THIS before the bundle that selects the column
-- ships, never after — the old bundle ignores an extra column, while the new one
-- against the old view would fail every brand lookup (42703).

alter table public.brands
  add column if not exists discussions_enabled boolean not null default true;

grant select (discussions_enabled) on public.brands to anon;

update public.brands set discussions_enabled = false where slug = 'rc';

-- `create or replace view` only appends, so the new column goes last.
create or replace view public.brands_public as
  select id, slug, name, status, description, website,
         logo_big, logo_small, auth_background_image, top_banner_image, theme_settings,
         faq_en, faq_it, faq_image, feedback_image, damage_image, theft_image,
         demo_assistant_only, assistant_enabled,
         coalesce(is_prospect, false) as is_prospect,
         discussions_enabled
  from public.brands
  where slug is not null and slug <> '';

-- Off means off in the database too, not only a hidden sidebar entry: staff of a
-- brand with the switch off can neither read nor write threads, messages or
-- follows (every staff policy goes through this function). AION admins keep
-- their companion policy, so a thread is never lost by switching off.
create or replace function public.is_brand_staff(p_brand_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_brand_id is not null
     and public.get_my_brand_id() = p_brand_id
     and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
     and coalesce((select b.discussions_enabled from public.brands b where b.id = p_brand_id), false)
$$;

-- (A trigger guarding this column from the house's own staff was added here and
-- removed by 20261103000004: brands_guard_staff_updates already refuses any staff
-- change outside the house's editable fields.)
