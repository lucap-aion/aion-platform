-- ==============================|| "WHY IS THIS NOT TICKED?" ||============================== --
-- The signals answered true or false, and the screen filled the false case with the item's
-- static evidence phrase: "waiting on: description, website, customer-care address and
-- registered office are set, and the status is verified". Every one of those four was set on
-- the brand in front of the reader. The one that was not — the status, still Pending — was
-- nowhere in the sentence, so the checklist looked broken rather than accurate.
--
-- So a signal now answers `true`, or a STRING saying what is missing. Same function, same
-- keys; `= true` is still the test for done, and anything else is a diagnosis to show.
--
-- Only where the answer is not already obvious from the item. "Set the insurance premium"
-- needs no explanation when it is false.

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
  v_missing_fields text[];
  v_no_image   text[];
  v_hotlinked  integer;
  v_faq_missing text[];
  v_fee_missing text[];
begin
  select * into b from public.brands where id = p_brand_id;
  if not found then return '{}'::jsonb; end if;

  v_images := array[
    b.logo_big, b.logo_small, b.auth_background_image, b.top_banner_image,
    b.theft_image, b.damage_image, b.faq_image, b.feedback_image
  ];

  -- Which of the record's own fields are still blank, named one by one.
  v_missing_fields := array_remove(array[
    case when coalesce(trim(b.description), '') = '' then 'a description' end,
    case when coalesce(trim(b.website), '') = '' then 'a website' end,
    case when coalesce(trim(b.email), '') = '' then 'a customer-care address' end,
    case when coalesce(trim(coalesce(b.registered_address, b.hq_address)), '') = '' then 'a registered office' end,
    case when b.status is distinct from 'verified'
         then format('the status is still %s', coalesce(initcap(b.status), 'unset')) end
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
    -- ── A. Brand record and portal ──
    'slug', coalesce(trim(b.slug), '') <> '',
    'brand_record', case
      when cardinality(v_missing_fields) = 0 then to_jsonb(true)
      else to_jsonb(format('still missing: %s', array_to_string(v_missing_fields, ', ')))
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
      when v_categories > 0 then to_jsonb(true)
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

comment on function public.brand_golive_signals(bigint) is
  'Per-item go-live evidence, keyed to src/lib/goLiveChecklist.ts. `true` means done; a '
  'string says what is missing; an absent key is an item only a person can answer.';

revoke all on function public.brand_golive_signals(bigint) from public;
grant execute on function public.brand_golive_signals(bigint) to authenticated;
