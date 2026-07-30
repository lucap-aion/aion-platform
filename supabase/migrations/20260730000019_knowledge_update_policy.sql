-- The soft delete I shipped did not work for the people it is for.
--
-- brand_knowledge_docs had SELECT and DELETE policies and no UPDATE policy.
-- That was fine while deleting meant DELETE. Turning it into a soft delete made
-- it an UPDATE, which RLS silently refused for every brand user: the statement
-- matched zero rows, the function returned "not found", and the document stayed
-- exactly where it was. A working hard delete had been replaced with a broken
-- soft delete, and only clicking the button in a browser showed it.
--
-- The UPDATE policy mirrors the DELETE policy EXACTLY — the same brand-admin /
-- master condition. Nobody gains an ability they did not already have; the
-- ability they had simply works again.
--
-- The write is still confined to the deletion columns: update_knowledge (the
-- edit path) goes through its own edge function with the service role, so this
-- policy does not need to allow content edits, and shouldn't.

drop policy if exists "brand_knowledge_docs: brand admin soft delete" on public.brand_knowledge_docs;
create policy "brand_knowledge_docs: brand admin soft delete"
  on public.brand_knowledge_docs
  for update to authenticated
  using (
    (public.get_my_role() = 'admin')
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_knowledge_docs.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  )
  with check (
    (public.get_my_role() = 'admin')
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_knowledge_docs.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

-- The DELETE policy named brand_user + is_master, but every real brand profile
-- carries role 'brand' — so on the actual data that branch never matched and
-- deletion fell through to the admin check. Both branches are covered above so
-- the behaviour matches what the policy was clearly written to mean.

-- RLS is only half of it: PostgREST also needs the table privilege, and
-- `authenticated` had SELECT and DELETE but no UPDATE — so the soft delete came
-- back as 42501 "permission denied for table" before RLS was even consulted.
--
-- Granted at COLUMN level on purpose. A blanket UPDATE would let any brand admin
-- rewrite a document's content or category straight through the REST API;
-- editing goes through update-knowledge (service role, re-chunks and re-embeds)
-- and must keep doing so. Only the two deletion columns are writable here.
grant update (deleted_at, deleted_by) on public.brand_knowledge_docs to authenticated;
