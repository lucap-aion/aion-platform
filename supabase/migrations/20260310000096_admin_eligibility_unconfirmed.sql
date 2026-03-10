-- check_admin_eligibility now distinguishes unconfirmed (pending) admins
-- Returns: 'ok' | 'unconfirmed' | 'not_admin'

CREATE OR REPLACE FUNCTION public.check_admin_eligibility(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.admins WHERE email = p_email
    ) THEN 'not_admin'
    WHEN EXISTS (
      SELECT 1 FROM public.admins WHERE email = p_email AND status = 'pending'
    ) THEN 'unconfirmed'
    ELSE 'ok'
  END
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_eligibility(text) TO anon;
