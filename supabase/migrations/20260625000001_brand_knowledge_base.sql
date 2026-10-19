-- Brand knowledge base for the sales-assistant chat app.
-- Unstructured brand content (product dossiers, brand book / storytelling,
-- policies, training material) is chunked and embedded so the assistant can
-- retrieve it alongside the structured SQL data it already queries.
--
-- Embeddings are produced by Voyage AI (voyage-3.5, 1024 dims) in the
-- ingest-knowledge edge function; this migration only owns the storage and
-- the brand-scoped similarity search RPC.

create extension if not exists vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_knowledge_docs: one row per source document the brand uploads.
-- The raw text is kept so we can re-chunk / re-embed without re-uploading.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.brand_knowledge_docs (
  id           uuid primary key default gen_random_uuid(),
  brand_id     integer not null references public.brands(id) on delete cascade,
  title        text not null,
  -- 'product' | 'storytelling' | 'policy' | 'training' | 'other'
  category     text not null default 'other',
  -- where the text came from: 'manual' | 'upload' | 'url'
  source_type  text not null default 'manual',
  source_url   text,
  content      text not null default '',
  char_count   integer not null default 0,
  chunk_count  integer not null default 0,
  -- 'processing' | 'ready' | 'error'
  status       text not null default 'processing',
  error        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists brand_knowledge_docs_brand_idx
  on public.brand_knowledge_docs (brand_id, updated_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_knowledge_chunks: embedded slices of a doc. brand_id is denormalised
-- onto the chunk so the similarity search can filter by brand cheaply (the
-- ivf/hnsw index can't reach through a join).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.brand_knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references public.brand_knowledge_docs(id) on delete cascade,
  brand_id     integer not null references public.brands(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  token_count  integer,
  embedding    vector(1024),
  created_at   timestamptz not null default now()
);

create index if not exists brand_knowledge_chunks_doc_idx
  on public.brand_knowledge_chunks (doc_id, chunk_index);

create index if not exists brand_knowledge_chunks_brand_idx
  on public.brand_knowledge_chunks (brand_id);

-- Cosine-distance HNSW index for the similarity search.
create index if not exists brand_knowledge_chunks_embedding_idx
  on public.brand_knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- ── updated_at touch trigger (reuse the shared function from ai_chats)
drop trigger if exists brand_knowledge_docs_touch_updated_at on public.brand_knowledge_docs;
create trigger brand_knowledge_docs_touch_updated_at
  before update on public.brand_knowledge_docs
  for each row execute function public.touch_ai_chats_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — brand users read their own brand's docs/chunks; admins read all.
-- All writes go through the ingest-knowledge edge function with the service
-- role, so there are no INSERT/UPDATE/DELETE policies for authenticated users.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.brand_knowledge_docs   enable row level security;
alter table public.brand_knowledge_chunks enable row level security;

grant select on public.brand_knowledge_docs   to authenticated;
grant select on public.brand_knowledge_chunks to authenticated;
grant all    on public.brand_knowledge_docs   to service_role;
grant all    on public.brand_knowledge_chunks to service_role;

drop policy if exists "brand_knowledge_docs: brand or admin read" on public.brand_knowledge_docs;
create policy "brand_knowledge_docs: brand or admin read"
  on public.brand_knowledge_docs for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (
      select p.brand_id from public.profiles p
      where p.id = public.get_my_profile_id()
    )
  );

drop policy if exists "brand_knowledge_chunks: brand or admin read" on public.brand_knowledge_chunks;
create policy "brand_knowledge_chunks: brand or admin read"
  on public.brand_knowledge_chunks for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (
      select p.brand_id from public.profiles p
      where p.id = public.get_my_profile_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- match_brand_knowledge(p_brand_id, p_query_embedding, p_match_count,
--                       p_min_similarity)
-- Brand-scoped cosine similarity search. SECURITY INVOKER so the chunk RLS
-- above is the real gate: a brand user can only ever match their own brand's
-- chunks even if they pass someone else's p_brand_id. Returns the top matches
-- with a 0..1 similarity score (1 = identical).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.match_brand_knowledge(
  p_brand_id        integer,
  p_query_embedding vector(1024),
  p_match_count     integer default 6,
  p_min_similarity  double precision default 0.2
)
returns table (
  chunk_id    uuid,
  doc_id      uuid,
  doc_title   text,
  category    text,
  content     text,
  similarity  double precision
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.doc_id,
    d.title,
    d.category,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.brand_knowledge_chunks c
  join public.brand_knowledge_docs d on d.id = c.doc_id
  where c.brand_id = p_brand_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;

revoke all on function public.match_brand_knowledge(integer, vector, integer, double precision) from public;
grant execute on function public.match_brand_knowledge(integer, vector, integer, double precision) to authenticated;
