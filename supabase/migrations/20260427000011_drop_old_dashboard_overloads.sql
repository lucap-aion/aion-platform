-- ============================================================
-- Drop the old 4-arg overloads of admin_dashboard_aggregates and
-- dashboard_policy_stats. Migration 20260427000010 added a
-- p_shop_ids parameter via CREATE OR REPLACE FUNCTION, but Postgres
-- treats a different signature as a new overload rather than a
-- replacement, so the 4-arg versions kept existing alongside the
-- new 5-arg ones. PostgREST then refuses to choose between two
-- candidates when the frontend calls with 4 named params, returning
-- an error and leaving every dashboard KPI rendering as 0.
--
-- The 5-arg versions accept p_shop_ids with DEFAULT NULL, so old
-- 4-arg call sites still work after the old overloads are dropped.
-- ============================================================

DROP FUNCTION IF EXISTS public.dashboard_policy_stats(int[], timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.admin_dashboard_aggregates(int[], timestamptz, timestamptz, uuid[]);
