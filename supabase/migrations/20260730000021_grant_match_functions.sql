-- The document generator's "retrieval by meaning" never actually ran.
--
-- generate-brand-docs calls match_brand_knowledge with the SERVICE ROLE client,
-- but that function was only ever granted to `authenticated` — service_role is
-- not a superuser and gets no implicit rights. Every call returned "permission
-- denied", the result was destructured without checking `error`, and the loop
-- simply ran zero times. The generator fell back to "the longest storytelling
-- and policy documents", which is why every brand's drafts were grounded in
-- Terms of Sale and Whistleblowing pages rather than its story.
--
-- The assistant was unaffected: it calls the same function with the USER client,
-- which does have the grant. That is exactly why this stayed invisible — the
-- feature everyone looks at worked.
grant execute on function public.match_brand_knowledge(integer, vector, integer, double precision) to service_role;
grant execute on function public.match_storefront_images(bigint, vector, integer, double precision) to service_role;
