-- ============================================================
-- FIX: Allow a newly-registered admin to find and claim their
-- unlinked record in the admins table on first login.
--
-- Problem: After email confirmation the admin's auth.uid() is
-- set, but admins.user_id is still NULL.  The only existing
-- SELECT policy requires user_id = auth.uid() (impossible when
-- NULL) and the ALL policy requires get_my_role() = 'admin'
-- (impossible before the record is linked).  AuthContext can
-- therefore never find the admin record by email, so isAdmin
-- stays false and the user is bounced to the landing page.
-- ============================================================

-- 1. Allow any authenticated user to SELECT their own unlinked
--    admin record identified by the email in their JWT.
CREATE POLICY "admin: select unlinked admin by email"
  ON public.admins FOR SELECT TO authenticated
  USING (user_id IS NULL AND email = (auth.jwt() ->> 'email'));

-- 2. Allow that same user to UPDATE (claim) their unlinked
--    admin record, setting user_id to their auth.uid().
--    Once linked, the standard get_my_role() = 'admin' policies
--    take over for all subsequent operations.
CREATE POLICY "admin: claim unlinked admin record"
  ON public.admins FOR UPDATE TO authenticated
  USING (user_id IS NULL AND email = (auth.jwt() ->> 'email'))
  WITH CHECK (user_id = auth.uid());
