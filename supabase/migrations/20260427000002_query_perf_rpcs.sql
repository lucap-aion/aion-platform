-- ============================================================
-- Query performance: server-side aggregation RPCs
-- Replaces multi-roundtrip client patterns with one DB call.
-- Returns the same data the client computes today; no behaviour change.
-- ============================================================

-- ─── Brand dashboard metrics ────────────────────────────────
-- Replaces 4 parallel queries in BrandDashboard.tsx (customer count,
-- cover count, open-claim count, sum(selling_price)) with one round
-- trip. Subqueries are independently planned and use existing indexes.
CREATE OR REPLACE FUNCTION public.brand_dashboard_metrics(
  p_brand_id int
)
RETURNS TABLE (
  customers        bigint,
  covers           bigint,
  open_claims      bigint,
  protected_value  numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    (SELECT count(*)::bigint
       FROM public.profiles
       WHERE brand_id = p_brand_id
         AND (role = 'customer' OR role IS NULL))               AS customers,
    (SELECT count(*)::bigint
       FROM public.policies
       WHERE brand_id = p_brand_id)                             AS covers,
    (SELECT count(*)::bigint
       FROM public.claims c
       JOIN public.policies p ON p.id = c.policy_id
       WHERE c.status = 'open' AND p.brand_id = p_brand_id)     AS open_claims,
    (SELECT coalesce(sum(selling_price), 0)::numeric
       FROM public.policies
       WHERE brand_id = p_brand_id)                             AS protected_value
$$;

GRANT EXECUTE ON FUNCTION public.brand_dashboard_metrics(int)
  TO authenticated, anon;

-- ─── Per-customer aggregates for BrandCustomers list ────────
-- Replaces three sequential client queries (a duplicate policies fetch
-- and a claims join) used to compute covers/claims/value per customer
-- on the visible page (≤ PAGE_SIZE rows). RLS still applies, so users
-- only see aggregates over rows they can already SELECT.
CREATE OR REPLACE FUNCTION public.brand_customer_aggregates(
  p_customer_ids uuid[]
)
RETURNS TABLE (
  customer_id  uuid,
  covers       bigint,
  claims       bigint,
  total_value  numeric
)
LANGUAGE sql STABLE
AS $$
  WITH cust_policies AS (
    SELECT p.id, p.customer_id, p.selling_price
    FROM public.policies p
    WHERE p.customer_id = ANY(p_customer_ids)
  ),
  claim_counts AS (
    SELECT cp.customer_id, count(c.id)::bigint AS claims
    FROM cust_policies cp
    LEFT JOIN public.claims c ON c.policy_id = cp.id
    GROUP BY cp.customer_id
  )
  SELECT
    cp.customer_id,
    count(cp.id)::bigint                                    AS covers,
    coalesce(cc.claims, 0)::bigint                          AS claims,
    coalesce(sum(cp.selling_price), 0)::numeric             AS total_value
  FROM cust_policies cp
  LEFT JOIN claim_counts cc ON cc.customer_id = cp.customer_id
  GROUP BY cp.customer_id, cc.claims
$$;

GRANT EXECUTE ON FUNCTION public.brand_customer_aggregates(uuid[])
  TO authenticated, anon;
