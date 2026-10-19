-- Knowledge-base management: let brand admins (and master brand users) delete
-- their own brand's knowledge docs from the management UI. Inserts still go
-- through the ingest-knowledge / scrape-knowledge edge functions (service role);
-- reads are already covered by the SELECT policies in 20260625000001.
--
-- Deleting a doc cascades to its chunks (FK ON DELETE CASCADE).

drop policy if exists "brand_knowledge_docs: brand admin delete" on public.brand_knowledge_docs;
create policy "brand_knowledge_docs: brand admin delete"
  on public.brand_knowledge_docs for delete
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_knowledge_docs.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

grant delete on public.brand_knowledge_docs to authenticated;
