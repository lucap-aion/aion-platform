-- ============================================================
-- ADMIN LINKING & VERIFICATION TRIGGERS
--
-- 1. When a new auth user is created (signUp), automatically
--    link the corresponding admins row by email so that
--    AuthContext can find it by user_id from the first login.
--
-- 2. When a user confirms their email (email_confirmed_at set),
--    set admins.status = 'verified' for their row.
--    (profiles.status is already handled by handle_email_confirmed)
-- ============================================================

-- ─── 1. Link admins.user_id on auth.users INSERT ─────────────

CREATE OR REPLACE FUNCTION public.sync_auth_user_to_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.admins
  SET user_id = NEW.id
  WHERE email = NEW.email
    AND user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_admin_user ON auth.users;
CREATE TRIGGER trg_sync_admin_user
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_auth_user_to_admin();


-- ─── 2. Set admins.status = 'verified' on email confirmation ─

CREATE OR REPLACE FUNCTION public.handle_admin_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
    UPDATE public.admins
    SET status = 'verified'
    WHERE email = NEW.email
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_admin_email_confirmed ON auth.users;
CREATE TRIGGER on_admin_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_admin_email_confirmed();
