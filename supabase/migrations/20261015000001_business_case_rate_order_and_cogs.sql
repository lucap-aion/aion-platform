-- The house's own quote prices first, and the record holds a COGS ratio per category.
--
-- Giulio, 2026-10-15, on the order 20261014000002 applied (record category → own quote →
-- borrowed quote → record house-wide): "the right order is quote for the brand, category rate
-- on the Record, general rate on the Record, quote for another brand." A quote the insurer
-- issued for THIS house is the price; the record's rates are what AION expects it to be; a
-- quote for another house is only a comparable. So, per segment:
--
--   insurer rate   own quote → record category → record house-wide → borrowed quote
--
--   own quote          insurance_quotes row with brand_id = this house, same pricing class
--                      and cover. The insurer's price for this house: firm.
--   record category    brand_category_fees.insurance_premium for the segment's category.
--                      Agreed for this house and category: firm.
--   record house-wide  brands.insurance_premium. Agreed for this house, not for this
--                      category: INDICATIVE.
--   borrowed quote     a quote issued for another house, same class and cover. Not a price
--                      for this house at all: INDICATIVE, and its house is never named on a slide.
--
-- "Record → Category list → the COGS % are per category." The cost of goods as a share of the
-- retail price was typed per segment on the business case (30% unless changed) and known
-- nowhere else. brand_category_fees.cogs_ratio holds it per category; a segment uses its own
-- figure (the returned data request, or one typed on the case), else the record's, else 30%.

ALTER TABLE public.brand_category_fees
  ADD COLUMN IF NOT EXISTS cogs_ratio numeric
  CHECK (cogs_ratio IS NULL OR (cogs_ratio > 0 AND cogs_ratio <= 1));

COMMENT ON COLUMN public.brand_category_fees.cogs_ratio IS
  'Cost of goods as a fraction of the retail price, for this category. The insurance premium is a rate on it. Null = the business case''s 30% default.';

CREATE OR REPLACE FUNCTION public.compute_business_case(p_brand_id bigint, p_segments jsonb, p_months integer DEFAULT 36, p_terms_key text DEFAULT 'standard_2026'::text, p_include_api boolean DEFAULT false, p_setup_discounted boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_cogs_ratio numeric;
  v_rev        numeric; v_cogs numeric; v_gross numeric; v_units numeric;
  v_tier       jsonb;
  v_act_pct    numeric; v_svc numeric;
  v_setup      numeric; v_service numeric; v_activation numeric;
  v_full_months numeric; v_disc_months numeric;
  v_total_rev  numeric := 0; v_total_gross numeric := 0; v_total_units numeric := 0;
  v_band_miss  boolean := false;
  b            record;
  v_cat        record;
  v_has_cat    boolean;
  v_source     text;
  v_act_seg    numeric;
  v_share      numeric;
  v_aion_ins   numeric := 0;
  v_act_known  numeric := 0;
  v_rev_tiered numeric := 0;
  v_q          jsonb;
  v_any_record_act boolean := false;
begin
  select * into t from public.aion_pricing_terms where key = p_terms_key;
  if not found then raise exception 'pricing terms % not found', p_terms_key; end if;
  select insurance_premium, activation_fee, aion_premium_fee into b
    from public.brands where id = p_brand_id;
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

    -- The record's row for this category: by the name the segment carries (the data request
    -- names its segments after the record's categories), else by pricing class.
    select f.* into v_cat from public.brand_category_fees f
     where f.brand_id = p_brand_id
       and (lower(coalesce(nullif(btrim(f.label), ''), f.category)) = lower(btrim(seg->>'name'))
            or f.category = lower(seg->>'category'))
     order by (lower(coalesce(nullif(btrim(f.label), ''), f.category)) = lower(btrim(seg->>'name'))) desc, f.id
     limit 1;
    v_has_cat := found;

    -- The rate, in this order (see the header):
    --   1. an insurer quote for this house;
    --   2. the record's category rate;
    --   3. the record's house-wide rate;
    --   4. an insurer quote for another house, same category and cover.
    v_source := null;
    -- The quote as jsonb, null when none was used: a record variable that was never
    -- assigned cannot even be asked for a field.
    v_q := null;
    -- Most specific first: a quote whose volume band contains this perimeter beats one
    -- quoted at a different scale; a quote for the damage scope asked for beats one that
    -- never stated it. Only then, the most recent. Asked twice — this house's, then anyone's —
    -- because the record sits between the two.
    select * into v_quote from public.insurance_quotes q
     where q.active and q.brand_id = p_brand_id
       and q.category = lower(seg->>'category')
       and q.coverage = v_coverage
       and (v_scope is null or q.damage_scope is null or q.damage_scope = v_scope)
     order by
       (q.gmv_from is not null and v_rev >= q.gmv_from
        and (q.gmv_to is null or v_rev <= q.gmv_to)) desc,
       (q.damage_scope is not distinct from v_scope) desc,
       q.quoted_at desc nulls last
     limit 1;
    if found then
      v_q := to_jsonb(v_quote);
      v_rate := v_quote.rate_of_cogs; v_source := 'own_quote';
    elsif v_has_cat and v_cat.insurance_premium is not null then
      v_rate := v_cat.insurance_premium; v_source := 'record_category';
    elsif b.insurance_premium is not null then
      v_rate := b.insurance_premium; v_source := 'record_brand';
    else
      select * into v_quote from public.insurance_quotes q
       where q.active and q.brand_id is distinct from p_brand_id
         and q.category = lower(seg->>'category')
         and q.coverage = v_coverage
         and (v_scope is null or q.damage_scope is null or q.damage_scope = v_scope)
       order by
         (q.gmv_from is not null and v_rev >= q.gmv_from
          and (q.gmv_to is null or v_rev <= q.gmv_to)) desc,
         (q.damage_scope is not distinct from v_scope) desc,
         q.quoted_at desc nulls last
       limit 1;
      if found then
        v_q := to_jsonb(v_quote);
        v_rate := v_quote.rate_of_cogs; v_source := 'borrowed_quote';
      else
        return jsonb_build_object('ok', false,
          'reason', format('no rate for "%s" — set an insurance premium on the brand record (per category or house-wide), or add a %s quote',
                           seg->>'name', replace(v_coverage, '_', ' ')));
      end if;
    end if;

    -- AION's two percentages, from the record when it states them: per category, then
    -- house-wide, then the standard terms.
    v_act_seg := coalesce(case when v_has_cat then v_cat.activation_fee end, b.activation_fee);
    v_any_record_act := v_any_record_act or v_act_seg is not null;
    v_share := coalesce(case when v_has_cat then v_cat.aion_premium_fee end, b.aion_premium_fee, t.aion_premium_share);

    -- A rate quoted at a very different volume is still usable, but saying so is
    -- the difference between a model and a misquote.
    if v_q is not null and (v_q->>'gmv_from') is not null
       and (v_rev < (v_q->>'gmv_from')::numeric
            or ((v_q->>'gmv_to') is not null and v_rev > (v_q->>'gmv_to')::numeric)) then
      v_band_miss := true;
      v_notes := v_notes || format('%s: rate was quoted for a %s–%s volume band, this segment declares %s',
                                   seg->>'name', round((v_q->>'gmv_from')::numeric),
                                   coalesce(round((v_q->>'gmv_to')::numeric)::text, 'no cap'), round(v_rev));
    end if;

    v_provenance := v_provenance || jsonb_build_object(
      'quote_id', (v_q->>'id')::bigint,
      'segment', seg->>'name', 'category', seg->>'category',
      'coverage', coalesce(v_q->>'coverage', v_coverage), 'damage_scope', coalesce(v_q->>'damage_scope', v_scope),
      'rate_of_cogs', v_rate, 'insurer', v_q->>'insurer',
      'quoted_for', v_q->>'quoted_for', 'quoted_at', v_q->>'quoted_at',
      'gmv_from', (v_q->>'gmv_from')::numeric, 'gmv_to', (v_q->>'gmv_to')::numeric,
      'source', case when v_source = 'record_category' then v_cat.note else v_q->>'source' end,
      'rate_source', v_source,
      -- A rate a person put on THIS house's record counts as its own, like its own quote.
      'own_quote', v_source in ('own_quote', 'record_category'));

    -- Declared revenue is the figure for the WHOLE modelled period; a segment
    -- that starts late only contributes the months it is live for.
    v_months_live := greatest(0, p_months - coalesce((seg->>'start_month')::numeric, 1) + 1);
    v_rev  := v_rev * (v_months_live / p_months);
    -- The segment's own COGS ratio, else the record's for its category, else 30%.
    v_cogs_ratio := coalesce(nullif((seg->>'cogs_ratio')::numeric, 0),
                             case when v_has_cat then v_cat.cogs_ratio end, 0.30);
    v_cogs := v_rev * v_cogs_ratio;
    v_gross := v_cogs * v_rate;
    v_units := case when coalesce((seg->>'avg_price')::numeric, 0) > 0
                    then v_rev / (seg->>'avg_price')::numeric else null end;

    v_rows := v_rows || jsonb_build_object(
      'segment', seg->>'name', 'category', seg->>'category',
      'coverage', v_coverage, 'damage_scope', v_scope,
      'months_live', v_months_live,
      'revenues_covered', round(v_rev), 'value_covered', round(v_cogs),
      'cogs_ratio', v_cogs_ratio,
      'rate_of_cogs', v_rate, 'gross_premium', round(v_gross),
      'rate_source', v_source,
      'activation_fee_pct', v_act_seg,
      'aion_premium_share', v_share,
      'units', case when v_units is not null then round(v_units) else null end);

    v_total_rev := v_total_rev + v_rev;
    v_total_gross := v_total_gross + v_gross;
    v_total_units := v_total_units + coalesce(v_units, 0);
    v_aion_ins := v_aion_ins + v_gross * (1 - t.gvt_fee) * v_share;
    -- Remembered per segment; segments without a record rate take the tier's, below.
    if v_act_seg is not null then v_act_known := v_act_known + v_rev * v_act_seg;
    else v_rev_tiered := v_rev_tiered + v_rev; end if;
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

  -- Segments the record gives an activation rate to were charged at it in the loop; the
  -- rest take the tier's rate, now that the total — and so the tier — is known.
  v_activation := v_act_known + v_rev_tiered * v_act_pct;

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
    'aion_insurance_revenue', round(v_aion_ins),
    'aion_fees', jsonb_build_object(
      'setup', round(v_setup), 'service', round(v_service), 'activation', round(v_activation),
      'total', round(v_setup + v_service + v_activation),
      'tier', (v_tier->>'tier')::int,
      'service_fee_month', v_svc,
      'service_months_full', v_full_months,
      'service_months_discounted', v_disc_months,
      -- The discounts the totals apply, so a deck can say what they are and where they come from.
      'service_discount', t.service_discount,
      'setup_discount', case when p_setup_discounted then t.setup_discount else 0 end,
      'terms_key', t.key,
      'service_note', case when v_svc is null then 'tier 3 service fee is on quotation' else null end,
      'activation_from_record', v_any_record_act),
    'aion_total_revenue', round(v_aion_ins + v_setup + v_service + v_activation),
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
    -- A borrowed quote, or the record's house-wide default, is not a price for this house.
    'indicative', exists (select 1 from jsonb_array_elements(v_provenance) p
                           where p->>'rate_source' in ('borrowed_quote', 'record_brand'))
  );
end;
$function$

;
