-- Drop the previous broken policies that used auth.users subquery (not accessible to anon/authenticated)
DROP POLICY IF EXISTS "customer: select unlinked profile by email" ON public.profiles;
DROP POLICY IF EXISTS "customer: claim unlinked profile" ON public.profiles;

-- Use auth.jwt() ->> 'email' which reads directly from the JWT token (always accessible in RLS)
CREATE POLICY "customer: select unlinked profile by email"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id IS NULL
    AND email = (auth.jwt() ->> 'email')
  );

CREATE POLICY "customer: claim unlinked profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    user_id IS NULL
    AND email = (auth.jwt() ->> 'email')
  )
  WITH CHECK (user_id = auth.uid());
