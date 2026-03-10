-- ============================================================
-- PUBLIC INVITATION CHECK FUNCTION
-- Allows anonymous users to check if an email has been invited
-- to a brand portal before attempting signup.
-- Returns: 'invited' | 'registered' | 'none'
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_brand_invitation(p_email text, p_brand_id integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = p_email AND brand_id = p_brand_id AND user_id IS NOT NULL
    ) THEN 'registered'
    WHEN EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = p_email AND brand_id = p_brand_id AND user_id IS NULL
    ) THEN 'invited'
    ELSE 'none'
  END
$$;

-- Grant to anon so unauthenticated signup pages can call it
GRANT EXECUTE ON FUNCTION public.check_brand_invitation(text, integer) TO anon;
