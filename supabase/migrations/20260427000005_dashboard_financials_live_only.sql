-- ============================================================
-- Dashboard financials: sum totals only over live policies.
-- Covers count stays over all statuses (matches existing card).
-- Affects both dashboard_policy_stats (used by fallback path)
-- and admin_dashboard_aggregates (used by fast path).
-- ============================================================

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
    count(*)::bigint                                                                                                  AS covers,
    coalesce(sum(coalesce(p.cogs, 0)                       * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_cogs,
    coalesce(sum(coalesce(p.recommended_retail_price, 0)   * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_rrp,
    coalesce(sum(coalesce(p.selling_price, 0)              * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_selling_price,
    max(p.start_date) FILTER (WHERE p.status = 'live')                                                                AS latest_start_date
  FROM public.policies p
  WHERE (p_brand_ids    IS NULL OR p.brand_id    = ANY(p_brand_ids))
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
    'brands_count',     (SELECT count(*)::bigint FROM public.brands WHERE status = 'verified'),
    'shops_count',      (SELECT count(*)::bigint FROM public.shops s WHERE s.brand_id = ANY(v_brand_ids)),
    'customers_count',  (SELECT count(*)::bigint FROM public.profiles p WHERE p.role = 'customer' AND p.brand_id = ANY(v_brand_ids)),
    'claims_total',     (SELECT count(*)::bigint FROM public.claims c JOIN public.policies pol ON pol.id = c.policy_id WHERE pol.brand_id = ANY(v_brand_ids)),
    'claims_open',      (SELECT count(*)::bigint FROM public.claims c JOIN public.policies pol ON pol.id = c.policy_id WHERE c.status = 'open'   AND pol.brand_id = ANY(v_brand_ids)),
    'claims_closed',    (SELECT count(*)::bigint FROM public.claims c JOIN public.policies pol ON pol.id = c.policy_id WHERE c.status = 'closed' AND pol.brand_id = ANY(v_brand_ids)),
    'policy_stats',     (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT
          p.brand_id,
          count(*)::bigint                                                                                                  AS covers,
          coalesce(sum(coalesce(p.cogs, 0)                       * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_cogs,
          coalesce(sum(coalesce(p.recommended_retail_price, 0)   * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_rrp,
          coalesce(sum(coalesce(p.selling_price, 0)              * coalesce(p.quantity, 1)) FILTER (WHERE p.status = 'live'), 0)::numeric AS total_selling_price,
          max(p.start_date) FILTER (WHERE p.status = 'live')                                                                AS latest_start_date
        FROM public.policies p
        WHERE p.brand_id = ANY(v_brand_ids)
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
