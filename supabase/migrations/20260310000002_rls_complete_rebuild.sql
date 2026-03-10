-- ============================================================
-- COMPLETE RLS REBUILD
-- Roles:
--   admin        → full access to everything
--   brand_admin  → full access to their brand's data
--   brand_user   → full access to their brand's data
--   customer     → own data + own brand's public data
-- ============================================================

-- ─── DROP ALL EXISTING POLICIES ──────────────────────────────

-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Brand users can view brand profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- brands
DROP POLICY IF EXISTS "Users can view own brand" ON public.brands;
DROP POLICY IF EXISTS "Brand users can update own brand" ON public.brands;
DROP POLICY IF EXISTS "Public can read brands by slug" ON public.brands;

-- policies
DROP POLICY IF EXISTS "Customers can view own policies" ON public.policies;
DROP POLICY IF EXISTS "Brand users can view brand policies" ON public.policies;

-- claims
DROP POLICY IF EXISTS "Customers can view own claims" ON public.claims;
DROP POLICY IF EXISTS "Customers can insert claims" ON public.claims;
DROP POLICY IF EXISTS "Customers can update own claims" ON public.claims;
DROP POLICY IF EXISTS "Customers can delete own claims" ON public.claims;
DROP POLICY IF EXISTS "Brand users can view brand claims" ON public.claims;
DROP POLICY IF EXISTS "Brand users can update brand claims" ON public.claims;

-- catalogues
DROP POLICY IF EXISTS "Users can view brand catalogues" ON public.catalogues;

-- feedback
DROP POLICY IF EXISTS "Customers can insert feedback" ON public.feedback;
DROP POLICY IF EXISTS "Customers can view own feedback" ON public.feedback;
DROP POLICY IF EXISTS "Brand users can view brand feedback" ON public.feedback;

-- support_messages
DROP POLICY IF EXISTS "Customers can insert support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Brand users can insert support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Customers can view own support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Brand users can view brand support messages" ON public.support_messages;


-- ─── PROFILES ────────────────────────────────────────────────

CREATE POLICY "admin: all on profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: select own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "customer: update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── BRANDS ──────────────────────────────────────────────────

-- Unauthenticated slug lookup (powers branded login pages)
CREATE POLICY "public: read brands by slug"
  ON public.brands FOR SELECT TO public
  USING (slug IS NOT NULL AND slug <> '');

CREATE POLICY "admin: all on brands"
  ON public.brands FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: select and update own brand"
  ON public.brands FOR SELECT TO authenticated
  USING (id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "brand: update own brand"
  ON public.brands FOR UPDATE TO authenticated
  USING (id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: select own brand"
  ON public.brands FOR SELECT TO authenticated
  USING (id = public.get_my_brand_id());


-- ─── POLICIES (covers) ───────────────────────────────────────

CREATE POLICY "admin: all on policies"
  ON public.policies FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand policies"
  ON public.policies FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: select own policies"
  ON public.policies FOR SELECT TO authenticated
  USING (customer_id = public.get_my_profile_id());


-- ─── CLAIMS ──────────────────────────────────────────────────

CREATE POLICY "admin: all on claims"
  ON public.claims FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand claims"
  ON public.claims FOR ALL TO authenticated
  USING (
    policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.get_my_role() IN ('brand_admin', 'brand_user')
  )
  WITH CHECK (
    policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.get_my_role() IN ('brand_admin', 'brand_user')
  );

CREATE POLICY "customer: all on own claims"
  ON public.claims FOR ALL TO authenticated
  USING (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()))
  WITH CHECK (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));


-- ─── CATALOGUES ──────────────────────────────────────────────

CREATE POLICY "admin: all on catalogues"
  ON public.catalogues FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand catalogues"
  ON public.catalogues FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: select own brand catalogues"
  ON public.catalogues FOR SELECT TO authenticated
  USING (brand_id = public.get_my_brand_id());


-- ─── SHOPS ───────────────────────────────────────────────────

CREATE POLICY "admin: all on shops"
  ON public.shops FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand shops"
  ON public.shops FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: select own brand shops"
  ON public.shops FOR SELECT TO authenticated
  USING (brand_id = public.get_my_brand_id());


-- ─── FEEDBACK ────────────────────────────────────────────────

CREATE POLICY "admin: all on feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: all on own feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (user_id = public.get_my_profile_id())
  WITH CHECK (user_id = public.get_my_profile_id() AND brand_id = public.get_my_brand_id());


-- ─── SUPPORT MESSAGES ────────────────────────────────────────

CREATE POLICY "admin: all on support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));

CREATE POLICY "customer: all on own support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (customer_id = public.get_my_profile_id())
  WITH CHECK (customer_id = public.get_my_profile_id() AND brand_id = public.get_my_brand_id());


-- ─── REPORTS ─────────────────────────────────────────────────

CREATE POLICY "admin: all on reports"
  ON public.reports FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand reports"
  ON public.reports FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));


-- ─── RETURNS ─────────────────────────────────────────────────
-- returns has no brand_id; linked via old_policy_id → policies

CREATE POLICY "admin: all on returns"
  ON public.returns FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand returns"
  ON public.returns FOR ALL TO authenticated
  USING (
    old_policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.get_my_role() IN ('brand_admin', 'brand_user')
  )
  WITH CHECK (
    old_policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id())
    AND public.get_my_role() IN ('brand_admin', 'brand_user')
  );

CREATE POLICY "customer: select own returns"
  ON public.returns FOR SELECT TO authenticated
  USING (old_policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));


-- ─── EXTERNAL REQUESTS ───────────────────────────────────────

CREATE POLICY "admin: all on external_requests"
  ON public.external_requests FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand external_requests"
  ON public.external_requests FOR ALL TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'))
  WITH CHECK (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));


-- ─── MANUFACTURING COSTS ─────────────────────────────────────

CREATE POLICY "admin: all on manufacturing_costs"
  ON public.manufacturing_costs FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "brand: select own brand manufacturing_costs"
  ON public.manufacturing_costs FOR SELECT TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user'));


-- ─── ADMINS TABLE ────────────────────────────────────────────

CREATE POLICY "admin: all on admins"
  ON public.admins FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');


-- ─── BRAND LEADS ─────────────────────────────────────────────

CREATE POLICY "admin: all on brand_leads"
  ON public.brand_leads FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
