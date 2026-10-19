-- Weekly full storefront refresh: re-ingest the brand's e-commerce range
-- (new/removed products, price changes) and embed any new/changed images.
-- Supersedes the catalogue-based image index + price sync (storefront_products
-- is the full range with clean photos and prices), so those ticks are retired.
-- Reuses the crawl pipeline's Vault secrets; no-ops without them.

create or replace function public.storefront_sync_tick()
returns void language plpgsql security definer as $fn$
declare v_secret text; v_base text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_secret is null or v_base is null then return; end if;
  perform net.http_post(
    url := v_base || '/sync-storefront',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-secret', v_secret),
    body := jsonb_build_object('max', 150)
  );
end $fn$;

do $$
begin
  -- Retire the superseded catalogue-based ticks.
  if exists (select 1 from cron.job where jobname = 'catalogue-image-index') then
    perform cron.unschedule('catalogue-image-index');
  end if;
  if exists (select 1 from cron.job where jobname = 'catalogue-price-sync') then
    perform cron.unschedule('catalogue-price-sync');
  end if;
  -- Schedule the storefront refresh (Mondays 05:00).
  if exists (select 1 from cron.job where jobname = 'storefront-sync') then
    perform cron.unschedule('storefront-sync');
  end if;
  perform cron.schedule('storefront-sync', '0 5 * * 1', 'select public.storefront_sync_tick();');
end $$;
