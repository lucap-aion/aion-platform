-- Autonomous knowledge crawl scheduling: drain the queue continuously and
-- re-seed weekly. Secrets (batch secret + functions base URL) come from Vault,
-- so this migration carries no credentials. Per environment, set:
--   select vault.create_secret('<batch-secret>', 'knowledge_batch_secret');
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'knowledge_functions_base');
-- Without those secrets the functions safely no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drain tick: ask the worker to process a small batch (worker auto-picks the
-- brand with the most pending URLs).
create or replace function public.knowledge_crawl_tick()
returns void language plpgsql security definer as $fn$
declare v_secret text; v_base text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_secret is null or v_base is null then return; end if;
  perform net.http_post(
    url := v_base || '/crawl-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-secret', v_secret),
    body := jsonb_build_object('limit', 8)
  );
end $fn$;

-- Weekly re-seed: refresh the queue for every enabled website source.
create or replace function public.knowledge_seed_weekly()
returns void language plpgsql security definer as $fn$
declare v_secret text; v_base text; r record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_secret is null or v_base is null then return; end if;
  for r in select brand_id from public.knowledge_sources where kind = 'website' and enabled loop
    perform net.http_post(
      url := v_base || '/seed-crawl',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-secret', v_secret),
      body := jsonb_build_object('brand_id', r.brand_id, 'max_pages', 500)
    );
  end loop;
end $fn$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'knowledge-crawl-tick') then perform cron.unschedule('knowledge-crawl-tick'); end if;
  if exists (select 1 from cron.job where jobname = 'knowledge-seed-weekly') then perform cron.unschedule('knowledge-seed-weekly'); end if;
  perform cron.schedule('knowledge-crawl-tick', '* * * * *', 'select public.knowledge_crawl_tick();');
  perform cron.schedule('knowledge-seed-weekly', '0 3 * * 1', 'select public.knowledge_seed_weekly();');
end $$;
