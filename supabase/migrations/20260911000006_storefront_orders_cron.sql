-- Pull Shopify orders on a schedule, for the brands that have said yes.
--
-- The connector shipped deliberately manual: an integration that has never met
-- a real shop should not be running unattended. It has since been exercised
-- against the live API as far as is possible without a store, so it gets its
-- tick — with the switch still doing the deciding.
--
-- The loop only visits connections that are BOTH enabled and 'ok'. A brand
-- part-way through setup, or one whose token has started failing, is skipped
-- here and not merely refused later, so a broken shop cannot spend an hourly
-- slot on a call that was always going to 401. With no connections at all —
-- which is today — this does nothing.
--
-- Hourly, at :20. Orders are a clienteling signal: an associate greeting a
-- client this afternoon wants the order she placed this morning, which is a
-- different expectation from the catalogue's weekly refresh. Each run reads at
-- most 20 pages and stores a cursor, so a first backfill drains over several
-- runs instead of timing out in one.

create or replace function public.storefront_orders_tick()
returns void language plpgsql security definer set search_path = public, vault as $fn$
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
      body    := jsonb_build_object('action', 'sync', 'brand_id', r.brand_id)
    );
  end loop;
end $fn$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'storefront-orders-sync') then
    perform cron.unschedule('storefront-orders-sync');
  end if;
  perform cron.schedule('storefront-orders-sync', '20 * * * *', 'select public.storefront_orders_tick();');
end $$;

-- No registration needed with background_job_health_check(): it watches
-- net._http_response for 4xx in the last 20 minutes, so these calls are already
-- covered by the cron_http_failures check.
