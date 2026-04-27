-- ============================================================
-- Query performance: missing indexes
-- Adds indexes for hot auth lookups, FK columns lacking indexes,
-- ILIKE searches without trigram support, and composite filters.
-- All idempotent (IF NOT EXISTS); semantics-preserving.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── auth hot path (every session refresh) ──────────────────
CREATE INDEX IF NOT EXISTS idx_admins_user_id
  ON public.admins(user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id
  ON public.profiles(user_id);

-- Composite for tenant-aware profile lookup: .eq(user_id).eq(brand_id)
CREATE INDEX IF NOT EXISTS idx_profiles_user_id_brand_id
  ON public.profiles(user_id, brand_id);

-- ─── email equality (in addition to existing trigram) ───────
-- Trigram serves ILIKE, but .eq("email", ...) wants a btree.
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles(email);

CREATE INDEX IF NOT EXISTS idx_admins_email
  ON public.admins(email);

-- ─── foreign keys lacking indexes ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_feedback_brand_id
  ON public.feedback(brand_id);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id
  ON public.feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_manufacturing_costs_brand_id
  ON public.manufacturing_costs(brand_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_brand_id
  ON public.support_messages(brand_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_customer_id
  ON public.support_messages(customer_id);

CREATE INDEX IF NOT EXISTS idx_reports_brand_id
  ON public.reports(brand_id);

CREATE INDEX IF NOT EXISTS idx_reports_created_at
  ON public.reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_returns_old_policy_id
  ON public.returns(old_policy_id);

CREATE INDEX IF NOT EXISTS idx_returns_return_shop_id
  ON public.returns(return_shop_id);

CREATE INDEX IF NOT EXISTS idx_external_requests_brand_id
  ON public.external_requests(brand_id);

-- ─── claims: ILIKE search columns (AdminClaims search) ──────
CREATE INDEX IF NOT EXISTS idx_claims_type_trgm
  ON public.claims USING gin(type gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_claims_incident_city_trgm
  ON public.claims USING gin(incident_city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_claims_incident_country_trgm
  ON public.claims USING gin(incident_country gin_trgm_ops);

-- ─── claims: join+filter composite ──────────────────────────
-- BrandDashboard / BrandClaims walks claims via policy_id and filters by status.
CREATE INDEX IF NOT EXISTS idx_claims_policy_id_status
  ON public.claims(policy_id, status);

-- ─── policies: status-leading composite ─────────────────────
-- AdminInsights does .eq("status","live") with optional .eq("brand_id",X).
-- Existing idx_policies_brand_id_status is brand-leading; we also need
-- status-leading for the global ("all brands") variant.
CREATE INDEX IF NOT EXISTS idx_policies_status_brand_id
  ON public.policies(status, brand_id);

-- For "live policies sorted by start_date" (AdminInsights aggregations).
CREATE INDEX IF NOT EXISTS idx_policies_status_start_date
  ON public.policies(status, start_date);

-- ─── policies: brand_sale_id equality / sort ────────────────
-- Trigram serves ILIKE; this btree serves equality and ORDER BY.
CREATE INDEX IF NOT EXISTS idx_policies_brand_sale_id
  ON public.policies(brand_sale_id);

-- ─── policies: foreign-key joins ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_policies_item_id
  ON public.policies(item_id);

CREATE INDEX IF NOT EXISTS idx_policies_shop_id
  ON public.policies(shop_id);

-- Composite for "all my brand's covers for a given customer".
CREATE INDEX IF NOT EXISTS idx_policies_brand_id_customer_id
  ON public.policies(brand_id, customer_id);

-- ─── catalogues: brand-scoped sorted lookups (dropdowns) ────
CREATE INDEX IF NOT EXISTS idx_catalogues_brand_id_name
  ON public.catalogues(brand_id, name);

-- ─── refresh planner stats so new indexes are picked up ─────
ANALYZE public.profiles;
ANALYZE public.admins;
ANALYZE public.policies;
ANALYZE public.claims;
ANALYZE public.catalogues;
ANALYZE public.feedback;
ANALYZE public.manufacturing_costs;
ANALYZE public.support_messages;
ANALYZE public.reports;
ANALYZE public.returns;
ANALYZE public.external_requests;
