-- ============================================================
-- Fix admin triggers to populate registered_at and
-- email_confirmed_at, which were missing from the originals.
-- ============================================================

-- ─── 1. Link admins.user_id + set registered_at on signup ────

CREATE OR REPLACE FUNCTION public.sync_auth_user_to_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.admins
  SET
    user_id       = NEW.id,
    registered_at = COALESCE(registered_at, NOW())
  WHERE email     = NEW.email
    AND user_id   IS NULL;
  RETURN NEW;
END;
$$;

-- ─── 2. Set status + email_confirmed_at on confirmation ──────

CREATE OR REPLACE FUNCTION public.handle_admin_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
    UPDATE public.admins
    SET
      status             = 'verified',
      email_confirmed_at = NEW.email_confirmed_at
    WHERE email  = NEW.email
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;
