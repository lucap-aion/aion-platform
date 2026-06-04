-- Two small follow-ups to the customer-side polish pass.
--
-- 1. customer_vault_summary gains `open_claims` so the Vault hero can
--    surface "1 open claim" at a glance without a second query.
-- 2. Index on ai_query_log (user_id, created_at desc) so the edge
--    function can cheaply check "how many requests has this user made
--    in the last 60 seconds?" before invoking Anthropic.

create or replace function public.customer_vault_summary(p_gallery_limit int default 6)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with all_pol as (
    select id, status, start_date, selling_price, item_id
    from public.policies
    where customer_id = public.get_my_profile_id()
  ),
  agg as (
    select
      count(*) filter (where status = 'live')::int        as live_count,
      count(*)::int                                       as all_count,
      coalesce(sum(selling_price) filter (where status = 'live'), 0)::numeric as protected_value,
      min(start_date)                                     as earliest_start
    from all_pol
  ),
  open_claims as (
    select count(*)::int as n
    from public.claims c
    join all_pol p on p.id = c.policy_id
    where c.status = 'open'
  ),
  categories as (
    select distinct btrim(coalesce(c.category, c.collection)) as category
    from all_pol p
    join public.catalogues c on c.id = p.item_id
    where p.status = 'live'
      and coalesce(c.category, c.collection) is not null
      and btrim(coalesce(c.category, c.collection)) <> ''
  ),
  gallery as (
    select p.id,
           p.status,
           c.picture,
           c.name
    from all_pol p
    left join public.catalogues c on c.id = p.item_id
    order by (p.status = 'live') desc,
             coalesce(p.start_date, current_date) desc
    limit greatest(coalesce(p_gallery_limit, 6), 1)
  )
  select jsonb_build_object(
    'live_count',      (select live_count from agg),
    'all_count',       (select all_count from agg),
    'protected_value', (select protected_value from agg),
    'earliest_start',  (select earliest_start from agg),
    'open_claims',     coalesce((select n from open_claims), 0),
    'categories',      coalesce((select jsonb_agg(category order by category) from categories), '[]'::jsonb),
    'gallery',         coalesce((
                         select jsonb_agg(
                           jsonb_build_object(
                             'id', id,
                             'status', status,
                             'picture', picture,
                             'name', name
                           )
                         ) from gallery
                       ), '[]'::jsonb)
  );
$$;

grant execute on function public.customer_vault_summary(int) to authenticated;

-- Fast index for the rate-limit lookup in query-ai. The existing
-- ai_query_log_created_at_idx supports the time-range scan but a per-user
-- count would otherwise filter through every row in the window.
create index if not exists ai_query_log_user_created_at_idx
  on public.ai_query_log (user_id, created_at desc);
