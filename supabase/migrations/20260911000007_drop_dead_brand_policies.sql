-- Three policies that grant nothing, beside three that grant everything.
--
-- Auditing the write paths on the core tables after 20260911000005, these three
-- turned out to name the same roles no profile has — `brand_admin`, or
-- `brand_user` with is_master:
--
--   brands            UPDATE  "Brand users can update own brand"
--   claims            UPDATE  "Brand users can update brand claims"
--   support_messages  INSERT  "Brand users can insert support messages"
--
-- Unlike the knowledge tables, nothing is broken here. Each sits beside a
-- broader policy — "brand: update own brand", "brand: all on own brand claims",
-- "brand: all on own brand support_messages" — written against
-- `is_brand_role()`, which is `get_my_role() in ('brand','brand_admin','brand_user')`
-- and therefore does cover the roles that exist. Permissive policies are OR'd,
-- so the working one wins and these three are simply inert.
--
-- Verified before removing, as a real brand user rather than as an admin:
--   editing their own brand      → 1 row
--   editing a client on it       → 1 row
--   filing a support message     → inserted (probe row deleted)
--
-- They are dropped because a dead policy that looks alive is how this spread in
-- the first place: five knowledge policies were written from exactly this
-- template and did break, silently, for two months. Leaving the pattern lying
-- around invites the sixth.
--
-- If a `brand_admin` or `brand_user` role is ever introduced, is_brand_role()
-- already admits both — no access is lost by removing these.

drop policy if exists "Brand users can update own brand" on public.brands;
drop policy if exists "Brand users can update brand claims" on public.claims;
drop policy if exists "Brand users can insert support messages" on public.support_messages;
