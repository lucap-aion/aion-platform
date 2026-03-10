-- ============================================================
-- MULTI-BRAND CUSTOMER RLS
--
-- A customer can have one profile per brand (same auth user,
-- multiple rows in public.profiles).  The old policies used
-- get_my_profile_id() / get_my_brand_id() which return a
-- single arbitrary row, breaking data access for any brand
-- other than the first one found.
--
-- Fix: replace all customer data-access policies with inline
-- subqueries that match ALL profiles owned by the user.
-- The frontend + AuthContext handle which brand to display;
-- RLS just ensures customers cannot see other customers' data.
-- ============================================================

-- ─── policies (covers) ───────────────────────────────────────

DROP POLICY IF EXISTS "customer: select own policies" ON public.policies;
CREATE POLICY "customer: select own policies"
  ON public.policies FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── claims ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: all on own claims" ON public.claims;
CREATE POLICY "customer: all on own claims"
  ON public.claims FOR ALL TO authenticated
  USING (
    policy_id IN (
      SELECT p.id FROM public.policies p
      WHERE p.customer_id IN (
        SELECT id FROM public.profiles WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    policy_id IN (
      SELECT p.id FROM public.policies p
      WHERE p.customer_id IN (
        SELECT id FROM public.profiles WHERE user_id = auth.uid()
      )
    )
  );


-- ─── brands ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: select own brand" ON public.brands;
CREATE POLICY "customer: select own brand"
  ON public.brands FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT brand_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── catalogues ──────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: select own brand catalogues" ON public.catalogues;
CREATE POLICY "customer: select own brand catalogues"
  ON public.catalogues FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── shops ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: select own brand shops" ON public.shops;
CREATE POLICY "customer: select own brand shops"
  ON public.shops FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── support_messages ────────────────────────────────────────

DROP POLICY IF EXISTS "customer: all on own support_messages" ON public.support_messages;
CREATE POLICY "customer: all on own support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.profiles WHERE user_id = auth.uid()
    )
    AND brand_id IN (
      SELECT brand_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── feedback ────────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: all on own feedback" ON public.feedback;
CREATE POLICY "customer: all on own feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (
    user_id IN (
      SELECT id FROM public.profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM public.profiles WHERE user_id = auth.uid()
    )
    AND brand_id IN (
      SELECT brand_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );


-- ─── returns ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "customer: select own returns" ON public.returns;
CREATE POLICY "customer: select own returns"
  ON public.returns FOR SELECT TO authenticated
  USING (
    old_policy_id IN (
      SELECT p.id FROM public.policies p
      WHERE p.customer_id IN (
        SELECT id FROM public.profiles WHERE user_id = auth.uid()
      )
    )
  );
