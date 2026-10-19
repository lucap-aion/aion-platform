-- Audit item 7. external_api_credentials holds the bearer tokens a house's own system uses
-- to call aion-api (Roberto Coin's integration creates its covers with one). The token is
-- stored in plain text because aion-api compares it as such (`.eq("token", token)`), and
-- aion-api is not changed here: storing a hash instead needs that one comparison changed
-- in the API first.
--
-- What changes is who can reach it. "brand: all on own brand external_api_credentials" let
-- any member of a house's staff READ that token — and update or delete it: a boutique
-- account could impersonate the house's integration, or take it offline. Nothing in the app
-- reads the table. aion-api reads it with the service role, which RLS does not apply to
-- (verified 2026-10-19: 35 integration requests in the previous 7 days). Admins keep their
-- policy; anon had no business holding the grant.

drop policy if exists "brand: all on own brand external_api_credentials" on public.external_api_credentials;
revoke all on public.external_api_credentials from anon;
