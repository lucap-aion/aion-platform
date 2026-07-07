-- More knowledge-base self-service for brand admins / master users:
--   • enqueue a specific page URL to crawl (beyond the auto-discovered site)
--   • retry a failed crawl URL (reset it to 'pending' for the worker)
--   • toggle a source on/off (e.g. turn recent-news ingestion off)
--
-- Doc edits (title / category / content + re-embed) go through the
-- update-knowledge edge function (service role) so chunks never desync — hence
-- no direct UPDATE policy on brand_knowledge_docs here.

-- ── knowledge_crawl_queue: brand admins may INSERT (add a URL) + UPDATE (retry).
grant insert, update on public.knowledge_crawl_queue to authenticated;

drop policy if exists "knowledge_crawl_queue: brand admin insert" on public.knowledge_crawl_queue;
create policy "knowledge_crawl_queue: brand admin insert"
  on public.knowledge_crawl_queue for insert
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

drop policy if exists "knowledge_crawl_queue: brand admin update" on public.knowledge_crawl_queue;
create policy "knowledge_crawl_queue: brand admin update"
  on public.knowledge_crawl_queue for update
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

-- ── knowledge_sources: brand admins may UPDATE (toggle enabled / news pref).
grant update on public.knowledge_sources to authenticated;

drop policy if exists "knowledge_sources: brand admin update" on public.knowledge_sources;
create policy "knowledge_sources: brand admin update"
  on public.knowledge_sources for update
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_sources.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_sources.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );
