-- Reading a catalogue off a non-Shopify storefront has to survive one invocation.
--
-- fetchStructured sorts the crawled URLs, then renders up to 25 of them through the
-- renderer in a single call. A luxury listing page takes ten to forty seconds to render, so
-- that is minutes of work inside a worker that gets a fraction of it — and the caller waits
-- on the whole thing, because the onboarding stage awaits the sync. Ferragamo's run died on
-- WORKER_RESOURCE_LIMIT after two and a half minutes with nothing written.
--
-- So the sync does a small batch and comes back. That needs somewhere to remember how far it
-- got, because the URL list is re-derived and re-sorted on every call: without a cursor,
-- each run would re-render the same first pages for ever and never reach the rest.
--
-- Wraps to 0 at the end of the list, which is what makes a re-sync pick up changes rather
-- than stopping once the catalogue has been read once.
alter table public.storefront_sources
  add column if not exists structured_cursor integer not null default 0;

comment on column public.storefront_sources.structured_cursor is
  'How far through the crawled-URL list the structured catalogue reader has got. Advances by the pages read each run and wraps at the end; meaningless for platform = shopify, which takes the whole feed in one request.';
