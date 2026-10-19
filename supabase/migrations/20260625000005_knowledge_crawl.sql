-- Scalable knowledge ingestion: crawl the whole brand website + news, via a
-- queue + batched worker (a single edge function can't crawl hundreds of pages
-- within its timeout). Content-hash dedup means re-crawls only re-embed changed
-- pages. Reuses brand_knowledge_docs / brand_knowledge_chunks for storage.

-- Per-page content hash so re-crawls can skip unchanged pages.
alter table public.brand_knowledge_docs
  add column if not exists content_hash text;

-- ─────────────────────────────────────────────────────────────────────────────
-- knowledge_sources: per-brand configured ingestion sources (website, news…).
-- config holds derived bits like the cross-page boilerplate line set + caps.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_sources (
  id             uuid primary key default gen_random_uuid(),
  brand_id       integer not null references public.brands(id) on delete cascade,
  kind           text not null,                 -- 'website' | 'news'
  target         text not null,                 -- base url / news query
  enabled        boolean not null default true,
  config         jsonb not null default '{}'::jsonb,
  last_seeded_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (brand_id, kind)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- knowledge_crawl_queue: one row per discovered URL to fetch + index.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_crawl_queue (
  id            uuid primary key default gen_random_uuid(),
  brand_id      integer not null references public.brands(id) on delete cascade,
  url           text not null,
  kind          text not null default 'page',   -- 'page' | 'news'
  category_hint text,
  title         text,
  status        text not null default 'pending', -- pending | done | error | skipped
  content_hash  text,
  doc_id        uuid,
  attempts      integer not null default 0,
  error         text,
  enqueued_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (brand_id, url)
);

create index if not exists knowledge_crawl_queue_pick_idx
  on public.knowledge_crawl_queue (status, enqueued_at)
  where status = 'pending';
create index if not exists knowledge_crawl_queue_brand_idx
  on public.knowledge_crawl_queue (brand_id, status);

-- RLS: internal pipeline tables. Service role manages them; admins may read for
-- a status view. Brand users don't touch these directly.
alter table public.knowledge_sources       enable row level security;
alter table public.knowledge_crawl_queue   enable row level security;
grant all on public.knowledge_sources      to service_role;
grant all on public.knowledge_crawl_queue  to service_role;
grant select on public.knowledge_sources     to authenticated;
grant select on public.knowledge_crawl_queue to authenticated;

drop policy if exists "knowledge_sources: admin read" on public.knowledge_sources;
create policy "knowledge_sources: admin read" on public.knowledge_sources
  for select using (
    public.get_my_role() = 'admin'
    or brand_id = (select p.brand_id from public.profiles p where p.id = public.get_my_profile_id())
  );

drop policy if exists "knowledge_crawl_queue: admin read" on public.knowledge_crawl_queue;
create policy "knowledge_crawl_queue: admin read" on public.knowledge_crawl_queue
  for select using (
    public.get_my_role() = 'admin'
    or brand_id = (select p.brand_id from public.profiles p where p.id = public.get_my_profile_id())
  );

-- Atomically claim a batch of pending URLs for one brand (SKIP LOCKED so
-- concurrent workers don't collide). Marks them 'processing' and returns them.
create or replace function public.claim_crawl_batch(p_brand_id integer, p_limit integer default 8)
returns setof public.knowledge_crawl_queue
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.knowledge_crawl_queue q
     set status = 'processing', attempts = attempts + 1
   where q.id in (
     select id from public.knowledge_crawl_queue
      where brand_id = p_brand_id and status = 'pending'
      order by enqueued_at
      limit greatest(1, least(p_limit, 25))
      for update skip locked
   )
  returning q.*;
$$;

revoke all on function public.claim_crawl_batch(integer, integer) from public;
grant execute on function public.claim_crawl_batch(integer, integer) to service_role;
