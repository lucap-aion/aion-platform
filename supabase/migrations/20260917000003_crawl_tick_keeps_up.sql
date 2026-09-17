-- Eight pages a minute, for the whole platform.
--
-- knowledge_crawl_tick fired ONE crawl-worker per minute with limit 8 and no brand. That is
-- the ceiling on every crawl AION runs: Prada's 546 pages took 80 minutes at a measured 5-9
-- pages a minute, and `documents` and `assistant` both sit and wait for it, so the brand
-- page reads "Working" for an hour and a half and gets reported as stuck. It was not stuck.
-- It was doing exactly what it was told, as fast as it was allowed.
--
-- Three things were wrong, and none of them is the fetching.
--
-- 1. The worker budgets 55 seconds of work (`deadline = Date.now() + 55_000`) and pg_net
--    was cancelling it at 20. It could never spend the budget it plans for, so a batch
--    larger than about eight never paid off.
--
-- 2. limit 8, against a worker that accepts 20 and a claim_crawl_batch that accepts 25.
--    Nothing needed the 8; it was just never raised.
--
-- 3. No brand_id, and the worker then picks a single brand for itself. With two houses
--    onboarding at once they do not get half each — they alternate by whichever row the
--    unordered `limit 1` happened to return, and both crawl at a crawl.
--
-- So: one worker PER BRAND with pending work, each allowed a real batch and enough time to
-- finish it. Per-brand throughput goes 8/min to 20/min, and brands stop starving each other.
--
-- Deliberately ONE worker per brand rather than several. The worker sleeps `politeGap`
-- between requests when a site's robots.txt names a crawl-delay, and that promise is only
-- kept while a brand's fetches are serial — two workers on one host would quietly double the
-- rate the house asked for. Parallelism across brands is free; parallelism within a brand is
-- not ours to take.
--
-- Four brands a tick because that is four concurrent function invocations a minute, and the
-- queue drains in order of who has the most left to do.
create or replace function public.knowledge_crawl_tick()
returns void
language plpgsql security definer set search_path = public as $$
declare v_base text; v_headers jsonb; v_brand bigint;
begin
  -- Recover before dispatching, so a stuck row is back in the queue by the time
  -- the worker asks for a batch.
  perform public.requeue_stuck_crawl_items();
  perform public.fail_exhausted_crawl_items();

  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_base is null then return; end if;
  v_headers := public.knowledge_functions_headers();

  for v_brand in
    select brand_id
      from public.knowledge_crawl_queue
     where status = 'pending'
     group by brand_id
     order by count(*) desc
     limit 4
  loop
    perform net.http_post(
      url := v_base || '/crawl-worker',
      headers := v_headers,
      body := jsonb_build_object('brand_id', v_brand, 'limit', 20),
      -- Longer than the worker's own 55s deadline, so it is the worker that decides when
      -- the batch is done rather than pg_net cutting it off mid-page.
      timeout_milliseconds := 60000);
  end loop;
end;
$$;

comment on function public.knowledge_crawl_tick() is
  'Fires one crawl-worker per brand with pending pages (max 4), batch 20, 60s. One worker per '
  'brand is deliberate: robots.txt crawl-delay is only honoured while a host''s fetches are serial.';
