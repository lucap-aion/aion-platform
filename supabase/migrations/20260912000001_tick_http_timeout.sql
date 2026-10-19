-- ==============================|| A QUEUED STAGE THAT NEVER STARTS ||============================== --
-- Every scheduled tick on this project dispatches work by calling an edge function through
-- net.http_post, and not one of them passed a timeout. pg_net's default is 5000 ms — and it
-- CANCELS the request when it expires.
--
-- A warm function answers in well under a second, so this looked fine. A cold one does not:
-- onboard-brand imports the brand-identity harvester, the product extractor, the Wikidata
-- enricher and the stage graph, and its first invocation after an idle spell needs longer
-- than five seconds just to boot. The gateway drops a request nobody is waiting for any
-- more, the function never runs a line, and the stage row is left exactly as it was —
-- 'pending' with queued_at set, attempts still 0, no error anywhere.
--
-- Which is the worst possible shape for a failure: the screen says "queued — it runs on the
-- server, you can close this and come back", the next tick tries again a minute later and
-- fails the same way, and nothing ever says so. Measured on dev on 2026-09-12: Pomellato's
-- branding stage was fired by the tick at 11:28, 11:29 and 11:30 and never started
-- (net._http_response: "Timeout of 5000 ms reached" each time). The identical call by hand
-- completed in 6.5 s, and once that had warmed the worker the queue drained one stage per
-- tick.
--
-- Twenty seconds is the fix, and it costs nothing:
--   * a cold boot plus a normal stage fits inside it, so the common case stops being a race
--   * a stage that runs LONGER than the timeout is unaffected — pg_net hanging up does not
--     kill an isolate that has already started (the documents stage has always taken two
--     minutes over a 5 s timeout and has always finished), and the 15-minute sweeper in
--     requeue_stuck_onboarding_stages still covers a run that really dies mid-flight
--   * 20 s < the 60 s between ticks, so requests cannot pile up generation on generation
--
-- The bodies below are the live definitions, verbatim, with one argument added to each
-- http_post. Nothing else about these functions changes.

-- ── The commercial cycle's engine ───────────────────────────────────────────────────────── --
create or replace function public.onboarding_tick()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $function$
declare v_base text; v_next record; v_headers jsonb;
begin
  perform public.requeue_stuck_onboarding_stages();

  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  v_headers := public.knowledge_functions_headers();

  -- Fire them all off; pg_net is async, so the tick returns immediately and the
  -- stages run concurrently in the functions runtime.
  for v_next in select * from public.next_onboarding_stages(8) loop
    perform net.http_post(
      url := v_base || '/onboard-brand',
      headers := v_headers,
      body := jsonb_build_object('action', 'run_queued', 'brand_id', v_next.brand_id, 'stage', v_next.stage),
      timeout_milliseconds := 20000);
  end loop;
end $function$;

-- ── The crawl behind step 3's knowledge, the documents and the assistant ────────────────── --
create or replace function public.knowledge_crawl_tick()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $function$
declare v_base text;
begin
  -- Recover before dispatching, so a stuck row is back in the queue by the time
  -- the worker asks for a batch.
  perform public.requeue_stuck_crawl_items();
  perform public.fail_exhausted_crawl_items();

  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;

  perform net.http_post(url := v_base || '/crawl-worker',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('limit', 8),
    timeout_milliseconds := 20000);
end $function$;

create or replace function public.knowledge_seed_weekly()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $function$
declare v_base text; r record;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  for r in select brand_id from public.knowledge_sources where kind = 'website' and enabled loop
    perform net.http_post(url := v_base || '/seed-crawl',
      headers := public.knowledge_functions_headers(),
      body := jsonb_build_object('brand_id', r.brand_id, 'max_pages', 500),
      timeout_milliseconds := 20000);
  end loop;
end $function$;

-- ── The catalogue the intro deck and the demo are built from ────────────────────────────── --
create or replace function public.storefront_sync_tick()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $function$
declare v_base text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  perform net.http_post(url := v_base || '/sync-storefront',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('max', 150),
    timeout_milliseconds := 20000);
end $function$;

create or replace function public.storefront_orders_tick()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $function$
declare
  v_base text;
  r      record;
begin
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;

  for r in
    select brand_id from public.storefront_connections
    where enabled and status = 'ok'
  loop
    perform net.http_post(
      url     := v_base || '/shopify-orders',
      -- Same headers as every other tick: the batch secret authorises us to the
      -- function, the Authorization header gets us past the gateway. Without
      -- the second one this fails as a silent 401 that pg_cron still reports as
      -- a success (see 20260730000012).
      headers := public.knowledge_functions_headers(),
      body    := jsonb_build_object('action', 'sync', 'brand_id', r.brand_id),
      timeout_milliseconds := 20000
    );
  end loop;
end $function$;
