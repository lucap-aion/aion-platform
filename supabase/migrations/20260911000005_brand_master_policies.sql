-- The rest of the policies that name a role no profile has.
--
-- 20260730000019 found this and fixed exactly one table: the policies say
-- `brand_admin`, or `brand_user` with is_master — and every real brand profile
-- in this database carries role 'brand'. That migration added the missing
-- branch to brand_knowledge_docs' soft delete and left its five siblings, all
-- written from the same template, all still refusing everyone.
--
-- Verified here rather than assumed, as a real Luisa Beccaria master:
--   knowledge_gaps         dismiss a gap            → 0 rows, silently
--   knowledge_sources      toggle a crawl source    → 0 rows, silently
--   brand_assistant_config save assistant settings  → 0 rows, silently
--   knowledge_crawl_queue  queue a crawl            → RLS violation
-- The UI reports success on the first three, because an UPDATE that matches
-- nothing is not an error. A brand has been able to see its list of knowledge
-- gaps since July and never able to clear one; six are still sitting there.
--
-- Nobody gains an ability they were not meant to have: the master gate stays,
-- and only the branch matching the roles that actually exist is added, exactly
-- as 20260730000019 wrote it. Admins were always covered by the first branch,
-- which is why this never showed up in our own testing — we are the ones who
-- have been dismissing these for them.

-- ── knowledge_gaps: dismiss a gap ────────────────────────────────────────────
drop policy if exists "knowledge_gaps: brand admin update" on public.knowledge_gaps;
create policy "knowledge_gaps: brand admin update"
  on public.knowledge_gaps for update to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_gaps.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_gaps.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

-- ── knowledge_sources: turn a crawl source on or off ─────────────────────────
drop policy if exists "knowledge_sources: brand admin update" on public.knowledge_sources;
create policy "knowledge_sources: brand admin update"
  on public.knowledge_sources for update to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_sources.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_sources.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

-- ── brand_assistant_config: the assistant's own settings ─────────────────────
drop policy if exists "brand_assistant_config: brand admin insert" on public.brand_assistant_config;
create policy "brand_assistant_config: brand admin insert"
  on public.brand_assistant_config for insert to authenticated
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

drop policy if exists "brand_assistant_config: brand admin update" on public.brand_assistant_config;
create policy "brand_assistant_config: brand admin update"
  on public.brand_assistant_config for update to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

-- ── knowledge_crawl_queue: queue a site to read ──────────────────────────────
drop policy if exists "knowledge_crawl_queue: brand admin insert" on public.knowledge_crawl_queue;
create policy "knowledge_crawl_queue: brand admin insert"
  on public.knowledge_crawl_queue for insert to authenticated
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

drop policy if exists "knowledge_crawl_queue: brand admin update" on public.knowledge_crawl_queue;
create policy "knowledge_crawl_queue: brand admin update"
  on public.knowledge_crawl_queue for update to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_crawl_queue.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );

-- ── brand_knowledge_docs: the hard delete beside the soft one ────────────────
-- The soft delete was fixed in 20260730000019; the DELETE policy it sits next to
-- was not, so the two disagreed about who a brand master is.
drop policy if exists "brand_knowledge_docs: brand admin delete" on public.brand_knowledge_docs;
create policy "brand_knowledge_docs: brand admin delete"
  on public.brand_knowledge_docs for delete to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_knowledge_docs.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master) or (p.role = 'brand' and p.is_master))
    )
  );
