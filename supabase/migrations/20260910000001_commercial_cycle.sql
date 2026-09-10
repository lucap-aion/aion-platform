-- The commercial cycle, as one thing.
--
-- The five steps of the sales cycle already had code behind them, but each was
-- reachable from somewhere different and two of them could not complete at all:
--
--   1. intro deck      brand-deck            worked
--   2. data request    build-collateral      works on dev ONLY, off a template row
--                                            someone inserted by hand. No migration
--                                            registers it, so a project built from
--                                            this repo hits "data_request template
--                                            not registered" on the first click
--   3. demo            onboard-brand         worked, but the panel could not see
--                                            queued work (queued_at was never
--                                            selected) so it looked frozen
--   4. business case   compute_business_case  wrong on two numbers (below)
--   5. ops deck        build-collateral      worked
--
-- This migration closes the gaps in the data layer:
--   * the decks bucket and the data_request template exist as migrations rather
--     than as something someone did by hand in dev
--   * insurance_quotes can express what has actually been quoted — theft vs
--     theft+damage, partial vs total damage, and the volume band the rate was
--     given for — instead of collapsing all of it into one row per category
--   * compute_business_case picks the RIGHT quote for a segment and stops
--     getting two figures wrong
--   * where a prospect actually is in the cycle is recorded, without forcing an
--     order on it — the steps genuinely do swap around

-- ── 1. The decks bucket ──────────────────────────────────────────────────────
-- brand-deck and build-collateral both read templates from, and write outputs
-- to, a bucket called "decks" that no migration ever created. It exists in dev
-- because someone made it in the dashboard; on any other project both functions
-- fail at the first download. Private: every hand-off is a signed URL.
insert into storage.buckets (id, name, public)
values ('decks', 'decks', false)
on conflict (id) do nothing;

-- ── 2. The data-request template ─────────────────────────────────────────────
-- 20260730000009 registered intro_teaser and nothing else. The data_request row
-- exists on dev because someone inserted it by hand, which is why the button
-- works there and would throw "data_request template not registered" on any
-- project built from these migrations — production included.
--
-- The workbook itself is a binary and cannot live in a migration, so this
-- registers the row and the function names the storage path when the file is
-- missing. The find strings are the literal cells in the Ferragamo original.
--
-- DO NOTHING on conflict, deliberately. These values are a seed for a project
-- that has none, not a correction to one that does: the mapping is tuned by hand
-- against a specific revision of the workbook, and overwriting a working row
-- with a guess would leave every slot unmatched — which does not fail loudly,
-- it just sends the PREVIOUS client's legal entity and address to the new one.
insert into public.deck_templates (key, name, kind, storage_path, slots, text_slots)
values (
  'data_request',
  'Pilot data request workbook',
  'data_request',
  'templates/AION_Data_Request_Pilot.xlsx',
  '[]'::jsonb,
  '[
    {"find":"Salvatore Ferragamo S.p.A.","replace_with":"{{BRAND_LEGAL_NAME}}","note":"legal entity the pilot is contracted with"},
    {"find":"Via dei Tornabuoni 2, 50123 Florence, Italy","replace_with":"{{BRAND_ADDRESS}}","note":"registered address"},
    {"find":"Bags, Watches","replace_with":"{{BRAND_FOCUS}}","note":"categories in scope for the pilot"}
  ]'::jsonb
)
on conflict (key) do nothing;

-- ── 3. Quotes that can say what was actually quoted ──────────────────────────
-- Chubb has quoted on more axes than one rate per category: theft alone or
-- theft plus accidental damage, damage partial or total, and different rates at
-- different volumes. Collapsing that into (category, coverage) meant a segment
-- could silently be priced off the wrong quote — the most recent row for the
-- category won, whatever it was actually for.
alter table public.insurance_quotes
  add column if not exists damage_scope text
    check (damage_scope is null or damage_scope in ('partial', 'total')),
  add column if not exists gmv_from numeric,
  add column if not exists gmv_to   numeric;

comment on column public.insurance_quotes.damage_scope is
  'For theft_and_damage quotes: whether accidental damage is covered partially or in full. NULL = not stated in the quote.';
comment on column public.insurance_quotes.gmv_from is
  'Lower bound of the covered-GMV band this rate was quoted for. NULL = no band stated.';
comment on column public.insurance_quotes.gmv_to is
  'Upper bound of the covered-GMV band this rate was quoted for. NULL = no upper bound.';

create index if not exists insurance_quotes_resolve
  on public.insurance_quotes (category, coverage, active);

-- Admins enter quotes from the app now, so they need more than select.
grant insert, update, delete on public.insurance_quotes to authenticated;
grant usage, select on sequence public.insurance_quotes_id_seq to authenticated;

-- ── 4. The model ─────────────────────────────────────────────────────────────
-- Two things were wrong with the arithmetic, and both of them reached a slide:
--
--   service fee   v_svc * (p_months - service_discount_months) goes NEGATIVE for
--                 any programme shorter than the six discounted months. A three
--                 month pilot priced its service fee at minus three months.
--
--   VAT           the cost as a percentage of the VAT-INCLUSIVE retail price was
--                 MULTIPLIED by 1.22. The VAT-inclusive price is the larger
--                 number, so the same cost is a SMALLER share of it — dividing
--                 is the operation. The bug overstated the headline "% of retail"
--                 by 22% relative, on the one slide a client reads closely.
--
-- Also new: quote resolution that respects coverage, damage scope and volume,
-- and a per-piece block that reconciles with total_cost_to_brand instead of
-- quietly dropping the setup fee.
create or replace function public.compute_business_case(
  p_brand_id   bigint,
  p_segments   jsonb,
  p_months     integer default 36,
  p_terms_key  text default 'standard_2026',
  p_include_api boolean default false,
  p_setup_discounted boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t            record;
  seg          jsonb;
  v_rate       numeric;
  v_quote      record;
  v_rows       jsonb := '[]'::jsonb;
  v_provenance jsonb := '[]'::jsonb;
  v_notes      text[] := '{}';
  v_coverage   text;
  v_scope      text;
  v_months_live numeric;
  v_rev        numeric; v_cogs numeric; v_gross numeric; v_units numeric;
  v_tier       jsonb;
  v_act_pct    numeric; v_svc numeric;
  v_setup      numeric; v_service numeric; v_activation numeric;
  v_full_months numeric; v_disc_months numeric;
  v_total_rev  numeric := 0; v_total_gross numeric := 0; v_total_units numeric := 0;
  v_band_miss  boolean := false;
begin
  select * into t from public.aion_pricing_terms where key = p_terms_key;
  if not found then raise exception 'pricing terms % not found', p_terms_key; end if;
  if p_months is null or p_months < 1 then
    return jsonb_build_object('ok', false, 'reason', 'months modelled must be at least 1');
  end if;
  if p_segments is null or jsonb_array_length(p_segments) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'declare at least one segment of the perimeter');
  end if;

  -- Per segment: resolve the rate, then spread the revenue over the months it is live.
  for seg in select * from jsonb_array_elements(p_segments) loop
    v_coverage := coalesce(nullif(seg->>'coverage', ''), 'theft_and_damage');
    v_scope    := nullif(seg->>'damage_scope', '');
    v_rev      := coalesce((seg->>'revenues')::numeric, 0);

    -- Preference order, most specific first. A quote for THIS brand beats a
    -- borrowed one; a quote whose volume band contains this perimeter beats one
    -- quoted at a different scale; a quote for the damage scope asked for beats
    -- one that never stated it. Only then, the most recent.
    select * into v_quote from public.insurance_quotes q
     where q.active
       and q.category = lower(seg->>'category')
       and q.coverage = v_coverage
       and (v_scope is null or q.damage_scope is null or q.damage_scope = v_scope)
     order by
       (q.brand_id = p_brand_id) desc,
       (q.gmv_from is not null and v_rev >= q.gmv_from
        and (q.gmv_to is null or v_rev <= q.gmv_to)) desc,
       (q.damage_scope is not distinct from v_scope) desc,
       q.quoted_at desc nulls last
     limit 1;

    if not found then
      return jsonb_build_object('ok', false,
        'reason', format('no %s quote on file for "%s" — add the quote (Business case → Insurer quotes) before building a case',
                         replace(v_coverage, '_', ' '), seg->>'category'));
    end if;

    v_rate := v_quote.rate_of_cogs;

    -- A rate quoted at a very different volume is still usable, but saying so is
    -- the difference between a model and a misquote.
    if v_quote.gmv_from is not null
       and (v_rev < v_quote.gmv_from or (v_quote.gmv_to is not null and v_rev > v_quote.gmv_to)) then
      v_band_miss := true;
      v_notes := v_notes || format('%s: rate was quoted for a %s–%s volume band, this segment declares %s',
                                   seg->>'name', round(v_quote.gmv_from),
                                   coalesce(round(v_quote.gmv_to)::text, 'no cap'), round(v_rev));
    end if;

    v_provenance := v_provenance || jsonb_build_object(
      'quote_id', v_quote.id,
      'segment', seg->>'name', 'category', seg->>'category',
      'coverage', v_quote.coverage, 'damage_scope', v_quote.damage_scope,
      'rate_of_cogs', v_rate, 'insurer', v_quote.insurer,
      'quoted_for', v_quote.quoted_for, 'quoted_at', v_quote.quoted_at,
      'gmv_from', v_quote.gmv_from, 'gmv_to', v_quote.gmv_to,
      'source', v_quote.source,
      'own_quote', coalesce(v_quote.brand_id = p_brand_id, false));

    -- Declared revenue is the figure for the WHOLE modelled period; a segment
    -- that starts late only contributes the months it is live for.
    v_months_live := greatest(0, p_months - coalesce((seg->>'start_month')::numeric, 1) + 1);
    v_rev  := v_rev * (v_months_live / p_months);
    v_cogs := v_rev * coalesce(nullif((seg->>'cogs_ratio')::numeric, 0), 0.30);
    v_gross := v_cogs * v_rate;
    v_units := case when coalesce((seg->>'avg_price')::numeric, 0) > 0
                    then v_rev / (seg->>'avg_price')::numeric else null end;

    v_rows := v_rows || jsonb_build_object(
      'segment', seg->>'name', 'category', seg->>'category',
      'coverage', v_coverage, 'damage_scope', v_scope,
      'months_live', v_months_live,
      'revenues_covered', round(v_rev), 'value_covered', round(v_cogs),
      'rate_of_cogs', v_rate, 'gross_premium', round(v_gross),
      'units', case when v_units is not null then round(v_units) else null end);

    v_total_rev := v_total_rev + v_rev;
    v_total_gross := v_total_gross + v_gross;
    v_total_units := v_total_units + coalesce(v_units, 0);
  end loop;

  -- AION's tier follows the covered GMV.
  select value into v_tier from jsonb_array_elements(t.tiers) value
   where (value->>'gmv_up_to') is null or v_total_rev <= (value->>'gmv_up_to')::numeric
   order by coalesce((value->>'gmv_up_to')::numeric, 1e18) limit 1;

  v_act_pct := coalesce((v_tier->>'activation_fee_pct')::numeric, 0.0008);
  v_svc     := (v_tier->>'service_fee_month')::numeric;

  v_setup := t.setup_fee * (case when p_setup_discounted then (1 - t.setup_discount) else 1 end)
             + (case when p_include_api then t.api_fee else 0 end);

  -- The discount covers the first N months; anything beyond them is full price.
  -- greatest(0, …) because a pilot shorter than the discount window used to
  -- bill a NEGATIVE number of full-price months.
  v_disc_months := least(t.service_discount_months, p_months);
  v_full_months := greatest(0, p_months - t.service_discount_months);
  v_service := case when v_svc is null then 0
                    else v_svc * v_full_months + v_svc * (1 - t.service_discount) * v_disc_months end;

  v_activation := v_total_rev * v_act_pct;

  return jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'months', p_months,
    'segments', v_rows,
    'revenues_covered', round(v_total_rev),
    'products_covered', case when v_total_units > 0 then round(v_total_units) else null end,
    'average_price', case when v_total_units > 0 then round(v_total_rev / v_total_units) else null end,
    'gross_premium', round(v_total_gross),
    'net_premium', round(v_total_gross * (1 - t.gvt_fee)),
    'aion_insurance_revenue', round(v_total_gross * (1 - t.gvt_fee) * t.aion_premium_share),
    'aion_fees', jsonb_build_object(
      'setup', round(v_setup), 'service', round(v_service), 'activation', round(v_activation),
      'total', round(v_setup + v_service + v_activation),
      'tier', (v_tier->>'tier')::int,
      'service_fee_month', v_svc,
      'service_months_full', v_full_months,
      'service_months_discounted', v_disc_months,
      'service_note', case when v_svc is null then 'tier 3 service fee is on quotation' else null end),
    'aion_total_revenue', round(v_total_gross * (1 - t.gvt_fee) * t.aion_premium_share + v_setup + v_service + v_activation),
    'total_cost_to_brand', round(v_total_gross + v_setup + v_service + v_activation),
    'vat', t.vat,
    -- Per piece. `total` is the RECURRING cost — premium plus service plus
    -- activation. Setup is a one-off and is carried separately, because a
    -- per-piece figure that silently drops it will not reconcile with
    -- total_cost_to_brand in the meeting where someone checks.
    'per_product', case when v_total_units > 0 then jsonb_build_object(
        'insurer_fee', round(v_total_gross / v_total_units, 2),
        'aion_fee', round((v_service + v_activation) / v_total_units, 2),
        'total', round((v_total_gross + v_service + v_activation) / v_total_units, 2),
        'setup', round(v_setup / v_total_units, 2),
        'total_with_setup', round((v_total_gross + v_setup + v_service + v_activation) / v_total_units, 2),
        'total_pct_of_price', round((v_total_gross + v_service + v_activation) / v_total_rev, 4),
        -- The VAT-inclusive price is LARGER, so the same cost is a SMALLER share
        -- of it. This divided by (1+vat) — it used to multiply.
        'total_pct_of_price_incl_vat',
          round((v_total_gross + v_service + v_activation) / v_total_rev / (1 + t.vat), 4)
      ) else null end,
    'rates_used', v_provenance,
    'notes', to_jsonb(v_notes),
    'volume_band_mismatch', v_band_miss,
    -- Loud on purpose: a rate quoted for another house is indicative only.
    'indicative', exists (select 1 from jsonb_array_elements(v_provenance) p where (p->>'own_quote')::boolean is not true)
  );
end;
$$;

revoke all on function public.compute_business_case(bigint, jsonb, integer, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.compute_business_case(bigint, jsonb, integer, text, boolean, boolean) to service_role;

-- ── 5. Where a prospect actually is ──────────────────────────────────────────
-- The five steps do not run in a fixed order — pricing sometimes precedes the
-- demo, the ops review sometimes comes early. So this records state per step
-- rather than a position in a pipeline, and nothing here gates anything.
create table if not exists public.brand_commercial_progress (
  brand_id     bigint not null references public.brands(id) on delete cascade,
  step         smallint not null check (step between 1 and 5),
  state        text not null default 'not_started'
                 check (state in ('not_started', 'in_progress', 'done', 'skipped')),
  note         text,
  happened_on  date,
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (brand_id, step)
);

alter table public.brand_commercial_progress enable row level security;
grant select, insert, update, delete on public.brand_commercial_progress to authenticated;
grant all on public.brand_commercial_progress to service_role;

drop policy if exists "admin: all on brand_commercial_progress" on public.brand_commercial_progress;
create policy "admin: all on brand_commercial_progress" on public.brand_commercial_progress
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- ── 6. One read for the whole screen ─────────────────────────────────────────
-- The cycle screen needs, per brand: what has been generated, what each step
-- still needs, and the manual marker. Eight round trips from the browser for
-- that is why the old panel felt slow, so it is one call.
--
-- SECURITY DEFINER, so it must check the caller itself: it reads across brands
-- and returns every insurer quote on file. A brand user reaching this for a
-- competitor's perimeter would be a real leak, and RLS on the underlying tables
-- does not apply inside a definer function.
create or replace function public.commercial_cycle_overview(p_brand_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'AION admin only' using errcode = '42501';
  end if;

  return (select jsonb_build_object(
    'brand', (select jsonb_build_object(
                'id', b.id, 'name', b.name, 'website', b.website, 'slug', b.slug,
                'logo_small', b.logo_small,
                'legal_name', b.name,
                'address', nullif(concat_ws(', ', b.hq_address, b.hq_postcode, b.hq_city, b.hq_country), ''))
              from public.brands b where b.id = p_brand_id),
    'artifacts', coalesce((select jsonb_object_agg(o.template_key, jsonb_build_object(
                    'storage_path', o.storage_path,
                    'generated_at', o.generated_at,
                    'slots_filled', jsonb_array_length(coalesce(o.slots_filled, '[]'::jsonb))))
                  from public.brand_deck_outputs o where o.brand_id = p_brand_id), '{}'::jsonb),
    'progress', coalesce((select jsonb_object_agg(p.step::text, jsonb_build_object(
                    'state', p.state, 'note', p.note,
                    'happened_on', p.happened_on, 'updated_at', p.updated_at))
                  from public.brand_commercial_progress p where p.brand_id = p_brand_id), '{}'::jsonb),
    'counts', jsonb_build_object(
       'products',   (select count(*) from public.storefront_products where brand_id = p_brand_id),
       'knowledge_chunks', (select count(*) from public.brand_knowledge_chunks where brand_id = p_brand_id),
       'customers',  (select count(*) from public.profiles
                       where brand_id = p_brand_id and (role is null or role = 'customer')),
       'policies',   (select count(*) from public.policies where brand_id = p_brand_id),
       'brand_users',(select count(*) from public.profiles
                       where brand_id = p_brand_id and role in ('brand', 'brand_admin', 'brand_user'))),
    -- Which categories this brand can actually be priced on, and whether the
    -- rate would be its own or borrowed. Step 4 is blocked without this and the
    -- old screen only found out after you pressed Calculate.
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
                    'category', q.category, 'coverage', q.coverage,
                    'damage_scope', q.damage_scope, 'rate_of_cogs', q.rate_of_cogs,
                    'quoted_for', q.quoted_for, 'quoted_at', q.quoted_at,
                    'own_quote', coalesce(q.brand_id = p_brand_id, false))
                    order by q.category, q.coverage)
                  from public.insurance_quotes q where q.active), '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.commercial_cycle_overview(bigint) from public, anon;
grant execute on function public.commercial_cycle_overview(bigint) to authenticated, service_role;
