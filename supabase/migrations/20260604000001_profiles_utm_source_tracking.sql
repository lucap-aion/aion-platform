-- Source attribution for customers: where they came from when they signed up
-- (e.g. Roberto Coin program page, RC post-purchase email, aioncover.com website).
-- The client captures utm_* from the entry URL and passes them as auth metadata at
-- signup; the existing sync trigger copies them onto the pre-created profile by email.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text;

-- Extend the signup sync to persist the attribution. COALESCE keeps first-touch and
-- leaves untracked/direct signups null. Existing name-sync behaviour is unchanged.
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
    registered_at = COALESCE(registered_at, NOW()),
    utm_source   = COALESCE(utm_source,   NEW.raw_user_meta_data->>'utm_source'),
    utm_medium   = COALESCE(utm_medium,   NEW.raw_user_meta_data->>'utm_medium'),
    utm_campaign = COALESCE(utm_campaign, NEW.raw_user_meta_data->>'utm_campaign')
  WHERE email = NEW.email;
  RETURN NEW;
END;
$$;
