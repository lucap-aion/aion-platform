-- No separate guard for AION's feature switches on brands.
--
-- 20261103000003 added a trigger so a brand's own staff could not flip
-- discussions_enabled through the "brand: update own brand" policy, and a first
-- draft of this file extended it to assistant_enabled. Both were redundant:
-- brands_guard_staff_updates (BEFORE UPDATE, every column) already refuses any
-- staff change outside name / email / website / description / hq_* — so both
-- switches, and every other setting, were already AION's alone. The tests that
-- "proved" the new guard only hit it first because triggers fire in name order.
--
-- One guard is the rule; two would be two places to keep in step. Removed.

drop trigger if exists brands_guard_admin_flags on public.brands;
drop function if exists public.brands_guard_admin_flags();
drop trigger if exists brands_guard_discussions_flag on public.brands;
drop function if exists public.brands_guard_discussions_flag();
