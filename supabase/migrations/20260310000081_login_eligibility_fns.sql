-- ============================================================
-- PRE-LOGIN ELIGIBILITY CHECKS (callable by anon)
-- These run BEFORE signInWithPassword so we never log in
-- a user who shouldn't have access.
-- ============================================================

-- ─── Admin portal eligibility ────────────────────────────────
-- Returns 'ok' if the email belongs to an admin, else 'not_admin'
CREATE OR REPLACE FUNCTION public.check_admin_eligibility(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.admins WHERE email = p_email) THEN 'ok'
    ELSE 'not_admin'
  END
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_eligibility(text) TO anon;


-- ─── Brand portal eligibility ────────────────────────────────
-- Returns:
--   'ok'          – profile exists for this brand, email confirmed
--   'is_admin'    – email belongs to an admin (wrong portal)
--   'wrong_brand' – profile exists but for a different brand (or no profile at all)
--   'unconfirmed' – profile exists for this brand but email not yet confirmed
CREATE OR REPLACE FUNCTION public.check_brand_eligibility(p_email text, p_brand_id integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.admins WHERE email = p_email
    ) THEN 'is_admin'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE email = p_email AND brand_id = p_brand_id
    ) THEN 'wrong_brand'
    WHEN EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = p_email AND brand_id = p_brand_id AND status = 'pending'
    ) THEN 'unconfirmed'
    ELSE 'ok'
  END
$$;

GRANT EXECUTE ON FUNCTION public.check_brand_eligibility(text, integer) TO anon;
