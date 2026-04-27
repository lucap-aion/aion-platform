-- ============================================================
-- Align all admin + brand calculations to "live policies only".
--   * brand_dashboard_metrics: customers / covers / open_claims /
--     protected_value all derived from live policies.
--   * brand_customer_aggregates: per-customer covers/claims/value
--     restricted to live policies.
--   * dashboard_policy_stats: status='live' moves to WHERE so the
--     covers count and all sums share the same filtered scope.
--     Quantity multiplier dropped to match AdminInsights' totals.
--   * admin_dashboard_aggregates: customers/stores/claims now
--     "those tied to a live policy" (was: every brand-affiliated row).
--     Quantity multiplier dropped on financials.
-- ============================================================

CREATE OR REPLACE FUNCTION public.brand_dashboard_metrics(p_brand_id int)
RETURNS TABLE (
  customers       bigint,
  covers          bigint,
  open_claims     bigint,
  protected_value numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    (SELECT count(DISTINCT pol.customer_id)::bigint
       FROM public.policies pol
       WHERE pol.brand_id = p_brand_id AND pol.status = 'live')         AS customers,
    (SELECT count(*)::bigint
       FROM public.policies pol
       WHERE pol.brand_id = p_brand_id AND pol.status = 'live')         AS covers,
    (SELECT count(*)::bigint
       FROM public.claims c
       JOIN public.policies pol ON pol.id = c.policy_id
       WHERE c.status = 'open'
         AND pol.brand_id = p_brand_id
         AND pol.status = 'live')                                       AS open_claims,
    (SELECT coalesce(sum(pol.selling_price), 0)::numeric
       FROM public.policies pol
       WHERE pol.brand_id = p_brand_id AND pol.status = 'live')         AS protected_value
$$;

GRANT EXECUTE ON FUNCTION public.brand_dashboard_metrics(int)
  TO authenticated, anon;


CREATE OR REPLACE FUNCTION public.brand_customer_aggregates(
  p_customer_ids uuid[]
)
RETURNS TABLE (
  customer_id uuid,
  covers      bigint,
  claims      bigint,
  total_value numeric
)
LANGUAGE sql STABLE
AS $$
  WITH live_pol AS (
    SELECT pol.id, pol.customer_id, pol.selling_price
    FROM public.policies pol
    WHERE pol.customer_id = ANY(p_customer_ids)
      AND pol.status = 'live'
  ),
  claim_counts AS (
    SELECT lp.customer_id, count(c.id)::bigint AS claims
    FROM live_pol lp
    LEFT JOIN public.claims c ON c.policy_id = lp.id
    GROUP BY lp.customer_id
  )
  SELECT
    lp.customer_id,
    count(lp.id)::bigint                                AS covers,
    coalesce(cc.claims, 0)::bigint                      AS claims,
    coalesce(sum(lp.selling_price), 0)::numeric         AS total_value
  FROM live_pol lp
  LEFT JOIN claim_counts cc ON cc.customer_id = lp.customer_id
  GROUP BY lp.customer_id, cc.claims
$$;

GRANT EXECUTE ON FUNCTION public.brand_customer_aggregates(uuid[])
  TO authenticated, anon;


CREATE OR REPLACE FUNCTION public.dashboard_policy_stats(
  p_brand_ids     int[]       DEFAULT NULL,
  p_from_date     timestamptz DEFAULT NULL,
  p_to_date       timestamptz DEFAULT NULL,
  p_customer_ids  uuid[]      DEFAULT NULL
)
RETURNS TABLE (
  brand_id              int,
  covers                bigint,
  total_cogs            numeric,
  total_rrp             numeric,
  total_selling_price   numeric,
  latest_start_date     timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.brand_id::int,
    count(*)::bigint                                              AS covers,
    coalesce(sum(coalesce(p.cogs, 0)), 0)::numeric                AS total_cogs,
    coalesce(sum(coalesce(p.recommended_retail_price, 0)), 0)::numeric AS total_rrp,
    coalesce(sum(coalesce(p.selling_price, 0)), 0)::numeric       AS total_selling_price,
    max(p.start_date)                                             AS latest_start_date
  FROM public.policies p
  WHERE p.status = 'live'
    AND (p_brand_ids    IS NULL OR p.brand_id    = ANY(p_brand_ids))
    AND (p_from_date    IS NULL OR p.start_date >= p_from_date)
    AND (p_to_date      IS NULL OR p.start_date <= p_to_date)
    AND (p_customer_ids IS NULL OR p.customer_id = ANY(p_customer_ids))
  GROUP BY p.brand_id
$$;


CREATE OR REPLACE FUNCTION public.admin_dashboard_aggregates(
  p_brand_ids     int[]       DEFAULT NULL,
  p_from_date     timestamptz DEFAULT NULL,
  p_to_date       timestamptz DEFAULT NULL,
  p_customer_ids  uuid[]      DEFAULT NULL
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
                                  AND pol.shop_id IS NOT NULL),
    'customers_count',       (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'),
    'customers_registered',  (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                JOIN public.profiles pr ON pr.id = pol.customer_id
                                WHERE pr.registered_at IS NOT NULL
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'),
    'claims_total',          (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'),
    'claims_open',           (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'open'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'),
    'claims_closed',         (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'closed'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'),
    'policy_stats',          (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT
          p.brand_id,
          count(*)::bigint                                              AS covers,
          coalesce(sum(coalesce(p.cogs, 0)), 0)::numeric                AS total_cogs,
          coalesce(sum(coalesce(p.recommended_retail_price, 0)), 0)::numeric AS total_rrp,
          coalesce(sum(coalesce(p.selling_price, 0)), 0)::numeric       AS total_selling_price,
          max(p.start_date)                                             AS latest_start_date
        FROM public.policies p
        WHERE p.status = 'live'
          AND p.brand_id = ANY(v_brand_ids)
          AND (p_from_date    IS NULL OR p.start_date  >= p_from_date)
          AND (p_to_date      IS NULL OR p.start_date  <= p_to_date)
          AND (p_customer_ids IS NULL OR p.customer_id = ANY(p_customer_ids))
        GROUP BY p.brand_id
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_aggregates(int[], timestamptz, timestamptz, uuid[])
  TO authenticated;
