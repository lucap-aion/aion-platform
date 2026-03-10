-- Trigger function: deletes the auth.users row when an admin or profile is deleted
CREATE OR REPLACE FUNCTION delete_auth_user_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

-- Trigger on admins table
DROP TRIGGER IF EXISTS trg_delete_auth_user_on_admin_delete ON admins;
CREATE TRIGGER trg_delete_auth_user_on_admin_delete
  AFTER DELETE ON admins
  FOR EACH ROW
  EXECUTE FUNCTION delete_auth_user_on_delete();

-- Trigger on profiles table
DROP TRIGGER IF EXISTS trg_delete_auth_user_on_profile_delete ON profiles;
CREATE TRIGGER trg_delete_auth_user_on_profile_delete
  AFTER DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION delete_auth_user_on_delete();
