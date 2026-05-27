-- ============================================================
-- Split Profilation into Started vs Completed.
--
-- Previous version exposed a single `pool_profiled` (= all 9
-- profile fields populated). That turned out to be too strict
-- on its own: it answers "who finished profiling" but says
-- nothing about funnel progress. The Home dashboard now shows
-- two engagement tiles instead of one, so the RPC adds
-- `pool_profilation_started` alongside `pool_profiled`.
--
--   Started   → registered AND at least one of the 8 optional
--               profile fields is populated (date_of_birth,
--               country, city, postcode, address, province,
--               nationality, phone_number).
--   Completed → all 9 fields populated (registered_at + the 8
--               above). This is the existing `pool_profiled`,
--               kept unchanged for backward compatibility.
--
-- Started is a superset of Completed.
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
    -- Registered AND has at least one optional profile field populated.
    'pool_profilation_started', (SELECT count(*)::bigint
                                FROM public.profiles pr
                                WHERE pr.role = 'customer'
                                  AND pr.brand_id = ANY(v_brand_ids)
                                  AND pr.registered_at IS NOT NULL
                                  AND (
                                       pr.date_of_birth IS NOT NULL
                                    OR pr.country       IS NOT NULL
                                    OR pr.city          IS NOT NULL
                                    OR pr.postcode      IS NOT NULL
                                    OR pr.address       IS NOT NULL
                                    OR pr.province      IS NOT NULL
                                    OR pr.nationality   IS NOT NULL
                                    OR pr.phone_number  IS NOT NULL
                                  )
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
