-- Fix: admins can read their own record (get_my_role() returns NULL for admins
-- because it only checks profiles — causing a circular lock).

-- 1. Allow any authenticated user to SELECT their own row in admins by user_id.
--    This unblocks the client-side auth check in AuthContext.
CREATE POLICY "admin: select own record by user_id"
  ON public.admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 2. Update get_my_role() to also return 'admin' for users found in admins table.
--    This fixes all other RLS policies that depend on get_my_role() = 'admin'.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1),
    (SELECT 'admin' FROM public.admins WHERE user_id = auth.uid() LIMIT 1)
  )
$$;
