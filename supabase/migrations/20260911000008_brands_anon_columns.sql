-- What an anonymous visitor may read off a brand (audit item 4).
--
-- `public: read brands by slug` grants row access to every brand with a slug,
-- to the `public` role — which includes anon. That is deliberate and needed:
-- the landing page lists the houses, and the tenant theming resolves a brand
-- from the URL before anyone signs in.
--
-- What was not deliberate is the column list, because RLS has none. Anyone
-- could ask for the house's contact email, its HQ address, and the activation
-- fee, insurance premium and AION premium fee it pays us — the commercial terms
-- of every client on the platform, readable with the key that ships in the
-- JavaScript bundle.
--
-- RLS can't express columns, but privileges can. anon keeps exactly the columns
-- the signed-out pages use: the brand's identity, its imagery, its theme and its
-- FAQs, plus name/status/slug/id because the landing page filters and orders on
-- them. Everything else now needs a session.
--
-- The client stopped asking for the rest first (f2a8ce7), and that bundle is
-- live on dev — checked before applying this, because doing it the other way
-- round returns 42501 to every visitor on the landing page.
--
-- NOT closed by this: a SIGNED-IN user of one brand can still read another
-- brand's commercial columns through the same wide policy, since column
-- privileges cannot tell an admin from a customer — they are both
-- `authenticated`. That needs the policy split behind a brands_public view, and
-- is its own change with its own client work.

revoke select on public.brands from anon;

grant select (
  -- identity, and the columns the landing page filters and sorts on
  id, slug, name, status, description, website,
  -- imagery and theme
  logo_big, logo_small, auth_background_image, top_banner_image, theme_settings,
  -- the public-facing help content
  faq_en, faq_it, faq_image, feedback_image, damage_image, theft_image
) on public.brands to anon;
