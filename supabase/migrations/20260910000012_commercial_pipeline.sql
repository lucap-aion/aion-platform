-- Where every deal stands, in one read.
--
-- brand_commercial_progress has recorded step, state, date and note per brand
-- since the cycle shipped, and nothing has ever aggregated it. The cycle screen
-- answers "where is Pasquale Bruni" only if you already knew to open Pasquale
-- Bruni; the question the job actually asks — "where are all of them, and what
-- do I owe anyone this week" — had no screen at all. The commercial nav items
-- were removed when the cycle moved onto the brand page, so it also had no door.
--
-- This is the read behind that door. One row per brand: the step it is on, how
-- long since anyone touched it, and the one thing most in the way. It is a
-- function rather than a view because "the one thing most in the way" is a
-- precedence rule, and a rule with an order is clearer written down than
-- reconstructed from six left joins in the client.
--
-- Deliberately returns EVERY brand, prospects and clients alike, and leaves the
-- filtering to the caller: the list it feeds is the brands list, which has always
-- shown both.
create or replace function public.commercial_pipeline()
returns table (
  brand_id    bigint,
  is_prospect boolean,
  step        smallint,
  step_state  text,
  steps_done  integer,
  last_touch  timestamptz,
  blocking    text,
  artifacts   integer
)
language sql stable security definer set search_path = public as $$
  with
  -- Steps 1..5 for every brand, whether or not anyone has recorded anything, so
  -- a brand nobody has touched reports step 1 / not_started rather than nothing.
  grid as (
    select b.id as brand_id, s.step
      from public.brands b cross join generate_series(1, 5) as s(step)
  ),
  steps as (
    select g.brand_id, g.step::smallint as step,
           coalesce(p.state, 'not_started') as state,
           p.updated_at
      from grid g
      left join public.brand_commercial_progress p
        on p.brand_id = g.brand_id and p.step = g.step
  ),
  -- Where the deal is: the first step that is neither finished nor deliberately
  -- passed over. NULL when all five are behind it.
  current_step as (
    select distinct on (brand_id) brand_id, step, state
      from steps
     where state not in ('done', 'skipped')
     order by brand_id, step
  ),
  tally as (
    select brand_id,
           count(*) filter (where state = 'done')::integer as done,
           max(updated_at) as touched
      from steps group by brand_id
  ),
  -- The pipeline's opinion, collapsed to one line per brand.
  stage_state as (
    select brand_id,
           string_agg(distinct replace(stage, '_', ' '), ', ')
             filter (where status = 'failed') as failed,
           string_agg(distinct replace(stage, '_', ' '), ', ')
             filter (where status = 'running') as running,
           count(*) filter (where status = 'pending' and queued_at is not null)::integer as queued
      from public.brand_onboarding group by brand_id
  ),
  built as (
    select brand_id,
           count(*)::integer as n,
           bool_or(template_key = 'intro_teaser')  as intro,
           bool_or(template_key = 'data_request')  as data_request,
           bool_or(template_key = 'business_case') as business_case,
           bool_or(template_key = 'operations')    as operations,
           max(generated_at) as built_at
      from public.brand_deck_outputs group by brand_id
  ),
  platform as (
    select b.id as brand_id,
           (select count(*) from public.policies where brand_id = b.id) as policies,
           (select count(*) from public.profiles
             where brand_id = b.id and role in ('brand', 'brand_admin', 'brand_user')) as logins,
           (select count(*) from public.storefront_products where brand_id = b.id) as products
      from public.brands b
  )
  select
    b.id,
    b.is_prospect,
    c.step,
    c.state,
    coalesce(t.done, 0),
    -- The most recent sign of life, from either half: someone marking a step, or
    -- the pipeline landing a file. A deal worked entirely through the automation
    -- would otherwise read as untouched.
    greatest(t.touched, x.built_at),
    case
      -- Order matters. Each line is a real reason the NEXT thing cannot happen,
      -- and the first one that applies is the one worth putting in a column.
      when c.step is null then null
      when coalesce(b.website, '') = '' then 'no website — nothing can be built'
      when s.failed is not null then 'pipeline failed: ' || s.failed
      when s.running is not null then 'setting up: ' || s.running
      when coalesce(s.queued, 0) > 0 then 'setting up: ' || s.queued || ' stage' ||
             case when s.queued = 1 then '' else 's' end || ' queued'
      when c.step = 1 and not coalesce(x.intro, false) then
             case when coalesce(p.products, 0) = 0
                  then 'no catalogue yet — the intro deck is built from it'
                  else 'intro deck not built' end
      when c.step = 2 and not coalesce(x.data_request, false) then 'data request not built'
      when c.step = 2 and coalesce(b.legal_name, '') = '' then 'no legal entity on the record'
      when c.step = 3 and coalesce(p.logins, 0) = 0 then 'no logins — the demo has nothing to sign into'
      when c.step = 3 and coalesce(p.policies, 0) = 0 then 'no covers — the demo has nothing to show'
      when c.step = 4 and coalesce(jsonb_array_length(bc.segments), 0) = 0 then 'perimeter not declared'
      when c.step = 4 and not coalesce(x.business_case, false) then 'business case not built'
      when c.step = 5 and not coalesce(x.operations, false) then 'ops deck not built'
      else null
    end,
    coalesce(x.n, 0)
  from public.brands b
  left join current_step c on c.brand_id = b.id
  left join tally       t on t.brand_id = b.id
  left join stage_state s on s.brand_id = b.id
  left join built       x on x.brand_id = b.id
  left join platform    p on p.brand_id = b.id
  left join public.brand_business_case bc on bc.brand_id = b.id
  -- SECURITY DEFINER reading across every brand: the caller is checked, because
  -- RLS on the underlying tables does not apply inside a definer function.
  where public.get_my_role() = 'admin';
$$;

revoke all on function public.commercial_pipeline() from public, anon;
grant execute on function public.commercial_pipeline() to authenticated, service_role;

comment on function public.commercial_pipeline() is
  'One row per brand: which of the five commercial steps it is on, how many are done, when it was last touched by a person or by the pipeline, and the single most immediate thing in the way. Admin only.';
