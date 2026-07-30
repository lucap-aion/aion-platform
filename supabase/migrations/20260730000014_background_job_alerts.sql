-- Make silent background failure impossible to miss.
--
-- Both of today's worst bugs were invisible: the crawl cron returned 401 on
-- every run for hours while cron.job_run_details reported "succeeded", and the
-- catalogue sync reported success while embedding zero images. Neither surfaced
-- anywhere a human would look, and each was found only by someone going to
-- check something else.
--
-- A view nobody reads is not monitoring. This adds one function that answers
-- "is the machinery healthy right now?" in a single call, and a cron job that
-- writes a row when it isn't — so the failure has somewhere to appear.

create table if not exists public.background_job_incidents (
  id          bigserial primary key,
  kind        text not null,          -- cron_http_failures | crawl_stalled | embeddings_stalled | onboarding_stuck
  detail      jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists background_job_incidents_open_idx
  on public.background_job_incidents (kind) where resolved_at is null;

alter table public.background_job_incidents enable row level security;
grant select on public.background_job_incidents to authenticated;
grant all    on public.background_job_incidents to service_role;

drop policy if exists "admin: read incidents" on public.background_job_incidents;
create policy "admin: read incidents" on public.background_job_incidents for select to authenticated
  using (public.get_my_role() = 'admin');

-- One call, one answer. Each check is something that actually went wrong today.
create or replace function public.background_job_health_check()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_http_failures  integer;
  v_http_last      text;
  v_crawl_pending  integer;
  v_crawl_progress integer;
  v_embed_missing  integer;
  v_stuck          integer;
  v_problems       jsonb := '[]'::jsonb;
begin
  -- 1. The gateway rejecting our own cron calls (the 401 class).
  select count(*), (array_agg(left(coalesce(content, ''), 160) order by created desc))[1]
    into v_http_failures, v_http_last
  from net._http_response
  where created > now() - interval '20 minutes' and status_code >= 400;

  if coalesce(v_http_failures, 0) > 3 then
    v_problems := v_problems || jsonb_build_object(
      'kind', 'cron_http_failures', 'count', v_http_failures, 'last_error', v_http_last,
      'meaning', 'the scheduled jobs are being rejected before they run — check verify_jwt and the vault secrets');
  end if;

  -- 2. A crawl queue that is not moving.
  select count(*) into v_crawl_pending
  from public.knowledge_crawl_queue where status in ('pending', 'processing');

  select count(*) into v_crawl_progress
  from public.knowledge_crawl_queue
  where status = 'done' and processed_at > now() - interval '20 minutes';

  if coalesce(v_crawl_pending, 0) > 0 and coalesce(v_crawl_progress, 0) = 0 then
    v_problems := v_problems || jsonb_build_object(
      'kind', 'crawl_stalled', 'pending', v_crawl_pending,
      'meaning', 'pages are queued but none finished in the last 20 minutes');
  end if;

  -- 3. Products with an image and no embedding — visual search silently
  --    degraded, which is exactly how the resize bug hid.
  select count(*) into v_embed_missing
  from public.storefront_products
  where image_url is not null and image_embedding is null;

  if coalesce(v_embed_missing, 0) > 50 then
    v_problems := v_problems || jsonb_build_object(
      'kind', 'embeddings_stalled', 'missing', v_embed_missing,
      'meaning', 'products have images but no embedding — visual search is partially blind');
  end if;

  -- 4. An onboarding stage wedged in 'running'.
  select count(*) into v_stuck
  from public.brand_onboarding
  where status = 'running' and started_at < now() - interval '30 minutes';

  if coalesce(v_stuck, 0) > 0 then
    v_problems := v_problems || jsonb_build_object(
      'kind', 'onboarding_stuck', 'stages', v_stuck,
      'meaning', 'an onboarding stage has been running for over 30 minutes');
  end if;

  return jsonb_build_object(
    'healthy', jsonb_array_length(v_problems) = 0,
    'checked_at', now(),
    'problems', v_problems,
    'counters', jsonb_build_object(
      'http_failures_20m', coalesce(v_http_failures, 0),
      'crawl_pending', coalesce(v_crawl_pending, 0),
      'crawl_done_20m', coalesce(v_crawl_progress, 0),
      'products_missing_embedding', coalesce(v_embed_missing, 0),
      'onboarding_stuck', coalesce(v_stuck, 0)));
end $$;

-- Record a problem once, and close it when it clears, so the table reads as a
-- history of outages rather than a row every ten minutes.
create or replace function public.background_job_watch()
returns void language plpgsql security definer set search_path = public as $$
declare v_health jsonb; p jsonb; v_open text[];
begin
  v_health := public.background_job_health_check();

  select coalesce(array_agg(kind), '{}') into v_open
  from public.background_job_incidents where resolved_at is null;

  for p in select * from jsonb_array_elements(v_health->'problems') loop
    if not ((p->>'kind') = any(v_open)) then
      insert into public.background_job_incidents (kind, detail) values (p->>'kind', p);
    end if;
  end loop;

  update public.background_job_incidents
     set resolved_at = now()
   where resolved_at is null
     and kind not in (select jsonb_array_elements(v_health->'problems')->>'kind');
end $$;

select cron.schedule('background-job-watch', '*/10 * * * *', $$select public.background_job_watch();$$)
where not exists (select 1 from cron.job where jobname = 'background-job-watch');

revoke all on function public.background_job_watch() from public, anon, authenticated;
grant execute on function public.background_job_health_check() to service_role;
grant execute on function public.background_job_watch() to service_role;
