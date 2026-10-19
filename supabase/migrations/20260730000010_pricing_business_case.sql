-- Business case: the pricing model behind step 4 of the commercial cycle.
--
-- Today this is a spreadsheet rebuilt per prospect (28052026_Ferragamo_Dataroom
-- .xlsx, 9 sheets) and then hand-copied into a deck. The model itself is stable —
-- what changes is the brand's perimeter and which insurer quote applies. So the
-- quotes become data, the model becomes a function, and the deck becomes output.
--
-- The mechanics, taken from the Ferragamo dataroom so the numbers reconcile with
-- what has already been shown to clients:
--   value covered   = revenues covered x COGS ratio
--   gross premium   = value covered x the insurer rate FOR THAT CATEGORY
--   net premium     = gross premium x (1 - 0.2225)      (GVT fee)
--   AION insurance  = net premium x AION's share (30%)
--   AION cover fees = setup + service (monthly, tiered) + activation (% of GMV)
--   AION total      = AION insurance + AION cover fees
--
-- IMPORTANT: an insurer quote belongs to the client it was quoted for. Roberto
-- Coin's jewellery rate is not Pasquale Bruni's rate. Every quote here records
-- who it was quoted for and when, every output carries that provenance, and a
-- business case built on someone else's quote is marked indicative — deciding
-- whether to show it is a commercial call, not a default.

create table if not exists public.insurance_quotes (
  id            bigserial primary key,
  insurer       text not null default 'Chubb',
  -- Who this was actually quoted for. NULL = a generic/indicative rate.
  quoted_for    text,
  brand_id      bigint references public.brands(id) on delete set null,
  category      text not null,                       -- watches | bags | jewellery | apparel | …
  coverage      text not null default 'theft_and_damage'
                  check (coverage in ('theft', 'theft_and_damage')),
  -- rate applied to COGS, not to retail
  rate_of_cogs  numeric not null,
  duration_years numeric not null default 2,
  claims_allowed text,                                -- e.g. "1 theft, 2 AD"
  volume_note   text,
  source        text,                                 -- where the number came from
  quoted_at     date,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists insurance_quotes_lookup on public.insurance_quotes (category, coverage, active);

-- AION's own commercial terms — tiered by covered GMV.
create table if not exists public.aion_pricing_terms (
  id                    bigserial primary key,
  key                   text not null unique,
  setup_fee             numeric not null default 20000,
  setup_discount        numeric not null default 0.5,
  api_fee               numeric not null default 10000,
  -- [{tier, gmv_up_to, activation_fee_pct, service_fee_month}]
  tiers                 jsonb not null,
  service_discount      numeric not null default 0.5,
  service_discount_months integer not null default 6,
  gvt_fee               numeric not null default 0.2225,   -- gross → net premium
  aion_premium_share    numeric not null default 0.30,
  vat                   numeric not null default 0.22,
  note                  text,
  created_at            timestamptz not null default now()
);

insert into public.aion_pricing_terms (key, tiers, note) values (
  'standard_2026',
  '[{"tier":1,"gmv_up_to":20000000,"activation_fee_pct":0.0015,"service_fee_month":1000},
    {"tier":2,"gmv_up_to":100000000,"activation_fee_pct":0.0010,"service_fee_month":1500},
    {"tier":3,"gmv_up_to":null,"activation_fee_pct":0.0008,"service_fee_month":null}]'::jsonb,
  'From the Ferragamo dataroom Pricing sheet. Tier 3 service fee is on quotation.'
) on conflict (key) do update set tiers = excluded.tiers, note = excluded.note;

-- Quotes actually received. Only what can be traced to a source is seeded here;
-- anything else must be entered with its own provenance.
insert into public.insurance_quotes
  (insurer, quoted_for, brand_id, category, coverage, rate_of_cogs, duration_years, claims_allowed, source, quoted_at)
values
  ('Chubb', 'Salvatore Ferragamo S.p.A.', null, 'watches',   'theft_and_damage', 0.0283, 2, '1 theft, 2 AD', '28052026_Ferragamo_Dataroom.xlsx — Pricing sheet', '2026-05-28'),
  ('Chubb', 'Salvatore Ferragamo S.p.A.', null, 'bags',      'theft_and_damage', 0.0778, 2, '1 theft, 2 AD', '28052026_Ferragamo_Dataroom.xlsx — Pricing sheet (exotic bags)', '2026-05-28')
on conflict do nothing;

-- Roberto Coin and Pomellato carry their agreed premium on the brand record;
-- mirror it here so the model has one place to look, with that provenance.
insert into public.insurance_quotes
  (insurer, quoted_for, brand_id, category, coverage, rate_of_cogs, duration_years, source, quoted_at)
select 'Chubb', b.name, b.id, 'jewellery', 'theft_and_damage', b.insurance_premium, 2,
       'brands.insurance_premium (agreed programme rate)', current_date
from public.brands b
where b.insurance_premium is not null and b.insurance_premium > 0
  and not exists (select 1 from public.insurance_quotes q where q.brand_id = b.id);

alter table public.insurance_quotes   enable row level security;
alter table public.aion_pricing_terms enable row level security;
grant select on public.insurance_quotes   to authenticated;
grant select on public.aion_pricing_terms to authenticated;
grant all    on public.insurance_quotes   to service_role;
grant all    on public.aion_pricing_terms to service_role;

drop policy if exists "admin: all on insurance_quotes" on public.insurance_quotes;
create policy "admin: all on insurance_quotes" on public.insurance_quotes for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
drop policy if exists "admin: all on aion_pricing_terms" on public.aion_pricing_terms;
create policy "admin: all on aion_pricing_terms" on public.aion_pricing_terms for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- ── The model ────────────────────────────────────────────────────────────────
-- p_segments: [{"name":"Pilot Bags","category":"bags","revenues":10000000,
--               "cogs_ratio":0.295,"start_month":6},…]
-- Returns the same figures the dataroom produces, per year and per product,
-- plus the provenance of every rate used.
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
  v_annual     jsonb := '[]'::jsonb;
  v_year       integer;
  v_months_live numeric;
  v_rev        numeric; v_cogs numeric; v_gross numeric;
  y_rev numeric; y_cogs numeric; y_gross numeric; y_units numeric;
  v_tier       jsonb;
  v_act_pct    numeric; v_svc numeric;
  v_setup      numeric; v_service numeric; v_activation numeric;
  v_total_rev  numeric := 0; v_total_gross numeric := 0; v_total_units numeric := 0;
begin
  select * into t from public.aion_pricing_terms where key = p_terms_key;
  if t is null then raise exception 'pricing terms % not found', p_terms_key; end if;

  -- Per segment: resolve the rate, then spread the revenue over the months it is live.
  for seg in select * from jsonb_array_elements(p_segments) loop
    select * into v_quote from public.insurance_quotes q
     where q.active
       and q.category = lower(seg->>'category')
       and q.coverage = coalesce(seg->>'coverage', 'theft_and_damage')
     order by (q.brand_id = p_brand_id) desc, q.quoted_at desc nulls last
     limit 1;

    if v_quote is null then
      return jsonb_build_object('ok', false,
        'reason', format('no insurer quote on file for category "%s" — add the quote before building a case', seg->>'category'));
    end if;

    v_rate := v_quote.rate_of_cogs;
    v_provenance := v_provenance || jsonb_build_object(
      'segment', seg->>'name', 'category', seg->>'category',
      'rate_of_cogs', v_rate, 'insurer', v_quote.insurer,
      'quoted_for', v_quote.quoted_for, 'quoted_at', v_quote.quoted_at,
      'source', v_quote.source,
      'own_quote', coalesce(v_quote.brand_id = p_brand_id, false));

    v_months_live := greatest(0, p_months - coalesce((seg->>'start_month')::numeric, 1) + 1);
    v_rev  := coalesce((seg->>'revenues')::numeric, 0) * (v_months_live / nullif(p_months, 0));
    v_cogs := v_rev * coalesce((seg->>'cogs_ratio')::numeric, 0.30);
    v_gross := v_cogs * v_rate;

    v_rows := v_rows || jsonb_build_object(
      'segment', seg->>'name', 'category', seg->>'category',
      'revenues_covered', round(v_rev), 'value_covered', round(v_cogs),
      'rate_of_cogs', v_rate, 'gross_premium', round(v_gross),
      'units', case when (seg->>'avg_price') is not null and (seg->>'avg_price')::numeric > 0
                    then round(v_rev / (seg->>'avg_price')::numeric) else null end);

    v_total_rev := v_total_rev + v_rev;
    v_total_gross := v_total_gross + v_gross;
    if (seg->>'avg_price') is not null and (seg->>'avg_price')::numeric > 0 then
      v_total_units := v_total_units + v_rev / (seg->>'avg_price')::numeric;
    end if;
  end loop;

  -- AION's tier follows the covered GMV.
  select value into v_tier from jsonb_array_elements(t.tiers) value
   where (value->>'gmv_up_to') is null or v_total_rev <= (value->>'gmv_up_to')::numeric
   order by coalesce((value->>'gmv_up_to')::numeric, 1e18) limit 1;

  v_act_pct := coalesce((v_tier->>'activation_fee_pct')::numeric, 0.0008);
  v_svc     := (v_tier->>'service_fee_month')::numeric;

  v_setup      := t.setup_fee * (case when p_setup_discounted then (1 - t.setup_discount) else 1 end)
                  + (case when p_include_api then t.api_fee else 0 end);
  v_service    := case when v_svc is null then 0
                       else v_svc * (p_months - t.service_discount_months)
                          + v_svc * (1 - t.service_discount) * least(t.service_discount_months, p_months) end;
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
      'service_note', case when v_svc is null then 'tier 3 service fee is on quotation' else null end),
    'aion_total_revenue', round(v_total_gross * (1 - t.gvt_fee) * t.aion_premium_share + v_setup + v_service + v_activation),
    'total_cost_to_brand', round(v_total_gross + v_setup + v_service + v_activation),
    'per_product', case when v_total_units > 0 then jsonb_build_object(
        'insurer_fee', round(v_total_gross / v_total_units, 2),
        'aion_fee', round((v_service + v_activation) / v_total_units, 2),
        'total', round((v_total_gross + v_service + v_activation) / v_total_units, 2),
        'total_pct_of_price', round((v_total_gross + v_service + v_activation) / v_total_rev, 4),
        'total_pct_of_price_incl_vat', round((v_total_gross + v_service + v_activation) / v_total_rev * (1 + t.vat), 4)
      ) else null end,
    'rates_used', v_provenance,
    -- Loud on purpose: a rate quoted for another house is indicative only.
    'indicative', exists (select 1 from jsonb_array_elements(v_provenance) p where (p->>'own_quote')::boolean is not true)
  );
end;
$$;

revoke all on function public.compute_business_case(bigint, jsonb, integer, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.compute_business_case(bigint, jsonb, integer, text, boolean, boolean) to service_role;
