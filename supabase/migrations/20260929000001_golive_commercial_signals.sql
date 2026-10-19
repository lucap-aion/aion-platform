-- ==============================|| THE CYCLE TICKS THE CHECKLIST ||============================== --
-- The go-live checklist grew from the technical set-up into the whole launch: the commercial
-- cycle, contracts, finance, claims. Five of the new items are the cycle's own steps, and the
-- Commercial cycle tab already records each one (brand_commercial_progress). Asking somebody to
-- tick "Hold the first meeting" on a second screen after marking it held on the first is the
-- copy-the-database-onto-a-form problem this function exists to remove — so the steps, and
-- onboarding having come to rest, are read here.
--
-- A step reads as done when it is marked done OR skipped: skipping is a decision somebody took
-- on the cycle tab, and the checklist must not re-open it. When it is not, the reason says
-- whether the file is already built, because "a file existing is not a meeting having
-- happened" and the fix is one click on the other tab.
--
-- Also: the function now answers only admins. It is security definer and was executable by
-- every authenticated user for any brand id, which was already more than a brand user should
-- see of another house's record, and now includes the commercial cycle. Its one caller is the
-- admin Go-live tab.
--
-- Additive for the client: an older bundle ignores keys it does not know, and a newer bundle
-- against the older function simply shows these items as manual ticks.

create or replace function public.golive_cycle_signal(p_state text, p_built boolean, p_file text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_state in ('done', 'skipped') then to_jsonb(true)
    when p_state = 'in_progress' then to_jsonb('in progress on the Commercial cycle tab'::text)
    when p_built then to_jsonb(format('the %s is built — mark the step done on the Commercial cycle tab', p_file))
    when p_file is null then to_jsonb('not marked done on the Commercial cycle tab'::text)
    else to_jsonb(format('the %s has not been built yet', p_file))
  end
$$;

create or replace function public.brand_golive_signals(p_brand_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b            record;
  v_images     text[];
  v_costs      integer;
  v_missing    integer;
  v_categories integer;
  v_sold_categories integer;
  v_missing_fields text[];
  v_no_image   text[];
  v_hotlinked  integer;
  v_faq_missing text[];
  v_fee_missing text[];
  v_progress   jsonb;
  v_built      jsonb;
  v_stages     integer;
  v_open       integer;
  v_failed     integer;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then return '{}'::jsonb; end if;

  select * into b from public.brands where id = p_brand_id;
  if not found then return '{}'::jsonb; end if;

  -- The commercial cycle: each step's marker, and which files have been built.
  select coalesce(jsonb_object_agg(step::text, state), '{}'::jsonb) into v_progress
    from public.brand_commercial_progress where brand_id = p_brand_id;
  select coalesce(jsonb_object_agg(template_key, true), '{}'::jsonb) into v_built
    from public.brand_deck_outputs where brand_id = p_brand_id;

  -- Onboarding: has every stage come to rest?
  select count(*),
         count(*) filter (where status in ('pending', 'running')),
         count(*) filter (where status = 'failed')
    into v_stages, v_open, v_failed
    from public.brand_onboarding where brand_id = p_brand_id;

  v_images := array[
    b.logo_big, b.logo_small, b.auth_background_image, b.top_banner_image,
    b.theft_image, b.damage_image, b.faq_image, b.feedback_image
  ];

  -- Which of the record's own fields are still blank, named one by one.
  v_missing_fields := array_remove(array[
    case when coalesce(trim(b.description), '') = '' then 'a description' end,
    case when coalesce(trim(b.website), '') = '' then 'a website' end,
    case when coalesce(trim(b.email), '') = '' then 'a customer-care address' end,
    case when coalesce(trim(coalesce(b.registered_address, b.hq_address)), '') = '' then 'a registered office' end
  ], null);

  -- Which pictures are missing, and which are pointing at the brand's own site.
  v_no_image := array_remove(array[
    case when b.logo_big is null then 'the full logo' end,
    case when b.logo_small is null then 'the monogram' end,
    case when b.auth_background_image is null then 'the sign-in background' end,
    case when b.top_banner_image is null then 'the dashboard banner' end,
    case when b.theft_image is null then 'the theft tile' end,
    case when b.damage_image is null then 'the damage tile' end,
    case when b.faq_image is null then 'the FAQ tile' end,
    case when b.feedback_image is null then 'the feedback tile' end
  ], null);

  select count(*) into v_hotlinked
    from unnest(v_images) as img
   where img is not null and img not like '%/storage/v1/object/%';

  v_faq_missing := array_remove(array[
    case when coalesce(jsonb_array_length(b.faq_en), 0) = 0 then 'English' end,
    case when coalesce(jsonb_array_length(b.faq_it), 0) = 0 then 'Italian' end
  ], null);

  v_fee_missing := array_remove(array[
    case when b.activation_fee is null then 'the activation fee' end,
    case when b.aion_premium_fee is null then 'the AION share' end
  ], null);

  select count(distinct lower(trim(category))) into v_categories
    from public.catalogues where brand_id = p_brand_id and coalesce(trim(category), '') <> '';
  -- Where those categories actually came from. A row written by the sale ingestion carries
  -- no price_source; one lifted from the house's own website carries 'storefront'. Counting
  -- them together let a prospect with a demo book report five categories under a sentence
  -- about the sales integration, which had delivered nothing at all.
  select count(distinct lower(trim(category))) into v_sold_categories
    from public.catalogues
   where brand_id = p_brand_id and coalesce(trim(category), '') <> '' and price_source is null;
  select count(*) into v_costs
    from public.manufacturing_costs where brand_id = p_brand_id;
  select count(*) into v_missing
    from (
      select distinct lower(trim(c.category)) as category
        from public.catalogues c
       where c.brand_id = p_brand_id and coalesce(trim(c.category), '') <> ''
    ) cat
   where not exists (
     select 1 from public.manufacturing_costs m
      where m.brand_id = p_brand_id
        and lower(trim(m.category)) = cat.category
   );

  return jsonb_strip_nulls(jsonb_build_object(
    -- ── Commercial cycle ──
    'onboarding_run', case
      when v_stages = 0 then to_jsonb('onboarding has never been started for this brand'::text)
      when v_open > 0 then to_jsonb(format('%s of %s stages still queued or running', v_open, v_stages))
      when v_failed > 0 then to_jsonb(format(
        '%s %s failed — rerun from the Commercial cycle tab, or tick this if the house simply has nothing to read',
        v_failed, case when v_failed = 1 then 'stage' else 'stages' end))
      else to_jsonb(true)
    end,
    'intro_meeting', public.golive_cycle_signal(v_progress->>'1', v_built ? 'intro_teaser', 'intro deck'),
    'data_request',  public.golive_cycle_signal(v_progress->>'2', v_built ? 'data_request', 'data request'),
    'platform_demo', public.golive_cycle_signal(v_progress->>'3', false, null),
    'pricing_case',  public.golive_cycle_signal(v_progress->>'4', v_built ? 'business_case', 'business case'),
    'ops_review',    public.golive_cycle_signal(v_progress->>'5', v_built ? 'operations', 'ops deck'),

    -- ── A. Brand record and portal ──
    'slug', coalesce(trim(b.slug), '') <> '',
    'brand_record', case
      when cardinality(v_missing_fields) = 0 then to_jsonb(true)
      else to_jsonb(format('still missing: %s', array_to_string(v_missing_fields, ', ')))
    end,
    'brand_verified', case
      when b.status = 'verified' then to_jsonb(true)
      else to_jsonb(format(
        'the status is %s — Verified is what publishes the brand, so nothing sets it automatically',
        coalesce(initcap(b.status), 'unset')))
    end,
    'assets_collected', case
      when cardinality(v_no_image) = 0 then to_jsonb(true)
      else to_jsonb(format('%s still to find: %s', cardinality(v_no_image), array_to_string(v_no_image, ', ')))
    end,
    'assets_uploaded', case
      when cardinality(v_no_image) > 0
        then to_jsonb(format('%s of the eight pictures are not set yet', cardinality(v_no_image)))
      when v_hotlinked > 0
        then to_jsonb(format('%s of the eight are still hotlinked from the brand''s own site — they break the day it redesigns', v_hotlinked))
      else to_jsonb(true)
    end,
    'theme', case
      when coalesce(b.theme_settings ? 'primary_hsl', false)
       and (coalesce(b.theme_settings ? 'heading_font', false) or coalesce(b.theme_settings ? 'font_url', false))
        then to_jsonb(true)
      when coalesce(b.theme_settings ? 'primary_hsl', false)
        then to_jsonb('a primary colour is set; no typeface the portal can load'::text)
      when coalesce(b.theme_settings ? 'heading_font', false)
        then to_jsonb('a typeface is set; no primary colour'::text)
      else to_jsonb('neither a primary colour nor a typeface'::text)
    end,
    'faq', case
      when cardinality(v_faq_missing) = 0 then to_jsonb(true)
      else to_jsonb(format('no entries in %s', array_to_string(v_faq_missing, ' or ')))
    end,

    -- ── B. Commercial parameters ──
    'premium', b.insurance_premium is not null,
    'fees', case
      when cardinality(v_fee_missing) = 0 then to_jsonb(true)
      else to_jsonb(format('missing %s', array_to_string(v_fee_missing, ' and ')))
    end,
    'ceiling', b.max_covered_value is not null,
    'floor', b.min_covered_value is not null,

    -- ── C. Taxonomy and costs ──
    'category_list', case
      when v_sold_categories > 0 then to_jsonb(true)
      when v_categories > 0 then to_jsonb(format(
        '%s %s known from the house''s own website, but nothing has come through the sales integration yet — '
        || 'the list it will actually send is the one to cost',
        v_categories, case when v_categories = 1 then 'category is' else 'categories are' end))
      else to_jsonb('nothing has arrived through the sales integration yet, so no categories are known'::text)
    end,
    'costs_loaded', case
      when v_categories > 0 and v_costs > 0 and v_missing = 0 then to_jsonb(true)
      when v_categories = 0 then to_jsonb('no categories to cost yet'::text)
      when v_costs = 0 then to_jsonb(format('%s categories, none of them costed', v_categories))
      else to_jsonb(format('%s of %s categories have no cost percentage — each one computes a cost of zero', v_missing, v_categories))
    end,

    -- ── D. Sales integration ──
    'test_credential', exists (
      select 1 from public.external_api_credentials c
       where c.brand_id = p_brand_id and coalesce(c.is_active, true)
    ),
    'shops', exists (select 1 from public.shops s where s.brand_id = p_brand_id),

    -- ── E. Insurer and reporting ──
    'quotation', case
      when exists (
        select 1 from public.insurance_quotes q
         where q.brand_id = p_brand_id and coalesce(q.active, true)
      ) then to_jsonb(true)
      else to_jsonb('no quote on file for this brand — the business case is modelling on a borrowed rate'::text)
    end,
    'policy_prefix', coalesce(trim(b.chubb_policy_prefix), '') <> '',
    'reporting_on', coalesce(b.enable_chubb_reporting, false),

    -- ── F. People ──
    'brand_users', exists (
      select 1 from public.profiles p
       where p.brand_id = p_brand_id and p.role = 'brand'
    )
  ));
end
$$;

revoke all on function public.brand_golive_signals(bigint) from public;
grant execute on function public.brand_golive_signals(bigint) to authenticated;
