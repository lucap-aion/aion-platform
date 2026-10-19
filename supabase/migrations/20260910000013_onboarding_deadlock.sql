-- A stage that dies mid-run could freeze a brand permanently.
--
-- `brand_onboarding.status` goes to 'running' before the work starts and is only moved off
-- it by the code that finishes. When an invocation is killed instead — the platform's wall
-- clock, an unbounded fetch, a deploy landing mid-run — nothing moves it, and the row stays
-- 'running' with no finished_at.
--
-- There is a sweeper for that, and it half worked:
--
--   requeue_stuck_onboarding_stages()  status='running' and started_at < now() - 15 min
--                                      and ATTEMPTS < 3  ->  back to pending
--
-- The `attempts < 3` cap is right — a stage that dies three times will die a fourth. What
-- is wrong is what happens next: the row is simply left 'running' for ever. And
-- next_onboarding_stages refuses to start ANY stage for a brand that has a running row:
--
--   and not exists (select 1 from brand_onboarding r
--                    where r.brand_id = o.brand_id and r.status = 'running')
--
-- so one exhausted stage freezes every other stage of that brand, for good, with nothing in
-- the UI to say why — the panel reads "Running now. It will land here when it finishes" and
-- disables the button that would retry it.
--
-- Ferragamo was two attempts from exactly that: its catalogue stage was being killed inside
-- detection on every run, before it could write even a storefront_sources row.

-- ── 1. Give up out loud, rather than holding the lock for ever ────────────────
create or replace function public.requeue_stuck_onboarding_stages()
returns integer language plpgsql security definer set search_path = public as $$
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
     where status = 'running'
       and started_at < now() - interval '15 minutes'
       and attempts >= 3
    returning 1
  ) select count(*)::int into v_failed from exhausted;

  return coalesce(v_requeued, 0) + coalesce(v_failed, 0);
end $$;

comment on function public.requeue_stuck_onboarding_stages() is
  'Recovers stages killed mid-run: re-queues those with attempts left, and fails the rest so the brand is never held by a row nothing will ever finish.';

-- ── 2. A stale claim must not hold the whole brand ───────────────────────────
-- Belt and braces alongside the change above: even if a row somehow stays 'running' past
-- the sweeper, it stops blocking its siblings once it is plainly dead. The guard still does
-- its real job — stages within a brand are ordered, and starting a second one while the
-- first is genuinely working would race it.
create or replace function public.next_onboarding_stages(p_limit integer default 8)
returns table (brand_id bigint, stage text)
language sql security definer set search_path = public as $$
  select o.brand_id, o.stage
  from (
    select o.*, row_number() over (partition by o.brand_id order by o.queued_at) as rn
    from public.brand_onboarding o
    where o.queued_at is not null
      and o.status = 'pending'
      and o.attempts < 3
      -- A brand already working keeps its slot: stages within a brand are ordered for a
      -- reason, and starting a second one would race it. A claim older than the sweeper's
      -- own patience is not "working", it is abandoned.
      and not exists (
        select 1 from public.brand_onboarding r
        where r.brand_id = o.brand_id
          and r.status = 'running'
          and r.started_at >= now() - interval '15 minutes')
  ) o
  where o.rn = 1
  order by o.queued_at
  limit greatest(1, p_limit);
$$;

revoke all on function public.next_onboarding_stages(integer) from public, anon;
grant execute on function public.next_onboarding_stages(integer) to service_role;
