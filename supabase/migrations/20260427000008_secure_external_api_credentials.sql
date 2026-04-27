-- ============================================================
-- Bring dev in line with prod: enable RLS on external_api_credentials
-- and restrict access to admins (full) and brand users (own brand
-- rows only). Prod already has these via 20260426175743 — this
-- migration covers dev so the two databases match.
-- ============================================================

ALTER TABLE public.external_api_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin: all on external_api_credentials"            ON public.external_api_credentials;
DROP POLICY IF EXISTS "brand: all on own brand external_api_credentials"  ON public.external_api_credentials;

CREATE POLICY "admin: all on external_api_credentials"
  ON public.external_api_credentials
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "brand: all on own brand external_api_credentials"
  ON public.external_api_credentials
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (brand_id = get_my_brand_id() AND is_brand_role())
  WITH CHECK (brand_id = get_my_brand_id() AND is_brand_role());
