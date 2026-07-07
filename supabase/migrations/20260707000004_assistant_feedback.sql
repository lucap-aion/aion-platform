-- Coverage & quality feedback loop for the in-store Assistant:
--   • knowledge_gaps  — questions the assistant couldn't answer from the KB
--     (search_knowledge returned nothing relevant). Logged by the edge fn so a
--     brand can see exactly what knowledge to add. Deduped per brand + query,
--     with a hit counter.
--   • assistant_feedback — 👍/👎 an associate leaves on an answer.

-- ── knowledge_gaps ────────────────────────────────────────────────────────────
create table if not exists public.knowledge_gaps (
  id            uuid primary key default gen_random_uuid(),
  brand_id      integer not null references public.brands(id) on delete cascade,
  query         text not null,
  query_norm    text not null,
  hits          integer not null default 1,
  top_similarity real,
  dismissed     boolean not null default false,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (brand_id, query_norm)
);
create index if not exists knowledge_gaps_brand_idx
  on public.knowledge_gaps (brand_id, dismissed, hits desc);

alter table public.knowledge_gaps enable row level security;
grant select, update on public.knowledge_gaps to authenticated;
grant all on public.knowledge_gaps to service_role;

drop policy if exists "knowledge_gaps: brand or admin read" on public.knowledge_gaps;
create policy "knowledge_gaps: brand or admin read"
  on public.knowledge_gaps for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (select p.brand_id from public.profiles p where p.id = public.get_my_profile_id())
  );

drop policy if exists "knowledge_gaps: brand admin update" on public.knowledge_gaps;
create policy "knowledge_gaps: brand admin update"
  on public.knowledge_gaps for update
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_gaps.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = knowledge_gaps.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

-- Upsert a gap (called by the brand-assistant edge fn with the service role).
create or replace function public.log_knowledge_gap(
  p_brand_id integer, p_query text, p_top_similarity real default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_brand_id is null or coalesce(btrim(p_query), '') = '' then return; end if;
  insert into public.knowledge_gaps (brand_id, query, query_norm, top_similarity)
  values (p_brand_id, left(p_query, 500), lower(btrim(p_query)), p_top_similarity)
  on conflict (brand_id, query_norm) do update
    set hits = public.knowledge_gaps.hits + 1,
        last_seen = now(),
        top_similarity = greatest(coalesce(public.knowledge_gaps.top_similarity, 0), coalesce(excluded.top_similarity, 0)),
        dismissed = false;
end $fn$;
revoke all on function public.log_knowledge_gap(integer, text, real) from public;
grant execute on function public.log_knowledge_gap(integer, text, real) to service_role;

-- ── assistant_feedback ────────────────────────────────────────────────────────
create table if not exists public.assistant_feedback (
  id             uuid primary key default gen_random_uuid(),
  brand_id       integer not null references public.brands(id) on delete cascade,
  profile_id     uuid references public.profiles(id) on delete set null,
  chat_id        uuid,
  question       text,
  answer_excerpt text,
  rating         smallint not null check (rating in (-1, 1)),
  created_at     timestamptz not null default now()
);
create index if not exists assistant_feedback_brand_idx
  on public.assistant_feedback (brand_id, created_at desc);

alter table public.assistant_feedback enable row level security;
grant select, insert on public.assistant_feedback to authenticated;
grant all on public.assistant_feedback to service_role;

-- Anyone in the brand (associates included) may leave feedback on their brand.
drop policy if exists "assistant_feedback: brand insert" on public.assistant_feedback;
create policy "assistant_feedback: brand insert"
  on public.assistant_feedback for insert
  with check (
    profile_id = public.get_my_profile_id()
    and exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id() and p.brand_id = assistant_feedback.brand_id
    )
  );

drop policy if exists "assistant_feedback: brand or admin read" on public.assistant_feedback;
create policy "assistant_feedback: brand or admin read"
  on public.assistant_feedback for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (select p.brand_id from public.profiles p where p.id = public.get_my_profile_id())
  );
