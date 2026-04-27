-- ============================================================
-- Admin dashboard counts: single-RPC, verified-brands-only.
-- Replaces 5 client round trips (brands/shops/customers + 3
-- claims status counts) with one server-side aggregation, and
-- ensures every count excludes unverified brands' rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_dashboard_counts()
RETURNS TABLE (
  brands         bigint,
  shops          bigint,
  customers      bigint,
  claims         bigint,
  open_claims    bigint,
  closed_claims  bigint
)
LANGUAGE sql STABLE
AS $$
  WITH verified_brands AS (
    SELECT id FROM public.brands WHERE status = 'verified'
  )
  SELECT
    (SELECT count(*)::bigint FROM verified_brands)                                                AS brands,
    (SELECT count(*)::bigint FROM public.shops s
       WHERE s.brand_id IN (SELECT id FROM verified_brands))                                       AS shops,
    (SELECT count(*)::bigint FROM public.profiles p
       WHERE p.role = 'customer'
         AND p.brand_id IN (SELECT id FROM verified_brands))                                       AS customers,
    (SELECT count(*)::bigint FROM public.claims c
       JOIN public.policies pol ON pol.id = c.policy_id
       WHERE pol.brand_id IN (SELECT id FROM verified_brands))                                     AS claims,
    (SELECT count(*)::bigint FROM public.claims c
       JOIN public.policies pol ON pol.id = c.policy_id
       WHERE c.status = 'open'
         AND pol.brand_id IN (SELECT id FROM verified_brands))                                     AS open_claims,
    (SELECT count(*)::bigint FROM public.claims c
       JOIN public.policies pol ON pol.id = c.policy_id
       WHERE c.status = 'closed'
         AND pol.brand_id IN (SELECT id FROM verified_brands))                                     AS closed_claims;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_counts()
  TO authenticated, anon;
