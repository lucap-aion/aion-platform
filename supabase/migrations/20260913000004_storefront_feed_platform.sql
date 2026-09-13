-- ==============================|| A FEED THE HOUSE ALREADY PUBLISHES ||============================== --
-- Almost every brand selling online already produces a product feed — for Google Shopping,
-- for a marketplace, for retargeting. It is the same catalogue, maintained by them, in a
-- format built to be read by a machine, and asking for the URL is the least work a client
-- will ever be asked to do. After that it syncs on the tick with nobody involved.
--
-- It is also the honest answer to a site behind a bot wall: a firewall refusing us is not
-- the house refusing us, and the feed is the house actually answering.
--
-- 'feed' joins 'shopify' and 'structured' as a platform sync-storefront reads. The URL lives
-- in base_url like every other source — one field an admin pastes into, whatever it turns
-- out to be.

alter table public.storefront_sources
  drop constraint if exists storefront_sources_platform_check;

alter table public.storefront_sources
  add constraint storefront_sources_platform_check
  check (platform = any (array['shopify'::text, 'structured'::text, 'feed'::text, 'none'::text, 'blocked'::text]));
