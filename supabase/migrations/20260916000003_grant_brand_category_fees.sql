-- The per-category rates panel could not read its own table.
--
-- "permission denied for table brand_category_fees", from the one screen the table exists
-- for. RLS was enabled and a policy was written, and that is the half of the job that looks
-- like the whole of it: a policy decides WHICH ROWS a role may touch, and grants decide
-- whether the role may touch the table at all. Without the grant the policy is never
-- consulted — Postgres refuses at the door.
--
-- Nothing in the schema hints at it, and the sibling table this was modelled on
-- (insurance_quotes) has the grant, so the omission is invisible by comparison unless you
-- think to look. Second time today: see also the anon column grant on brands.
--
-- `authenticated` only. The policy still restricts every one of these to AION admins
-- (get_my_role() = 'admin'); the grant is what lets the policy have an opinion.
grant select, insert, update, delete on public.brand_category_fees to authenticated;

-- bigserial: inserting a row assigns from the sequence, and a grant on the table alone
-- refuses that with a different and even less obvious error.
grant usage, select on sequence public.brand_category_fees_id_seq to authenticated;
