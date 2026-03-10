-- Sync first_name, last_name, and user_id from auth.users → profiles on signup
-- Matches by email since profiles are pre-created by admin before the user signs up.

CREATE OR REPLACE FUNCTION public.sync_user_metadata_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    user_id    = NEW.id,
    first_name = COALESCE(first_name, NEW.raw_user_meta_data->>'first_name'),
    last_name  = COALESCE(last_name,  NEW.raw_user_meta_data->>'last_name'),
    registered_at = COALESCE(registered_at, NOW())
  WHERE email = NEW.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_metadata ON auth.users;
CREATE TRIGGER trg_sync_user_metadata
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_metadata_to_profile();

-- Also fire on UPDATE so that if user updates their metadata it propagates
CREATE OR REPLACE FUNCTION public.sync_user_metadata_on_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only sync names if they are changing and the profile fields are still null
  UPDATE public.profiles
  SET
    first_name = COALESCE(first_name, NEW.raw_user_meta_data->>'first_name'),
    last_name  = COALESCE(last_name,  NEW.raw_user_meta_data->>'last_name')
  WHERE user_id = NEW.id
    AND (first_name IS NULL OR last_name IS NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_metadata_update ON auth.users;
CREATE TRIGGER trg_sync_user_metadata_update
AFTER UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_metadata_on_update();

-- Backfill: update existing profiles that have a linked user but missing names
UPDATE public.profiles p
SET
  first_name = COALESCE(p.first_name, u.raw_user_meta_data->>'first_name'),
  last_name  = COALESCE(p.last_name,  u.raw_user_meta_data->>'last_name')
FROM auth.users u
WHERE p.user_id = u.id
  AND (p.first_name IS NULL OR p.last_name IS NULL)
  AND (u.raw_user_meta_data->>'first_name' IS NOT NULL OR u.raw_user_meta_data->>'last_name' IS NOT NULL);
