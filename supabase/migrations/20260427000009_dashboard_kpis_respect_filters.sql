-- ============================================================
-- Apply the period (and customer-type) filter consistently to all
-- KPI counts on the admin home, not just policy_stats. Previously
-- selecting "Month / April 2026" only filtered Covers and Financials;
-- Customers, Stores, Registration Rate, and Claims remained on the
-- full all-time scope, which read as inconsistent.
--
-- All policy-derived counts now share the same WHERE clause:
--   brand_id ∈ verified, status='live', start_date in [from,to],
--   customer_id ∈ p_customer_ids when provided.
-- Brands stays unfiltered — verified-brand count is independent of
-- whether they have policies in the selected period.
-- ============================================================

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
                                  AND pol.shop_id IS NOT NULL
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
    'customers_count',       (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
    'customers_registered',  (SELECT count(DISTINCT pol.customer_id)::bigint
                                FROM public.policies pol
                                JOIN public.profiles pr ON pr.id = pol.customer_id
                                WHERE pr.registered_at IS NOT NULL
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
    'claims_total',          (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
    'claims_open',           (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'open'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
    'claims_closed',         (SELECT count(*)::bigint
                                FROM public.claims c
                                JOIN public.policies pol ON pol.id = c.policy_id
                                WHERE c.status = 'closed'
                                  AND pol.brand_id = ANY(v_brand_ids)
                                  AND pol.status = 'live'
                                  AND (p_from_date    IS NULL OR pol.start_date  >= p_from_date)
                                  AND (p_to_date      IS NULL OR pol.start_date  <= p_to_date)
                                  AND (p_customer_ids IS NULL OR pol.customer_id  = ANY(p_customer_ids))),
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
