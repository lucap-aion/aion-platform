-- Reconciling a trunk show — run this AFTER the show closes and the goods are
-- back / invoiced. Not a migration: a template to copy, fill and run.
--
-- Until you run it, every piece has outcome = NULL, which the assistant reports
-- as "not counted yet". That is deliberate — see 20260730000002_event_items.sql.
-- The moment you set outcomes, sell-through, revenue and per-client attribution
-- start answering.
--
-- Current example: Trunk Show Hamptons 2026 (event_id 5, brand 17, 51 pieces).

-- ── 1. What still needs an outcome ───────────────────────────────────────────
select article, description, category, size, size_scale, colour_name, ddt_number
from public.event_items
where event_id = 5 and outcome is null
order by category, article;

-- ── 2. SOLD — one row per piece that sold. Fill in buyer + price. ────────────
-- customer_name is fine for knowledge-base brands (Luisa Beccaria has no CRM
-- profile rows); use customer_id when the buyer IS a profile.
update public.event_items i
set outcome       = 'sold',
    sold_qty      = v.sold_qty,
    revenue       = v.revenue,
    customer_name = v.customer_name,
    reconciled_at = now()
from (values
  -- (article,              sold_qty, revenue, customer_name)
  ('W26-41968-8240',        1,        2400,    'Jane Lauder'),
  ('P27-41996-7038',        1,        1980,    'Aerin Lauder')
) as v(article, sold_qty, revenue, customer_name)
where i.event_id = 5 and i.article = v.article;

-- ── 3. RETAINED — left with the client on approval, not yet invoiced ─────────
update public.event_items
set outcome = 'retained', reconciled_at = now()
where event_id = 5 and article in ('P26-41957-1394');

-- ── 4. RETURNED — everything else came back. Run LAST. ───────────────────────
update public.event_items
set outcome = 'returned', reconciled_at = now()
where event_id = 5 and outcome is null;

-- ── 5. Roll the totals up onto the event ─────────────────────────────────────
update public.events e
set revenue = s.revenue_from_items,
    status  = 'completed'
from public.event_sell_through s
where s.event_id = e.id and e.id = 5;

-- ── 6. Check ─────────────────────────────────────────────────────────────────
-- fully_reconciled must be true and sell_through_pct must stop being null.
select * from public.event_sell_through where event_id = 5;

select outcome, count(*)::int as pezzi, sum(revenue) as ricavo
from public.event_items where event_id = 5
group by outcome order by 2 desc;
