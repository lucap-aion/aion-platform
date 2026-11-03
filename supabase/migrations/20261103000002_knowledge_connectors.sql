-- Connected sources for the knowledge base: Google Drive and Shopify.
--
-- Until now a brand fed its knowledge base three ways: we crawl its public
-- site, it uploads files one at a time, or it pastes text. All three are
-- snapshots. The training manual on the house's Drive is revised in March and
-- the assistant keeps quoting January's; the returns policy changes in the
-- Shopify admin and nobody re-uploads it. A connected source is the brand's own
-- system of record, read on a schedule, so the knowledge follows it.
--
-- Both connectors reuse what already exists rather than adding a parallel set
-- of tables:
--   • knowledge_sources gains two kinds, 'gdrive' and 'shopify', and the sync
--     state they need (status, last error, schedule, a lock);
--   • brand_knowledge_docs gains the link back to the source item (source_id +
--     external_id + the item's own modified time), so a sync can tell new from
--     changed from unchanged without downloading anything, and can remove what
--     the brand removed at the source;
--   • Shopify's credential stays where the orders connector already keeps it
--     (storefront_connections + Vault). One install grants both.
--
-- Nothing here switches itself on. A source exists only once a brand master
-- (or an AION admin) has connected it through source-sync / shopify-oauth.

-- ── knowledge_sources: sync state ────────────────────────────────────────────
alter table public.knowledge_sources
  add column if not exists status          text not null default 'ok',
  add column if not exists last_error      text,
  add column if not exists last_synced_at  timestamptz,
  -- When the tick should next run this source. A run that stops on its time
  -- budget with work left sets it to now(), so a 400-file first backfill drains
  -- over a few ticks instead of waiting six hours per slice.
  add column if not exists next_sync_at    timestamptz,
  -- Two ticks must not sync one source at once (both would embed the same
  -- files). A run claims the source by setting this; a claim older than ten
  -- minutes is a run that died and may be taken over.
  add column if not exists sync_started_at timestamptz,
  add column if not exists items_indexed   integer not null default 0,
  -- What the source is called to a person: the Drive folder's name, the shop's.
  add column if not exists label           text,
  add column if not exists created_by      uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'knowledge_sources_status_check'
  ) then
    alter table public.knowledge_sources
      add constraint knowledge_sources_status_check
      check (status in ('ok', 'error', 'syncing'));
  end if;
end $$;

-- ── brand_knowledge_docs: where a synced doc came from ───────────────────────
-- Disconnecting a source forgets what it brought in: the brand took the folder
-- away, so the assistant should stop quoting it. Hence on delete cascade.
alter table public.brand_knowledge_docs
  add column if not exists source_id           uuid references public.knowledge_sources(id) on delete cascade,
  add column if not exists external_id         text,
  add column if not exists external_updated_at timestamptz;

create unique index if not exists brand_knowledge_docs_source_item_idx
  on public.brand_knowledge_docs (source_id, external_id)
  where source_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Brand masters may already UPDATE their sources (20260911000005). Connecting
-- and disconnecting go through source-sync with the service role, which checks
-- the same master gate, so a brand user never inserts or deletes rows here
-- directly — a source row is a promise that its credential works.

-- ── The tick ─────────────────────────────────────────────────────────────────
-- Every five minutes, dispatch up to four sources that are due. Due means
-- enabled, a connector kind, and next_sync_at reached (or never set). Website
-- and news keep their own weekly seed; this does not touch them.
--
-- A source in 'error' is NOT skipped: a failed run pushes its own next_sync_at
-- an hour out, so the commonest failure — the folder was un-shared, the app was
-- uninstalled — is retried hourly and clears itself the moment it is put right,
-- instead of waiting for someone to notice and press Sync.
-- 20 s timeout: see 20260912000001 — the 5 s default cancels a cold start and
-- the run silently never happens.
create or replace function public.knowledge_sources_tick()
returns void language plpgsql security definer set search_path = public, vault as $fn$
declare
  v_base text;
  r      record;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;

  for r in
    select id from public.knowledge_sources
     where kind in ('gdrive', 'shopify')
       and enabled
       and coalesce(next_sync_at, '-infinity'::timestamptz) <= now()
       and (sync_started_at is null or sync_started_at < now() - interval '10 minutes')
     order by next_sync_at nulls first
     limit 4
  loop
    perform net.http_post(
      url     := v_base || '/source-sync',
      headers := public.knowledge_functions_headers(),
      body    := jsonb_build_object('action', 'sync', 'source_id', r.id),
      timeout_milliseconds := 20000
    );
  end loop;
end $fn$;

revoke all on function public.knowledge_sources_tick() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'knowledge-sources-sync') then
    perform cron.unschedule('knowledge-sources-sync');
  end if;
  perform cron.schedule('knowledge-sources-sync', '*/5 * * * *', 'select public.knowledge_sources_tick();');
end $$;

-- ── Shopify: per-shop app credentials ────────────────────────────────────────
-- Since 2026-01-01 a merchant can no longer create the "custom app" whose
-- pasted Admin token the orders connector was written around. A shop now grants
-- access by installing an app over OAuth. A custom-distribution app installs
-- only on one shop (or one Plus organisation), so until AION has a public app
-- each house gets its own: the client id lives here, the secret in Vault. When
-- a brand has none, shopify-oauth falls back to the SHOPIFY_CLIENT_ID /
-- SHOPIFY_CLIENT_SECRET env pair — the public app, once there is one.
alter table public.storefront_connections
  add column if not exists client_id text;

create or replace function public.shopify_set_client_secret(p_brand_id integer, p_secret text)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $fn$
declare
  v_name text := 'shopify_client_secret_brand_' || p_brand_id;
  v_id   uuid;
begin
  if p_brand_id is null or coalesce(btrim(p_secret), '') = '' then
    raise exception 'brand_id and secret are required';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_secret, v_name, 'Shopify app client secret for brand ' || p_brand_id);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end $fn$;

create or replace function public.shopify_get_client_secret(p_brand_id integer)
returns text language sql security definer set search_path = public, vault, pg_temp as $fn$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'shopify_client_secret_brand_' || p_brand_id;
$fn$;

revoke all on function public.shopify_set_client_secret(integer, text) from public;
revoke all on function public.shopify_get_client_secret(integer) from public;
grant execute on function public.shopify_set_client_secret(integer, text) to service_role;
grant execute on function public.shopify_get_client_secret(integer) to service_role;
