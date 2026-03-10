-- ============================================================
-- FIX ADMIN WRITE ACCESS
-- Root cause: get_my_role() only checked profiles table.
-- Admin users are in the admins table and have no profiles row,
-- so get_my_role() returned NULL → all write RLS policies failed.
-- ============================================================

-- 1. Fix get_my_role() to also check admins table
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1),
    (SELECT 'admin'::text FROM public.admins WHERE user_id = auth.uid() LIMIT 1)
  )
$$;

-- 2. Allow admins to read their own row (breaks circular dependency on admins table RLS)
DROP POLICY IF EXISTS "admin: select own record by user_id" ON public.admins;
CREATE POLICY "admin: select own record by user_id"
  ON public.admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Full admin access on every table
--    Using IF NOT EXISTS via DROP + CREATE pattern

-- admins
DROP POLICY IF EXISTS "admin: all on admins" ON public.admins;
CREATE POLICY "admin: all on admins"
  ON public.admins FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- brands
DROP POLICY IF EXISTS "admin: all on brands" ON public.brands;
CREATE POLICY "admin: all on brands"
  ON public.brands FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- profiles
DROP POLICY IF EXISTS "admin: all on profiles" ON public.profiles;
CREATE POLICY "admin: all on profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- policies (covers)
DROP POLICY IF EXISTS "admin: all on policies" ON public.policies;
CREATE POLICY "admin: all on policies"
  ON public.policies FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- claims
DROP POLICY IF EXISTS "admin: all on claims" ON public.claims;
CREATE POLICY "admin: all on claims"
  ON public.claims FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- catalogues
DROP POLICY IF EXISTS "admin: all on catalogues" ON public.catalogues;
CREATE POLICY "admin: all on catalogues"
  ON public.catalogues FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- shops
DROP POLICY IF EXISTS "admin: all on shops" ON public.shops;
CREATE POLICY "admin: all on shops"
  ON public.shops FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- feedback
DROP POLICY IF EXISTS "admin: all on feedback" ON public.feedback;
CREATE POLICY "admin: all on feedback"
  ON public.feedback FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- support_messages
DROP POLICY IF EXISTS "admin: all on support_messages" ON public.support_messages;
CREATE POLICY "admin: all on support_messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- reports
DROP POLICY IF EXISTS "admin: all on reports" ON public.reports;
CREATE POLICY "admin: all on reports"
  ON public.reports FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- returns
DROP POLICY IF EXISTS "admin: all on returns" ON public.returns;
CREATE POLICY "admin: all on returns"
  ON public.returns FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- external_requests
DROP POLICY IF EXISTS "admin: all on external_requests" ON public.external_requests;
CREATE POLICY "admin: all on external_requests"
  ON public.external_requests FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- manufacturing_costs
DROP POLICY IF EXISTS "admin: all on manufacturing_costs" ON public.manufacturing_costs;
CREATE POLICY "admin: all on manufacturing_costs"
  ON public.manufacturing_costs FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- brand_leads
DROP POLICY IF EXISTS "admin: all on brand_leads" ON public.brand_leads;
CREATE POLICY "admin: all on brand_leads"
  ON public.brand_leads FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
