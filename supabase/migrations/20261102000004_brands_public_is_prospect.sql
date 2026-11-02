-- The public brand picker (src/pages/LandingPage.tsx) hides prospects since 2026-11-02 by
-- filtering on is_prospect — but it reads brands_public, and the view listed its columns
-- by hand without that one. PostgREST answered 42703 "column does not exist", the page
-- swallowed the error, and app.aioncover.com/all showed "No brands available" to every
-- visitor. The view now carries is_prospect, coalesced so a house that was never marked
-- either way counts as a client and stays in the picker.
--
-- `create or replace view` only lets a column be appended, so it goes last.

create or replace view public.brands_public as
  select id, slug, name, status, description, website,
         logo_big, logo_small, auth_background_image, top_banner_image, theme_settings,
         faq_en, faq_it, faq_image, feedback_image, damage_image, theft_image,
         demo_assistant_only, assistant_enabled,
         coalesce(is_prospect, false) as is_prospect
  from public.brands
  where slug is not null and slug <> '';
