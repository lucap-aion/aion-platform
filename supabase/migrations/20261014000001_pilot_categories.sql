-- The pilot's categories live on the record, one row each.
--
-- "The brand should say 'we are interested in these categories', we fill that in somewhere,
-- and for each category we do a data request. My understanding is that this comes from
-- Record → Per category rates → Category 1, 2, 3, n." And again, on the list: "Categories
-- should flow into NDA & Data Request (instead of product focus, which is one field and
-- cannot split into multiple categories)."
--
-- He was told on 2026-09-23 that the segments came from brands.product_focus, and that the
-- rate table only prices categories. That was true of the code and wrong as a design: a
-- comma-separated text field is not a list anybody can see as one, and the table that
-- already had a row per category was the obvious place to say which categories the pilot
-- covers. So it now does both: a row here is a category IN the pilot, and its rate cells
-- are optional overrides of the house-wide rates, exactly as before.
--
-- Two names per row, because two vocabularies meet here:
--   label     what the client reads on the data request — "Bags and leather goods"
--   category  the pricing class it is quoted as — bags. Lower case, joined against
--             insurance_quotes.category, unchanged.
-- Several labels may share a class (Eyewear and Accessories are both 'other'), so the
-- uniqueness moves from the class to the name a person reads.
--
-- Additive and forward-compatible: a client that does not know `label` inserts rows with
-- it null, and a null label reads as the class, capitalised.

alter table public.brand_category_fees
  add column if not exists label text;

comment on column public.brand_category_fees.label is
  'The category as the client reads it on the data request ("Bags and leather goods"). '
  'Null reads as the pricing class, capitalised. One data-request segment per row.';

alter table public.brand_category_fees
  drop constraint if exists brand_category_fees_brand_id_category_key;

create unique index if not exists brand_category_fees_brand_label_key
  on public.brand_category_fees (brand_id, lower(coalesce(nullif(btrim(label), ''), category)));

comment on table public.brand_category_fees is
  'The pilot''s categories — one row per category the programme covers, one data-request '
  'segment each — and per-category overrides of the brand-level fee rates. A null rate means '
  '"use the brand-level value", never zero. brands.* stays the fallback and stays what live '
  'policies and the Chubb export are priced from.';

-- ── Every prospect starts from what its record already said ─────────────────────────────
-- Without this, every house with a focus and no rows would see an empty table on the record
-- the day the data request starts reading it. The focus vocabulary is fixed
-- (_shared/focus-ai.ts FOCUS_VOCABULARY), so the mapping to a pricing class is too — and it
-- is the same one src/lib/commercialCycle.ts pricingClassFor() applies when an admin adds a
-- category by hand. Prospects only: a live client's data request was sent long ago.
insert into public.brand_category_fees (brand_id, category, label)
select b.id,
       case lower(c.label)
         when 'high jewellery'         then 'jewellery'
         when 'jewellery'              then 'jewellery'
         when 'watches'                then 'watches'
         when 'bags and leather goods' then 'bags'
         when 'bags'                   then 'bags'
         when 'ready-to-wear'          then 'apparel'
         when 'shoes'                  then 'leather'
         else 'other'
       end,
       c.label
from public.brands b
cross join lateral (
  select btrim(x) as label, ord
  from regexp_split_to_table(b.product_focus, '[,;/•]') with ordinality as t(x, ord)
  where btrim(x) <> ''
  order by ord
  limit 8
) c
where b.is_prospect
  and coalesce(btrim(b.product_focus), '') <> ''
  and not exists (select 1 from public.brand_category_fees f where f.brand_id = b.id)
-- Rows are listed in id order, so the house's own order of categories survives.
order by b.id, c.ord
on conflict do nothing;
