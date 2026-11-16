-- ==============================|| TELL THE PERSON WHO STARTED IT WHEN IT HAS FINISHED ||============================== --
--
-- Creating a brand starts ten stages that run for the better part of half an hour on the
-- cron tick. The admin who pressed the button was told "you can leave the page" and was
-- then told nothing else: the only way to learn the brand was ready — or that a stage had
-- failed, or what it wanted checked — was to keep the page open, or to ask someone who
-- could read brand_onboarding. On 2026-11-16 that is exactly what happened with Shaft.
--
-- A RUN is one press of "create" or "run everything", and it remembers who pressed it. The
-- tick, which already sees every way a stage can end (including the sweeper failing one
-- that stopped reporting, which never passes through the edge function), closes a run once
-- nothing of that brand is in flight and asks send-email to write to that person.

create table if not exists public.brand_onboarding_runs (
  id               uuid primary key default gen_random_uuid(),
  brand_id         bigint not null references public.brands(id) on delete cascade,
  started_by       uuid,
  started_by_email text not null,
  stages           text[] not null default '{}',
  started_at       timestamptz not null default now(),
  settled_at       timestamptz,
  notified_at      timestamptz,
  notice_error     text
);

-- One open run per brand: pressing "run everything" while a run is open joins it rather than
-- promising a second email about the same work.
create unique index if not exists brand_onboarding_runs_one_open
  on public.brand_onboarding_runs (brand_id) where settled_at is null;

alter table public.brand_onboarding_runs enable row level security;

-- Written only by the service role (onboard-brand, the tick, send-email). Admins read it.
drop policy if exists "brand_onboarding_runs: admin read" on public.brand_onboarding_runs;
create policy "brand_onboarding_runs: admin read" on public.brand_onboarding_runs
  for select using (public.get_my_role() = 'admin');


-- ── The sweeper could leave a stage queued for ever ───────────────────────────────────────
--
-- A stage killed mid-run is put back with attempts + 1 while attempts < 3, so the third
-- requeue leaves it 'pending', queued, at attempts = 3. next_onboarding_stages only takes
-- attempts < 3, and the "out of attempts" branch only looked at 'running' rows — so that
-- row was never picked and never failed, and its brand read as working indefinitely (and,
-- now, would never send its finish email). Fail those too.
create or replace function public.requeue_stuck_onboarding_stages()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_requeued integer; v_failed integer;
begin
  -- Still has attempts left: back into the queue, one attempt spent.
  with stuck as (
    update public.brand_onboarding
       set status = 'pending', queued_at = now(), attempts = attempts + 1, updated_at = now()
     where status = 'running'
       and started_at < now() - interval '15 minutes'
       and attempts < 3
    returning 1
  ) select count(*)::int into v_requeued from stuck;

  -- Out of attempts: FAIL it. The row leaves the queue, the brand is released, and the
  -- screen can say what happened instead of showing a spinner nobody can clear.
  with exhausted as (
    update public.brand_onboarding
       set status = 'failed', queued_at = null, finished_at = now(), updated_at = now(),
           error = coalesce(error,
             'stopped responding three times — each run was killed before it could report. '
             || 'Run it again from the pipeline panel, or check the site is reachable.')
     where ((status = 'running' and started_at < now() - interval '15 minutes')
            or (status = 'pending' and queued_at is not null))
       and attempts >= 3
    returning 1
  ) select count(*)::int into v_failed from exhausted;

  return coalesce(v_requeued, 0) + coalesce(v_failed, 0);
end $function$;


-- ── The tick closes finished runs ─────────────────────────────────────────────────────────
--
-- "Finished" = no stage of the brand holds a queue slot. queued_at stays set from the moment
-- a stage is queued until it lands (done, failed or skipped clear it; a stage re-queueing
-- itself between batches keeps it), so this cannot fire between two batches of a catalogue.
--
-- A run is also closed after six hours whatever it is doing, so a brand whose crawl never
-- drains still gets an email — one that says which stages are still going.
create or replace function public.onboarding_tick()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
declare v_base text; v_next record; v_run record; v_headers jsonb;
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

  -- Close what has finished and say so. The UPDATE is the claim: two overlapping ticks
  -- cannot both close the same run, so nobody gets the email twice.
  for v_run in
    update public.brand_onboarding_runs r
       set settled_at = now()
     where r.settled_at is null
       and r.started_at < now() - interval '1 minute'
       and (r.started_at < now() - interval '6 hours'
            or not exists (
              select 1 from public.brand_onboarding o
               where o.brand_id = r.brand_id
                 and (o.queued_at is not null or o.status = 'running')))
    returning r.id
  loop
    perform net.http_post(
      url := v_base || '/send-email',
      headers := v_headers,
      body := jsonb_build_object('type', 'onboarding_settled', 'data', jsonb_build_object('run_id', v_run.id)),
      timeout_milliseconds := 20000);
  end loop;
end $function$;
