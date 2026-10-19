-- "Setting Prada up" finished an hour ago and nothing anywhere said so.
--
-- The brands list has two green states already and neither is this one. `status` is
-- pending/verified/blocked and is about ACCOUNT VERIFICATION — the column's own comment says
-- it "says nothing about whether these people have signed anything" — so flipping it when a
-- pipeline finishes would assert something untrue about the account. "All five done" is the
-- commercial cycle, the five meetings, which for a house that was set up this morning is
-- honestly still at step 1.
--
-- What was missing is the third thing: the ten-stage setup having come to rest. The
-- pipeline already reads brand_onboarding, but only ever asked it what had gone WRONG —
-- failed, running, queued — so a brand with everything landed and a brand that had never
-- been touched both came back with an empty "Waiting on" and nothing else to say.
--
-- Now it also reports how many stages exist and how many have settled. 'skipped' counts as
-- settled because it is a finished state: the demo stages are skipped for a house that has
-- signed, and a site with no catalogue skips its intro deck for good. A brand with no stage
-- rows at all reports 0 of 0, which is not ready — it is not started.
--
-- Returns two new columns, so the function has to be dropped rather than replaced. Both are
-- additive: a client that does not know about them is unaffected.
drop function if exists public.commercial_pipeline();

create function public.commercial_pipeline()
returns table (
  brand_id bigint,
  is_prospect boolean,
  step smallint,
  step_state text,
  steps_done integer,
  last_touch timestamptz,
  blocking text,
  artifacts integer,
  stages_total integer,
  stages_settled integer
)
language sql
security definer
set search_path = public
as $fn$
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
           count(*) filter (where status = 'pending' and queued_at is not null)::integer as queued,
           count(*)::integer as stages,
           -- 'skipped' is a finished state, not an unfinished one: the demo stages are
           -- skipped on a house that has signed, and a site with no catalogue skips its
           -- intro deck for good. A brand whose every stage has come to rest is set up.
           count(*) filter (where status in ('done', 'skipped'))::integer as settled
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
    coalesce(x.n, 0),
    coalesce(s.stages, 0),
    coalesce(s.settled, 0)
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

$fn$;

comment on function public.commercial_pipeline() is
  'One row per brand for the admin list: where the commercial cycle is, what is blocking it, and how much of the ten-stage setup has settled (stages_settled = stages_total and > 0 means ready).';
