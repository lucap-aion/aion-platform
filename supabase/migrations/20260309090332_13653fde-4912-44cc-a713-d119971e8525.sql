
-- Helper function: get current user's profile id
CREATE OR REPLACE FUNCTION public.get_my_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Helper function: get current user's brand_id
CREATE OR REPLACE FUNCTION public.get_my_brand_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT brand_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- PROFILES RLS
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Brand users can view brand profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin'));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- POLICIES (covers) RLS
CREATE POLICY "Customers can view own policies"
  ON public.policies FOR SELECT
  TO authenticated
  USING (customer_id = public.get_my_profile_id());

CREATE POLICY "Brand users can view brand policies"
  ON public.policies FOR SELECT
  TO authenticated
  USING (brand_id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin'));

-- CLAIMS RLS
CREATE POLICY "Customers can view own claims"
  ON public.claims FOR SELECT
  TO authenticated
  USING (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));

CREATE POLICY "Customers can insert claims"
  ON public.claims FOR INSERT
  TO authenticated
  WITH CHECK (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));

CREATE POLICY "Customers can update own claims"
  ON public.claims FOR UPDATE
  TO authenticated
  USING (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));

CREATE POLICY "Customers can delete own claims"
  ON public.claims FOR DELETE
  TO authenticated
  USING (policy_id IN (SELECT id FROM public.policies WHERE customer_id = public.get_my_profile_id()));

CREATE POLICY "Brand users can view brand claims"
  ON public.claims FOR SELECT
  TO authenticated
  USING (policy_id IN (SELECT id FROM public.policies WHERE brand_id = public.get_my_brand_id()) AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin'));

-- BRANDS RLS
CREATE POLICY "Users can view own brand"
  ON public.brands FOR SELECT
  TO authenticated
  USING (id = public.get_my_brand_id());

-- CATALOGUES RLS
CREATE POLICY "Users can view brand catalogues"
  ON public.catalogues FOR SELECT
  TO authenticated
  USING (brand_id = public.get_my_brand_id());
