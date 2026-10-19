-- Keep the visual-search index fresh: a daily tick asks index-catalogue-images
-- to embed any new/changed catalogue photos (idempotent — already-embedded,
-- unchanged items are skipped). Reuses the crawl pipeline's Vault secrets:
--   knowledge_batch_secret  — shared batch secret (also the function's env)
--   knowledge_functions_base — https://<ref>.supabase.co/functions/v1
-- Without those secrets the tick safely no-ops.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.catalogue_image_index_tick()
returns void language plpgsql security definer as $fn$
declare v_secret text; v_base text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_secret is null or v_base is null then return; end if;
  perform net.http_post(
    url := v_base || '/index-catalogue-images',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-secret', v_secret),
    body := jsonb_build_object('max', 200)
  );
end $fn$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'catalogue-image-index') then
    perform cron.unschedule('catalogue-image-index');
  end if;
  perform cron.schedule('catalogue-image-index', '15 4 * * *', 'select public.catalogue_image_index_tick();');
end $$;
