-- ============================================================
-- Engagement pool now also reacts to Period and Shop filters.
--
-- Previous version (20260504000002) deliberately ignored period
-- and shop on the engagement pool, applying them only to policy-
-- side scopes. That left the Registration / Profilation /
-- Feedback Rate cards static when the user changed month, year,
-- week, or store — which contradicts user expectation.
--
-- New semantics for the pool (Registration / Profilation /
-- Feedback Rate denominator and numerator):
--
--   Brand        → profiles.brand_id = ANY(v_brand_ids)            [unchanged]
--   Customer-type→ p_customer_ids (when not null) narrows pool      [unchanged]
--                  by client-computed eligibility (New/Returning).
--   Period       → profiles.created_at in [from, to]
--                  ONLY when p_customer_ids IS NULL (customer
--                  type = "All"). When customer type is New or
--                  Returning, p_customer_ids already encodes the
--                  period via created_at; double-applying would
--                  zero out the Returning case (created_at BEFORE
--                  period ∩ IN period = ∅).
--   Shop         → EXISTS a live policy at the selected shop for
--                  that customer in the brand (and within period
--                  if set), so the pool is "customers who
--                  transacted at the shop in the window".
--
-- Claim Rate (Claims / Covers) was already filter-respecting via
-- the policy_stats CTE; no change here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_dashboard_aggregates(
  p_brand_ids     int[]       DEFAULT NULL,
  p_from_date     timestamptz DEFAULT NULL,
  p_to_date       timestamptz DEFAULT NULL,
  p_customer_ids  uuid[]      DEFAULT NULL,
  p_shop_ids      int[]       DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_ids int[];
  v_result    json;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_brand_ids IS NULL THEN
    SELECT array_agg(id) INTO v_brand_ids FROM public.brands WHERE status = 'verified';
  ELSE
    v_brand_ids := p_brand_ids;
  END IF;

  IF v_brand_ids IS NULL THEN
    v_brand_ids := ARRAY[]::int[];
  END IF;

  SELECT json_build_object(
    'brands_count',          (SELECT count(*)::bigint FROM public.brands WHERE status = 'verified'),
    'shops_count',           (SELECT count(DISTINCT pol.shop_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND pol.shop_id IS NOT NULL
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'customers_count',       (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    -- ── Engagement pool ────────────────────────────────────────
    'pool_total',            (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))
                                  -- Period applies to created_at only when customer-type = "All"
                                  -- (otherwise it's already encoded in p_customer_ids).
                                  AND (p_customer_ids IS NOT NULL OR p_from_date IS NULL OR pr.created_at >= p_from_date)
                                  AND (p_customer_ids IS NOT NULL OR p_to_date   IS NULL OR pr.created_at <= p_to_date)
                                  AND (p_shop_ids IS NULL OR EXISTS (
                                    SELECT 1 FROM public.policies pol2
                                    WHERE pol2.customer_id = pr.id
                                      AND pol2.brand_id    = pr.brand_id
                                      AND pol2.status      = 'live'
                                      AND pol2.shop_id     = ANY(p_shop_ids)
                                      AND (p_from_date IS NULL OR pol2.start_date >= p_from_date)
                                      AND (p_to_date   IS NULL OR pol2.start_date <= p_to_date)
                                  ))),
    'pool_registered',       (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND pr.registered_at IS NOT NULL
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))
                                  AND (p_customer_ids IS NOT NULL OR p_from_date IS NULL OR pr.created_at >= p_from_date)
                                  AND (p_customer_ids IS NOT NULL OR p_to_date   IS NULL OR pr.created_at <= p_to_date)
                                  AND (p_shop_ids IS NULL OR EXISTS (
                                    SELECT 1 FROM public.policies pol2
                                    WHERE pol2.customer_id = pr.id
                                      AND pol2.brand_id    = pr.brand_id
                                      AND pol2.status      = 'live'
                                      AND pol2.shop_id     = ANY(p_shop_ids)
                                      AND (p_from_date IS NULL OR pol2.start_date >= p_from_date)
                                      AND (p_to_date   IS NULL OR pol2.start_date <= p_to_date)
                                  ))),
    'pool_profiled',         (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND pr.registered_at  IS NOT NULL
                                  AND pr.date_of_birth  IS NOT NULL
                                  AND pr.country        IS NOT NULL
                                  AND pr.city           IS NOT NULL
                                  AND pr.postcode       IS NOT NULL
                                  AND pr.address        IS NOT NULL
                                  AND pr.province       IS NOT NULL
                                  AND pr.nationality    IS NOT NULL
                                  AND pr.phone_number   IS NOT NULL
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))
                                  AND (p_customer_ids IS NOT NULL OR p_from_date IS NULL OR pr.created_at >= p_from_date)
                                  AND (p_customer_ids IS NOT NULL OR p_to_date   IS NULL OR pr.created_at <= p_to_date)
                                  AND (p_shop_ids IS NULL OR EXISTS (
                                    SELECT 1 FROM public.policies pol2
                                    WHERE pol2.customer_id = pr.id
                                      AND pol2.brand_id    = pr.brand_id
                                      AND pol2.status      = 'live'
                                      AND pol2.shop_id     = ANY(p_shop_ids)
                                      AND (p_from_date IS NULL OR pol2.start_date >= p_from_date)
                                      AND (p_to_date   IS NULL OR pol2.start_date <= p_to_date)
                                  ))),
    'pool_with_feedback',    (SELECT count(DISTINCT pr.id)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))
                                  AND (p_customer_ids IS NOT NULL OR p_from_date IS NULL OR pr.created_at >= p_from_date)
                                  AND (p_customer_ids IS NOT NULL OR p_to_date   IS NULL OR pr.created_at <= p_to_date)
                                  AND (p_shop_ids IS NULL OR EXISTS (
                                    SELECT 1 FROM public.policies pol2
                                    WHERE pol2.customer_id = pr.id
                                      AND pol2.brand_id    = pr.brand_id
                                      AND pol2.status      = 'live'
                                      AND pol2.shop_id     = ANY(p_shop_ids)
                                      AND (p_from_date IS NULL OR pol2.start_date >= p_from_date)
                                      AND (p_to_date   IS NULL OR pol2.start_date <= p_to_date)
                                  ))
                                  AND EXISTS (
                                    SELECT 1 FROM public.feedback fb
                                    WHERE fb.user_id = pr.id
                                      AND fb.brand_id = pr.brand_id
                                  )),
    -- Legacy fields kept for backward compatibility — still computed through policies.
    'customers_registered',  (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                JOIN public.profiles pr ON pr.id = pol.customer_id
                                WHERE pr.registered_at IS NOT NULL
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'customers_profiled',    (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                JOIN public.profiles pr ON pr.id = pol.customer_id
                                WHERE pr.registered_at  IS NOT NULL
                                  AND pr.date_of_birth  IS NOT NULL
                                  AND pr.country        IS NOT NULL
                                  AND pr.city           IS NOT NULL
                                  AND pr.postcode       IS NOT NULL
                                  AND pr.address        IS NOT NULL
                                  AND pr.province       IS NOT NULL
                                  AND pr.nationality    IS NOT NULL
                                  AND pr.phone_number   IS NOT NULL
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'customers_with_feedback', (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))
                                  AND EXISTS (
                                    SELECT 1 FROM public.feedback fb
                                    WHERE fb.user_id = pol.customer_id
                                      AND fb.brand_id = pol.brand_id
                                  )),
    'claims_total',          (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'claims_open',           (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'open'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'claims_closed',         (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'closed'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    'policy_stats',          (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT
          p.brand_id,
          count(*)::bigint                                                   AS covers,
          coalesce(sum(coalesce(p.cogs, 0)), 0)::numeric                     AS total_cogs,
          coalesce(sum(coalesce(p.recommended_retail_price, 0)), 0)::numeric AS total_rrp,
          coalesce(sum(coalesce(p.selling_price, 0)), 0)::numeric            AS total_selling_price,
          max(p.start_date)                                                  AS latest_start_date
        FROM public.policies p
        WHERE p.status = 'live'
          AND p.brand_id = ANY(v_brand_ids)
          AND (p_from_date    IS NULL OR p.start_date  >= p_from_date)
          AND (p_to_date      IS NULL OR p.start_date  <= p_to_date)
          AND (p_customer_ids IS NULL OR p.customer_id = ANY(p_customer_ids))
          AND (p_shop_ids     IS NULL OR p.shop_id     = ANY(p_shop_ids))
        GROUP BY p.brand_id
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_aggregates(int[], timestamptz, timestamptz, uuid[], int[])
  TO authenticated;
