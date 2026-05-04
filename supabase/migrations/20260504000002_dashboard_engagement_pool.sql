-- ============================================================
-- Engagement rates use a profile-based pool, not policies.
--
-- Previous version scoped engagement-rate denominator/numerator through
-- live policies in the period — so "Feedback Rate" for May only counted
-- customers with a live policy in May. The user's mental model is
-- different: rates should reflect the customer-type filter (All / New /
-- Returning) over the brand's profile pool, regardless of policy state.
--
--   All Customers      → all profiles (role=customer) in brand scope
--   New Customers      → profiles where created_at IS in selected period
--                        (passed via p_customer_ids by the client)
--   Returning Customers→ profiles where created_at IS BEFORE period
--                        (passed via p_customer_ids by the client)
--
-- The "Customers" tile keeps its policy-based semantic (transactional);
-- only the engagement rate cards switch to the pool semantic.
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
    -- "Customers" platform tile: distinct customers with a live policy in scope.
    'customers_count',       (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))
                                  AND (p_shop_ids     IS NULL OR pol.shop_id      = ANY(p_shop_ids))),
    -- Engagement-rate pool: profiles in brand scope, optionally narrowed
    -- by p_customer_ids (carries the New/Returning customer-type filter).
    -- Brand and customer-type drive the pool; period and shop are NOT
    -- applied here — those are policy-side scopes.
    'pool_total',            (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))),
    'pool_registered',       (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND pr.registered_at IS NOT NULL
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))),
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
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))),
    'pool_with_feedback',    (SELECT count(DISTINCT pr.id)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND (p_customer_ids IS NULL OR pr.id = ANY(p_customer_ids))
                                  AND EXISTS (
                                    SELECT 1 FROM public.feedback fb
                                    WHERE fb.user_id = pr.id
                                      AND fb.brand_id = pr.brand_id
                                  )),
    -- Legacy fields kept for backward compatibility — still computed
    -- through policies. The client now uses pool_* for engagement rates.
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
