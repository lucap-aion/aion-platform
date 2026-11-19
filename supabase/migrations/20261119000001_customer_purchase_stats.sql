-- One row per client per house: how many times they bought, counted one way.
--
-- The assistants were deriving "returning customers" from raw policies on every
-- question and never the same way twice — covers > 1 (184 for one house), distinct
-- start_date timestamps (66), live only (39), every status (47). start_date is a
-- timestamptz, so two pieces sold in one visit are two "dates". This view is the
-- single source both assistants read; the rule is the one brand_customer_segments
-- already uses for VIPs: a purchase day is a Rome calendar day with a cover that
-- was not cancelled.
--
-- security_invoker: the caller's RLS applies, so the brand-scoped runner
-- (ai_run_query_scoped) still sees one house only.
create or replace view public.customer_purchase_stats
with (security_invoker = true) as
select
  po.brand_id,
  b.name                                                             as brand,
  coalesce(b.is_prospect, false)                                     as is_prospect,
  po.customer_id,
  count(distinct (po.start_date at time zone 'Europe/Rome')::date)::int as purchase_days,
  count(distinct po.brand_sale_id)::int                              as orders,
  count(*)::int                                                      as covers,
  (count(*) filter (where po.status = 'live'))::int                  as covers_live,
  coalesce(sum(po.selling_price), 0)::numeric                        as spend,
  min((po.start_date at time zone 'Europe/Rome')::date)              as first_purchase_day,
  max((po.start_date at time zone 'Europe/Rome')::date)              as last_purchase_day,
  count(distinct (po.start_date at time zone 'Europe/Rome')::date) >= 2 as is_returning,
  bool_or(pr.registered_at is not null)                              as is_registered,
  -- the set every admin dashboard card totals: a verified house that is not a prospect
  (b.status = 'verified' and coalesce(b.is_prospect, false) = false)  as is_client_brand
from public.policies po
left join public.brands   b  on b.id  = po.brand_id
left join public.profiles pr on pr.id = po.customer_id
where po.status is distinct from 'cancelled'
  and po.customer_id is not null
  and coalesce(pr.role, 'customer') = 'customer'
group by po.brand_id, b.name, b.is_prospect, b.status, po.customer_id;

comment on view public.customer_purchase_stats is
  'Per client per house: purchase_days (Rome days, cancelled excluded), orders (receipts), covers, spend, is_returning (purchase_days >= 2), is_registered. The one definition of a returning customer.';

revoke all on public.customer_purchase_stats from anon;
grant select on public.customer_purchase_stats to authenticated, service_role;
