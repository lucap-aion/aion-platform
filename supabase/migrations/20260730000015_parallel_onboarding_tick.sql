-- One brand should not wait behind another.
--
-- The tick ran a single stage per minute across the WHOLE platform. Serial
-- within a brand is correct — the stages depend on each other — but serial
-- ACROSS brands means onboarding two prospects at once makes each take twice as
-- long, and a catalogue sync re-queueing itself every minute for a large
-- retailer starves everyone else behind it. At four brands nobody notices. At
-- thirty it is a queue, and the symptom ("onboarding is slow") looks like a
-- performance problem rather than a scheduling one.
--
-- The fix is not more infrastructure. It is dispatching one stage PER BRAND per
-- tick instead of one in total: brands advance in parallel, each brand's own
-- stages still run in order, and nothing else about the design changes.

-- The oldest queued stage for EACH brand — the head of each brand's own queue.
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
      -- A brand already working keeps its slot: stages within a brand are
      -- ordered for a reason, and starting a second one would race it.
      and not exists (
        select 1 from public.brand_onboarding r
        where r.brand_id = o.brand_id and r.status = 'running')
  ) o
  where o.rn = 1
  order by o.queued_at
  limit greatest(1, p_limit);
$$;

create or replace function public.onboarding_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
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
      body := jsonb_build_object('action', 'run_queued', 'brand_id', v_next.brand_id, 'stage', v_next.stage));
  end loop;
end $$;

-- The old single-row helper is no longer used by the tick; keep it working for
-- anything that calls it directly rather than dropping it out from under them.
create or replace function public.next_onboarding_stage()
returns table (brand_id bigint, stage text)
language sql security definer set search_path = public as $$
  select * from public.next_onboarding_stages(1);
$$;
