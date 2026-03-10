-- ============================================================
-- Fix check_brand_eligibility to block users whose auth email
-- is not yet confirmed (e.g. invited but haven't clicked link).
-- Previously only checked profiles.status = 'pending', but
-- profiles created with status = 'active' bypassed this check.
-- ============================================================

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
    WHEN EXISTS (
      SELECT 1 FROM auth.users WHERE email = p_email AND email_confirmed_at IS NULL
    ) THEN 'unconfirmed'
    ELSE 'ok'
  END
$$;

GRANT EXECUTE ON FUNCTION public.check_brand_eligibility(text, integer) TO anon;
