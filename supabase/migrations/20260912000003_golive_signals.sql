-- ==============================|| THE CHECKLIST TICKS ITSELF WHERE IT CAN ||============================== --
-- Thirty-three items, every one of them a manual tick — including the fifteen the platform
-- can simply SEE. "Set the insurance premium" is a number on the brand record; "Write and
-- load the FAQ" is two jsonb columns; "Assign the policy number prefix" is a five-character
-- string. Asking a person to confirm each of those is asking them to read the database and
-- copy the answer onto a form, and the form then disagrees with the data the moment anything
-- changes.
--
-- So: this returns what is TRUE, per item, from the tables. The stored ticks stay exactly as
-- they are — they are the record of the work no query can see (a conversation with the
-- insurer, a training session, a runbook) and of a human's deliberate confirmation. The
-- screen treats an item as done when either the platform can see it or a person has ticked
-- it, and it says which.
--
-- Item keys match src/lib/goLiveChecklist.ts. An item missing from this result is one only a
-- person can answer, and the screen leaves it to them.

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
begin
  select * into b from public.brands where id = p_brand_id;
  if not found then return '{}'::jsonb; end if;

  -- The eight pictures a portal needs: the two marks and the six section images.
  v_images := array[
    b.logo_big, b.logo_small, b.auth_background_image, b.top_banner_image,
    b.theft_image, b.damage_image, b.faq_image, b.feedback_image
  ];

  -- Costs: how many categories the brand's own systems emit, and how many of those have no
  -- cost percentage. An unmapped category silently computes a cost of zero, which is why the
  -- checklist has an item for it at all.
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
    -- Everything the portal needs to introduce the house, and the status that says somebody
    -- has checked it. A prospect sitting at 'pending' is deliberately not done.
    'brand_record',
      coalesce(trim(b.description), '') <> ''
      and coalesce(trim(b.website), '') <> ''
      and coalesce(trim(b.email), '') <> ''
      and coalesce(trim(coalesce(b.registered_address, b.hq_address)), '') <> ''
      and b.status = 'verified',
    'assets_collected', array_position(v_images, null) is null,
    -- Collected is not the same as uploaded: a URL still pointing at the brand's own site is
    -- a hotlink that breaks the day they redesign. Ours live in storage.
    'assets_uploaded',
      array_position(v_images, null) is null
      and not exists (
        select 1 from unnest(v_images) as img
         where img not like '%/storage/v1/object/%'
      ),
    'theme',
      coalesce(b.theme_settings ? 'primary_hsl', false)
      and (coalesce(b.theme_settings ? 'heading_font', false) or coalesce(b.theme_settings ? 'font_url', false)),
    'faq',
      coalesce(jsonb_array_length(b.faq_en), 0) > 0
      and coalesce(jsonb_array_length(b.faq_it), 0) > 0,

    -- ── B. Commercial parameters ──
    'premium', b.insurance_premium is not null,
    'fees', b.activation_fee is not null and b.aion_premium_fee is not null,
    'ceiling', b.max_covered_value is not null,
    'floor', b.min_covered_value is not null,

    -- ── C. Taxonomy and costs ──
    'category_list', v_categories > 0,
    'costs_loaded', v_categories > 0 and v_costs > 0 and v_missing = 0,

    -- ── D. Sales integration ──
    -- One credential is the test credential; there is no column that distinguishes the
    -- production one, so that item stays with the person who issued it.
    'test_credential', exists (
      select 1 from public.external_api_credentials c
       where c.brand_id = p_brand_id and coalesce(c.is_active, true)
    ),
    'shops', exists (select 1 from public.shops s where s.brand_id = p_brand_id),

    -- ── E. Insurer and reporting ──
    -- A quote for THIS house, not a rate borrowed from another one to model with.
    'quotation', exists (
      select 1 from public.insurance_quotes q
       where q.brand_id = p_brand_id and coalesce(q.active, true)
    ),
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
  'Per-item go-live evidence read from the real tables, keyed to src/lib/goLiveChecklist.ts. '
  'An item absent from the result is one only a person can answer.';

revoke all on function public.brand_golive_signals(bigint) from public;
grant execute on function public.brand_golive_signals(bigint) to authenticated;
