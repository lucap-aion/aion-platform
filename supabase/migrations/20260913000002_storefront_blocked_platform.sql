-- ==============================|| LOCKED OUT IS NOT EMPTY ||============================== --
-- storefront_sources.platform could say 'shopify', 'structured' or 'none', and 'none' was
-- carrying two very different answers: "we read this site and it publishes no catalogue",
-- and "this site would not let us read it".
--
-- damiani.com is the second kind. Every product page answers 403 to a plain request and
-- hands the renderer a Cloudflare "Just a moment…" challenge with a 200 — while its own
-- sitemap lists six hundred and forty-three product pages. Recording that as 'none' tells an
-- admin the house has nothing to sell. The true answer is that we are locked out, and the
-- next move is to ask the client for a feed rather than to conclude anything about them.
--
-- 'blocked' is deliberately NOT in the set sync-storefront reads (it takes 'shopify' and
-- 'structured' only), so this changes nothing about what runs — only about what is known.

alter table public.storefront_sources
  drop constraint if exists storefront_sources_platform_check;

alter table public.storefront_sources
  add constraint storefront_sources_platform_check
  check (platform = any (array['shopify'::text, 'structured'::text, 'none'::text, 'blocked'::text]));
