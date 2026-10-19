-- Audit item 4, step 2 of 2 — only once the client reads brands_public (step 1).
--
-- With the slug policies gone, a signed-in non-admin sees one row of brands: their own
-- house's ("Users can view own brand" / "customer: select own brand" / brand staff), which
-- is what the customer pages' brands(name, logo_small) embeds need. Admins keep everything.
-- Logged-out visitors read brands_public only, so anon loses the table outright.
--
-- What remains, and needs a table split rather than a policy: a customer can still read
-- their OWN house's commercial columns. Every other house's are closed.

drop policy if exists "public: read brands by slug" on public.brands;
drop policy if exists "Public can read brands by slug" on public.brands;

revoke select on public.brands from anon;
