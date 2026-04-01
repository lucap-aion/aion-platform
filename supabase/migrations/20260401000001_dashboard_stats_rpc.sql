-- Aggregates policy financials grouped by brand_id, returning one row per brand
-- instead of fetching all individual policy rows to the client.
CREATE OR REPLACE FUNCTION public.dashboard_policy_stats(
  p_brand_ids   int[]      DEFAULT NULL,
  p_from_date   timestamptz DEFAULT NULL,
  p_to_date     timestamptz DEFAULT NULL,
  p_customer_ids uuid[]     DEFAULT NULL
)
RETURNS TABLE (
  brand_id             int,
  covers               bigint,
  total_cogs           numeric,
  total_rrp            numeric,
  total_selling_price  numeric,
  latest_start_date    timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.brand_id::int,
    count(*)::bigint                                           AS covers,
    coalesce(sum((coalesce(p.cogs,0))   * coalesce(p.quantity,1)), 0) AS total_cogs,
    coalesce(sum((coalesce(p.recommended_retail_price,0)) * coalesce(p.quantity,1)), 0) AS total_rrp,
    coalesce(sum((coalesce(p.selling_price,0)) * coalesce(p.quantity,1)), 0) AS total_selling_price,
    max(p.start_date)                                          AS latest_start_date
  FROM policies p
  WHERE (p_brand_ids   IS NULL OR p.brand_id    = ANY(p_brand_ids))
    AND (p_from_date   IS NULL OR p.start_date >= p_from_date)
    AND (p_to_date     IS NULL OR p.start_date <= p_to_date)
    AND (p_customer_ids IS NULL OR p.customer_id = ANY(p_customer_ids))
  GROUP BY p.brand_id
$$;
