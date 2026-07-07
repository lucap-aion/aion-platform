-- Knowledge-base file uploads: a private Storage bucket for the raw files a
-- brand uploads (PDF / DOCX / PPTX / TXT / MD / CSV). The parse-knowledge edge
-- function downloads each file with the service role, extracts its text, then
-- chunks + embeds it into brand_knowledge_docs / brand_knowledge_chunks exactly
-- like ingest-knowledge does (source_type='upload').
--
-- Objects are keyed  {brand_id}/{uuid}.{ext}  so the first path segment is the
-- owning brand — that's what the RLS policies below gate on. Reads for parsing
-- go through the service role (bypasses RLS); the policies here only govern what
-- an authenticated brand user may do directly from the browser (upload the file,
-- and clean it up).

insert into storage.buckets (id, name, public)
values ('brand-knowledge-uploads', 'brand-knowledge-uploads', false)
on conflict (id) do nothing;

-- Brand admins / master brand users may upload into their OWN brand's prefix;
-- AION admins may upload into any brand's prefix (used when viewing-as a brand).
drop policy if exists "kb uploads: brand insert" on storage.objects;
create policy "kb uploads: brand insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-knowledge-uploads' and (
      public.get_my_role() = 'admin'
      or exists (
        select 1 from public.profiles p
        where p.id = public.get_my_profile_id()
          and p.brand_id::text = (storage.foldername(name))[1]
          and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
      )
    )
  );

-- Same audience may read back / delete their own brand's uploaded files.
drop policy if exists "kb uploads: brand read" on storage.objects;
create policy "kb uploads: brand read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-knowledge-uploads' and (
      public.get_my_role() = 'admin'
      or exists (
        select 1 from public.profiles p
        where p.id = public.get_my_profile_id()
          and p.brand_id::text = (storage.foldername(name))[1]
          and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
      )
    )
  );

drop policy if exists "kb uploads: brand delete" on storage.objects;
create policy "kb uploads: brand delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-knowledge-uploads' and (
      public.get_my_role() = 'admin'
      or exists (
        select 1 from public.profiles p
        where p.id = public.get_my_profile_id()
          and p.brand_id::text = (storage.foldername(name))[1]
          and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
      )
    )
  );
