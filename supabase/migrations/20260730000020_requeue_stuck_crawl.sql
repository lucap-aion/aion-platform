-- A crawl item claimed by a worker that died stays claimed forever.
--
-- claim_crawl_batch marks rows 'processing' and the worker marks them done or
-- error. If the invocation dies in between — a redeploy, a timeout, an edge
-- restart — nobody ever puts them back. Two of Luisa Beccaria's pages sat in
-- 'processing' with no error and attempts=1, which meant the queue could never
-- reach empty: the assistant stage kept re-queueing waiting for a crawl that
-- was finished in every sense except the counter, and the health check stayed
-- red on "pages are queued but none finished".
--
-- Onboarding stages already have exactly this sweeper. The crawl queue, which
-- is far busier, did not.

create or replace function public.requeue_stuck_crawl_items(p_older_than interval default interval '15 minutes')
returns integer
language sql security definer set search_path = public as $$
  with stuck as (
    update public.knowledge_crawl_queue
       set status = 'pending', attempts = attempts + 1
     where status = 'processing'
       and enqueued_at < now() - p_older_than
       and attempts < 5
    returning 1
  ) select count(*)::int from stuck;
$$;

-- Anything that has burned its attempts is not coming back; mark it so it stops
-- holding the queue open and shows up in the failed list where someone can see it.
create or replace function public.fail_exhausted_crawl_items()
returns integer
language sql security definer set search_path = public as $$
  with dead as (
    update public.knowledge_crawl_queue
       set status = 'error',
           error = coalesce(error, 'abandoned — the worker stopped mid-page too many times')
     where status = 'processing'
       and enqueued_at < now() - interval '15 minutes'
       and attempts >= 5
    returning 1
  ) select count(*)::int from dead;
$$;

create or replace function public.knowledge_crawl_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_base text;
begin
  -- Recover before dispatching, so a stuck row is back in the queue by the time
  -- the worker asks for a batch.
  perform public.requeue_stuck_crawl_items();
  perform public.fail_exhausted_crawl_items();

  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;

  perform net.http_post(url := v_base || '/crawl-worker',
    headers := public.knowledge_functions_headers(),
    body := jsonb_build_object('limit', 8));
end $$;

grant execute on function public.requeue_stuck_crawl_items(interval) to service_role;
grant execute on function public.fail_exhausted_crawl_items() to service_role;
