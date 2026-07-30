-- Onboarding runs in the background, and its progress outlives the browser tab.
--
-- Until now the admin's browser drove the sequence: it called the function once
-- per stage and waited. Two problems with that. Closing the tab or refreshing
-- mid-run abandoned every stage that hadn't started yet, and the person who
-- kicked it off was the only one who could see it happening — a colleague
-- opening the same brand saw a half-finished account with no indication that
-- anything was in flight.
--
-- Now the browser only QUEUES the work. A cron tick advances one stage per
-- minute, which also keeps every invocation well inside the edge runtime's wall
-- clock, and all progress lives in brand_onboarding — so a refresh, a different
-- laptop or a different admin all see the same live state.

alter table public.brand_onboarding
  add column if not exists queued_at timestamptz,
  add column if not exists attempts  integer not null default 0;

comment on column public.brand_onboarding.queued_at is
  'Set when a stage is queued to run in the background. Cleared when it finishes. A pending stage with queued_at set is waiting for the tick.';

create index if not exists brand_onboarding_queued_idx
  on public.brand_onboarding (queued_at) where queued_at is not null;

-- Queue a set of stages for a brand. Order is preserved by position so the tick
-- runs them in the sequence they were asked for.
create or replace function public.queue_onboarding_stages(
  p_brand_id bigint, p_stages text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s text; i integer := 0;
begin
  foreach s in array p_stages loop
    i := i + 1;
    insert into public.brand_onboarding (brand_id, stage, status, queued_at, detail, error, attempts, updated_at)
    values (p_brand_id, s, 'pending', now() + (i || ' milliseconds')::interval, '{}'::jsonb, null, 0, now())
    on conflict (brand_id, stage) do update set
      status = 'pending', queued_at = now() + (i || ' milliseconds')::interval,
      error = null, attempts = 0, finished_at = null, updated_at = now();
  end loop;
  return jsonb_build_object('ok', true, 'queued', p_stages);
end $$;

-- The next stage to run, oldest queue entry first. One at a time, so a slow
-- catalogue sync can never starve the tick.
create or replace function public.next_onboarding_stage()
returns table (brand_id bigint, stage text)
language sql security definer set search_path = public as $$
  select o.brand_id, o.stage
  from public.brand_onboarding o
  where o.queued_at is not null
    and o.status = 'pending'
    and o.attempts < 3
  order by o.queued_at
  limit 1;
$$;

-- A stage that dies mid-flight (function timeout, redeploy) would otherwise sit
-- in 'running' forever. Anything running for more than 15 minutes goes back in
-- the queue, up to three attempts.
create or replace function public.requeue_stuck_onboarding_stages()
returns integer language sql security definer set search_path = public as $$
  with stuck as (
    update public.brand_onboarding
       set status = 'pending', queued_at = now(), attempts = attempts + 1, updated_at = now()
     where status = 'running' and started_at < now() - interval '15 minutes' and attempts < 3
    returning 1
  ) select count(*)::int from stuck;
$$;

create or replace function public.onboarding_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_base text; v_next record;
begin
  perform public.requeue_stuck_onboarding_stages();

  select * into v_next from public.next_onboarding_stage();
  if v_next is null then return; end if;

  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;

  perform net.http_post(
    url := v_base || '/onboard-brand',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('action', 'run_queued', 'brand_id', v_next.brand_id, 'stage', v_next.stage));
end $$;

select cron.schedule('onboarding-tick', '* * * * *', $$select public.onboarding_tick();$$)
where not exists (select 1 from cron.job where jobname = 'onboarding-tick');

revoke all on function public.queue_onboarding_stages(bigint, text[]) from public, anon, authenticated;
grant execute on function public.queue_onboarding_stages(bigint, text[]) to service_role;
