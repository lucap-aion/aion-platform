-- storefront_products: the brand's FULL public catalogue, ingested straight from
-- its e-commerce (Roberto Coin runs Shopify; /products.json exposes the whole
-- range with name, description, category, tags, price and CDN images). This is
-- the browse/show/price/visual-search source — the complete range, with clean
-- image URLs — as opposed to `catalogues`, which is the subset synced from sales
-- and used to link a client to what they actually own.
--
-- Image embeddings live on this table (Voyage multimodal, 1024 dims) so visual
-- search matches against the full range with reliable photos.

create extension if not exists vector;

create table if not exists public.storefront_products (
  id               bigserial primary key,
  brand_id         bigint not null references public.brands(id) on delete cascade,
  handle           text not null,               -- stable Shopify product handle
  sku              text,                         -- first variant SKU (reference)
  name             text not null,
  category         text,                         -- Shopify product_type
  collection       text,                         -- derived from tags
  description      text,
  price            numeric,                      -- lowest variant price
  compare_at_price numeric,
  price_currency   text default 'EUR',
  available        boolean,
  image_url        text,
  product_url      text,
  image_embedding  vector(1024),
  updated_at       timestamptz not null default now(),
  unique (brand_id, handle)
);

create index if not exists storefront_products_brand_idx
  on public.storefront_products (brand_id);
create index if not exists storefront_products_embedding_idx
  on public.storefront_products using hnsw (image_embedding vector_cosine_ops);

-- ── RLS: brand users read their own brand; admins read all. Writes via the
--    sync-storefront edge function with the service role only.
alter table public.storefront_products enable row level security;
grant select on public.storefront_products to authenticated;
grant all    on public.storefront_products to service_role;

drop policy if exists "storefront_products: brand or admin read" on public.storefront_products;
create policy "storefront_products: brand or admin read"
  on public.storefront_products for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (
      select p.brand_id from public.profiles p
      where p.id = public.get_my_profile_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- match_storefront_images: brand-scoped visual search over the full storefront.
-- SECURITY INVOKER — the RLS above is the real brand gate.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.match_storefront_images(
  p_brand_id        bigint,
  p_query_embedding vector(1024),
  p_match_count     integer default 8,
  p_min_similarity  double precision default 0.2
)
returns table (
  id             bigint,
  name           text,
  collection     text,
  category       text,
  sku            text,
  price          numeric,
  price_currency text,
  image_url      text,
  product_url    text,
  similarity     double precision
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    s.id, s.name, s.collection, s.category, s.sku,
    s.price, s.price_currency, s.image_url, s.product_url,
    1 - (s.image_embedding <=> p_query_embedding) as similarity
  from public.storefront_products s
  where s.brand_id = p_brand_id
    and s.image_embedding is not null
    and 1 - (s.image_embedding <=> p_query_embedding) >= p_min_similarity
  order by s.image_embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 24));
$$;

revoke all on function public.match_storefront_images(bigint, vector, integer, double precision) from public;
grant execute on function public.match_storefront_images(bigint, vector, integer, double precision) to authenticated;
