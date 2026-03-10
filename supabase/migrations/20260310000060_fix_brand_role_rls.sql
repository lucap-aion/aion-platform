-- ============================================================
-- FIX: RLS policies now accept role = 'brand' in addition to
--      legacy 'brand_admin' / 'brand_user' values.
-- ============================================================

-- Helper: returns true for any brand-level role
CREATE OR REPLACE FUNCTION public.is_brand_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_role() IN ('brand', 'brand_admin', 'brand_user')
$$;

-- ─── PROFILES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand profiles" ON public.profiles;
CREATE POLICY "brand: all on own brand profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── BRANDS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: select and update own brand" ON public.brands;
CREATE POLICY "brand: select and update own brand"
  ON public.brands FOR SELECT TO authenticated
  USING (id = public.get_my_brand_id() AND public.is_brand_role());

DROP POLICY IF EXISTS "brand: update own brand" ON public.brands;
CREATE POLICY "brand: update own brand"
  ON public.brands FOR UPDATE TO authenticated
  USING (id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── POLICIES (covers) ───────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand policies" ON public.policies;
CREATE POLICY "brand: all on own brand policies"
  ON public.policies FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── CLAIMS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand claims" ON public.claims;
CREATE POLICY "brand: all on own brand claims"
  ON public.claims FOR ALL TO authenticated
  USING (
    policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.is_brand_role()
  )
  WITH CHECK (
    policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.is_brand_role()
  );

-- ─── CATALOGUES ──────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand catalogues" ON public.catalogues;
CREATE POLICY "brand: all on own brand catalogues"
  ON public.catalogues FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── SHOPS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand shops" ON public.shops;
CREATE POLICY "brand: all on own brand shops"
  ON public.shops FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── FEEDBACK ────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand feedback" ON public.feedback;
CREATE POLICY "brand: all on own brand feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── SUPPORT MESSAGES ────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand support_messages" ON public.support_messages;
CREATE POLICY "brand: all on own brand support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── REPORTS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand reports" ON public.reports;
CREATE POLICY "brand: all on own brand reports"
  ON public.reports FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── RETURNS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand returns" ON public.returns;
CREATE POLICY "brand: all on own brand returns"
  ON public.returns FOR ALL TO authenticated
  USING (
    old_policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.is_brand_role()
  )
  WITH CHECK (
    old_policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.is_brand_role()
  );

-- ─── EXTERNAL REQUESTS ───────────────────────────────────────
DROP POLICY IF EXISTS "brand: all on own brand external_requests" ON public.external_requests;
CREATE POLICY "brand: all on own brand external_requests"
  ON public.external_requests FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role())
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.is_brand_role());

-- ─── MANUFACTURING COSTS ─────────────────────────────────────
DROP POLICY IF EXISTS "brand: select own brand manufacturing_costs" ON public.manufacturing_costs;
CREATE POLICY "brand: select own brand manufacturing_costs"
  ON public.manufacturing_costs FOR SELECT TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.is_brand_role());
