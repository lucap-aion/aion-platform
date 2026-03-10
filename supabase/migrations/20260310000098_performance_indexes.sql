-- ============================================================
-- Performance indexes for admin list views
-- Covers: ilike text search, common filter/sort columns
-- ============================================================

-- pg_trgm enables fast ILIKE '%...%' matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── profiles ────────────────────────────────────────────────
-- Composite index for role + brand_id (most common list filter)
CREATE INDEX IF NOT EXISTS idx_profiles_role_brand_id
  ON public.profiles(role, brand_id);

-- Composite index for role + status
CREATE INDEX IF NOT EXISTS idx_profiles_role_status
  ON public.profiles(role, status);

-- GIN trigram indexes for text search fields
CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm
  ON public.profiles USING gin(email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_first_name_trgm
  ON public.profiles USING gin(first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_last_name_trgm
  ON public.profiles USING gin(last_name gin_trgm_ops);

-- ─── admins ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_admins_status
  ON public.admins(status);

CREATE INDEX IF NOT EXISTS idx_admins_email_trgm
  ON public.admins USING gin(email gin_trgm_ops);

-- ─── brands ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brands_status
  ON public.brands(status);

CREATE INDEX IF NOT EXISTS idx_brands_name_trgm
  ON public.brands USING gin(name gin_trgm_ops);

-- ─── catalogues ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_catalogues_brand_id
  ON public.catalogues(brand_id);

CREATE INDEX IF NOT EXISTS idx_catalogues_name_trgm
  ON public.catalogues USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_catalogues_sku_trgm
  ON public.catalogues USING gin(sku gin_trgm_ops);

-- ─── policies (covers) ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_policies_brand_id_status
  ON public.policies(brand_id, status);

CREATE INDEX IF NOT EXISTS idx_policies_created_at
  ON public.policies(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_policies_brand_sale_id_trgm
  ON public.policies USING gin(brand_sale_id gin_trgm_ops);

-- ─── claims ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_claims_status
  ON public.claims(status);

CREATE INDEX IF NOT EXISTS idx_claims_type
  ON public.claims(type);

CREATE INDEX IF NOT EXISTS idx_claims_created_at
  ON public.claims(created_at DESC);

-- ─── shops ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shops_brand_id
  ON public.shops(brand_id);
