-- ============================================================
-- FIX: Only delete auth.users when the LAST profile for that
-- user is deleted (multi-brand users have multiple profiles).
--
-- The admin trigger is unchanged — admins always have exactly
-- one row so the original logic is correct.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_auth_user_on_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only wipe the auth user if this was their last profile row
  IF OLD.user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = OLD.user_id
        AND id <> OLD.id
    ) THEN
      DELETE FROM auth.users WHERE id = OLD.user_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

-- Replace the old trigger with the new function
DROP TRIGGER IF EXISTS trg_delete_auth_user_on_profile_delete ON public.profiles;
CREATE TRIGGER trg_delete_auth_user_on_profile_delete
  AFTER DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_auth_user_on_profile_delete();
