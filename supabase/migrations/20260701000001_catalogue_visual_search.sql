-- Visual product search for the sales-assistant chat.
-- An associate photographs a piece a client is wearing / points at, and we
-- return the exact catalogue item (name, collection, SKU, photo) by matching
-- the photo against embeddings of the brand's own catalogue images.
--
-- Embeddings are produced by Voyage AI (voyage-multimodal-3.5, 1024 dims, image
-- and text share one space) in the index-catalogue-images edge function; this
-- migration only owns the storage and the brand-scoped similarity search RPC.
-- Kept in a side table (not a column on catalogues) so we can re-embed / version
-- independently of the eplay sync that owns the catalogue rows.

create extension if not exists vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- catalogue_image_embeddings: one row per catalogue item we've embedded.
-- picture_url is stored so a re-index can skip items whose image is unchanged.
-- brand_id is denormalised so the similarity search filters by brand cheaply
-- (the hnsw index can't reach through a join).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalogue_image_embeddings (
  catalogue_id  bigint primary key references public.catalogues(id) on delete cascade,
  brand_id      bigint not null references public.brands(id) on delete cascade,
  picture_url   text not null,
  embedding     vector(1024),
  model         text not null default 'voyage-multimodal-3.5',
  updated_at    timestamptz not null default now()
);

create index if not exists catalogue_image_embeddings_brand_idx
  on public.catalogue_image_embeddings (brand_id);

-- Cosine-distance HNSW index for the similarity search.
create index if not exists catalogue_image_embeddings_embedding_idx
  on public.catalogue_image_embeddings
  using hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — brand users read their own brand's rows; admins read all. All writes go
-- through the index-catalogue-images edge function with the service role, so
-- there are no INSERT/UPDATE/DELETE policies for authenticated users.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.catalogue_image_embeddings enable row level security;

grant select on public.catalogue_image_embeddings to authenticated;
grant all    on public.catalogue_image_embeddings to service_role;

drop policy if exists "catalogue_image_embeddings: brand or admin read" on public.catalogue_image_embeddings;
create policy "catalogue_image_embeddings: brand or admin read"
  on public.catalogue_image_embeddings for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (
      select p.brand_id from public.profiles p
      where p.id = public.get_my_profile_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- match_catalogue_images(p_brand_id, p_query_embedding, p_match_count,
--                        p_min_similarity)
-- Brand-scoped cosine similarity search over catalogue image embeddings.
-- SECURITY INVOKER so the RLS above is the real gate: a brand user can only ever
-- match their own brand's items even if they pass someone else's p_brand_id.
-- Joins back to catalogues so the caller gets everything needed to render a
-- product card. Returns a 0..1 similarity score (1 = identical).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.match_catalogue_images(
  p_brand_id        bigint,
  p_query_embedding vector(1024),
  p_match_count     integer default 8,
  p_min_similarity  double precision default 0.2
)
returns table (
  catalogue_id  bigint,
  name          text,
  collection    text,
  category      text,
  sku           text,
  picture       text,
  similarity    double precision
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    e.catalogue_id,
    c.name,
    c.collection,
    c.category,
    c.sku,
    c.picture,
    1 - (e.embedding <=> p_query_embedding) as similarity
  from public.catalogue_image_embeddings e
  join public.catalogues c on c.id = e.catalogue_id
  where e.brand_id = p_brand_id
    and e.embedding is not null
    and 1 - (e.embedding <=> p_query_embedding) >= p_min_similarity
  order by e.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 24));
$$;

revoke all on function public.match_catalogue_images(bigint, vector, integer, double precision) from public;
grant execute on function public.match_catalogue_images(bigint, vector, integer, double precision) to authenticated;
