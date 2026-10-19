-- Audit item 6, step 2 of 2 — once the portals sign in through check_my_*_access.
-- The two checks that take somebody else's email are no longer the anon key's to call.

revoke all on function public.check_brand_eligibility(text, integer) from public, anon, authenticated;
revoke all on function public.check_admin_eligibility(text) from public, anon, authenticated;
grant execute on function public.check_brand_eligibility(text, integer) to service_role;
grant execute on function public.check_admin_eligibility(text) to service_role;
