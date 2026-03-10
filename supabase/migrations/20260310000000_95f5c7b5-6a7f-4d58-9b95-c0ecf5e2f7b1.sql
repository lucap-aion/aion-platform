-- RLS actions required by newly wired app flows

-- Allow brand users to edit their own brand record
CREATE POLICY "Brand users can update own brand"
  ON public.brands FOR UPDATE
  TO authenticated
  USING (id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin'))
  WITH CHECK (id = public.get_my_brand_id() AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin'));

-- Allow brand users to update claims belonging to their brand
CREATE POLICY "Brand users can update brand claims"
  ON public.claims FOR UPDATE
  TO authenticated
  USING (
    policy_id IN (
      SELECT id
      FROM public.policies
      WHERE brand_id = public.get_my_brand_id()
    )
    AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin')
  )
  WITH CHECK (
    policy_id IN (
      SELECT id
      FROM public.policies
      WHERE brand_id = public.get_my_brand_id()
    )
    AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin')
  );

-- Allow customers to submit feedback for their own brand and profile
CREATE POLICY "Customers can insert feedback"
  ON public.feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.get_my_profile_id()
    AND brand_id = public.get_my_brand_id()
    AND (public.get_my_role() IS NULL OR public.get_my_role() = 'customer')
  );

CREATE POLICY "Customers can view own feedback"
  ON public.feedback FOR SELECT
  TO authenticated
  USING (user_id = public.get_my_profile_id());

CREATE POLICY "Brand users can view brand feedback"
  ON public.feedback FOR SELECT
  TO authenticated
  USING (
    brand_id = public.get_my_brand_id()
    AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin')
  );

-- Store support tickets/messages coming from users
CREATE POLICY "Customers can insert support messages"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    brand_id = public.get_my_brand_id()
    AND customer_id = public.get_my_profile_id()
    AND (public.get_my_role() IS NULL OR public.get_my_role() = 'customer')
  );

CREATE POLICY "Brand users can insert support messages"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    brand_id = public.get_my_brand_id()
    AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin')
  );

CREATE POLICY "Customers can view own support messages"
  ON public.support_messages FOR SELECT
  TO authenticated
  USING (customer_id = public.get_my_profile_id());

CREATE POLICY "Brand users can view brand support messages"
  ON public.support_messages FOR SELECT
  TO authenticated
  USING (
    brand_id = public.get_my_brand_id()
    AND public.get_my_role() IN ('brand_admin', 'brand_user', 'admin')
  );
