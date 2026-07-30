-- Make the background jobs survive a deploy that forgets --no-verify-jwt.
--
-- The three cron ticks posted only an x-batch-secret header. That works while
-- the target function has verify_jwt=false, and dies the moment anyone redeploys
-- it without that flag: the gateway rejects the call with 401
-- UNAUTHORIZED_NO_AUTH_HEADER before the function ever runs.
--
-- It fails SILENTLY, which is the real problem. pg_net swallows the response,
-- cron.job_run_details still reports "succeeded" because the SQL statement ran
-- fine, and the only symptom is a queue that stops draining. It cost a full
-- afternoon of a new brand sitting at 520 pending pages and 0 indexed.
--
-- So the ticks now send an Authorization header as well. The functions keep
-- checking the batch secret themselves — this only gets the request past the
-- gateway, so the verify_jwt flag stops mattering either way.
--
-- Requires a vault secret `functions_auth_token` holding a token the gateway
-- accepts (the anon key is enough — every one of these functions authorises the
-- CALLER separately via the batch secret). If it is absent the ticks behave
-- exactly as before, so this migration is safe to apply before the secret exists.

create or replace function public.knowledge_functions_headers()
returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'Content-Type', 'application/json',
    'x-batch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret'),
    'Authorization', (select 'Bearer ' || decrypted_secret from vault.decrypted_secrets where name = 'functions_auth_token')
  ));
$$;

create or replace function public.knowledge_crawl_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_base text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  perform net.http_post(url := v_base || '/crawl-worker',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('limit', 8));
end $$;

create or replace function public.knowledge_seed_weekly()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_base text; r record;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  for r in select brand_id from public.knowledge_sources where kind = 'website' and enabled loop
    perform net.http_post(url := v_base || '/seed-crawl',
      headers := public.knowledge_functions_headers(),
      body := jsonb_build_object('brand_id', r.brand_id, 'max_pages', 500));
  end loop;
end $$;

create or replace function public.storefront_sync_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_base text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  perform net.http_post(url := v_base || '/sync-storefront',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('max', 150));
end $$;

-- And make the silence audible: a view anything can check to see whether the
-- background jobs are actually landing.
create or replace view public.background_job_health as
select
  date_trunc('hour', r.created)                                  as hour,
  count(*)                                                       as calls,
  count(*) filter (where r.status_code between 200 and 299)      as ok,
  count(*) filter (where r.status_code >= 400)                   as failed,
  max(r.created) filter (where r.status_code >= 400)             as last_failure,
  (array_agg(left(r.content, 200) order by r.created desc)
     filter (where r.status_code >= 400))[1]                     as last_error
from net._http_response r
where r.created > now() - interval '48 hours'
group by 1
order by 1 desc;

grant select on public.background_job_health to service_role;
