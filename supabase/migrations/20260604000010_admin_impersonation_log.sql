-- Audit trail for admin "view-as / impersonate" sessions.
-- One row per time an AION admin starts viewing the platform as a customer or
-- brand user. ended_at is best-effort (set when the admin clicks Exit).

CREATE TABLE IF NOT EXISTS public.admin_impersonation_log (
  id                bigserial PRIMARY KEY,
  admin_id          uuid NOT NULL REFERENCES public.admins(id),
  target_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  target_role       text,
  brand_id          int  REFERENCES public.brands(id),
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_log_admin
  ON public.admin_impersonation_log (admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_log_target
  ON public.admin_impersonation_log (target_profile_id, started_at DESC);

ALTER TABLE public.admin_impersonation_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.admin_impersonation_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.admin_impersonation_log_id_seq TO authenticated;

-- Admins only — same pattern as every other table. The admin's real JWT
-- satisfies get_my_role()='admin', so the client can insert/update directly.
DROP POLICY IF EXISTS "admin: all on impersonation log" ON public.admin_impersonation_log;
CREATE POLICY "admin: all on impersonation log"
  ON public.admin_impersonation_log FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
