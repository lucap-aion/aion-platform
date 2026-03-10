-- Allow a customer to SELECT their own profile even when user_id is NULL,
-- as long as the profile email matches their auth email.
-- This enables the AuthContext email-fallback lookup to succeed.
CREATE POLICY "customer: select unlinked profile by email"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id IS NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Allow a customer to UPDATE (claim) their unlinked profile to set user_id.
-- After this runs, the standard user_id = auth.uid() policies take over.
CREATE POLICY "customer: claim unlinked profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    user_id IS NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (user_id = auth.uid());
