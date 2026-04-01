-- ============================================================
-- Additional performance indexes for brand platform queries
-- ============================================================

-- policies.customer_id — used in BrandCustomers to join customer → policies
CREATE INDEX IF NOT EXISTS idx_policies_customer_id
  ON public.policies(customer_id);

-- claims.policy_id — used in BrandCustomers (claims count) and BrandClaims joins
CREATE INDEX IF NOT EXISTS idx_claims_policy_id
  ON public.claims(policy_id);

-- policies.expiration_date — used in BrandCovers sort by expiry
CREATE INDEX IF NOT EXISTS idx_policies_expiration_date
  ON public.policies(expiration_date);

-- Composite index for brand claims list: brand_id filter via inner join + status + created_at sort
CREATE INDEX IF NOT EXISTS idx_policies_brand_id_created_at
  ON public.policies(brand_id, created_at DESC);
