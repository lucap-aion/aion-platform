-- Sizes.
--
-- storefront_products keeps ONE price and ONE availability flag per product,
-- because that is all the sync ever wrote. The feed it reads has always carried
-- more: a Luisa Beccaria cardigan comes back as five variants — 38, 40, 42, 44,
-- 46 — each with its own price and its own `available`. We fetched that every
-- Monday and threw it away.
--
-- So the most common question on a shop floor, "ce l'abbiamo in 42?", had no
-- answer, and the assistant's honest "the catalogue doesn't say" was a fact
-- about our schema rather than about the stock.
--
-- One row per variant, keyed on (product_id, title): titles are unique within a
-- product, and unlike Shopify's variant id they also exist for feeds that have
-- no ids. The sync marks every variant it sees with the run's timestamp and
-- deletes anything older for the brand, so a size the shop retires disappears.

create table if not exists public.storefront_variants (
  id                bigserial primary key,
  brand_id          integer not null references public.brands(id) on delete cascade,
  product_id        bigint  not null references public.storefront_products(id) on delete cascade,
  -- Shopify's own id. Informational: useful when we later talk to the Admin API
  -- about a specific variant, not used as the key here.
  variant_id        bigint,
  -- "38", "M", "42 / Nero".
  title             text not null,
  -- What the shop calls the axis: "Size", or "Size / Colour" on two options.
  option_name       text,
  sku               text,
  -- Per size, the shop's own price, NOT gated on availability the way the
  -- product-level price is: a sold-out 38 still has a price worth quoting
  -- alongside the 40 that is in stock.
  price             numeric,
  compare_at_price  numeric,
  available         boolean not null default false,
  position          integer,
  updated_at        timestamptz not null default now(),
  unique (product_id, title)
);

create index if not exists storefront_variants_product_idx
  on public.storefront_variants (product_id);
create index if not exists storefront_variants_brand_idx
  on public.storefront_variants (brand_id, available);
-- The sweep deletes by (brand_id, updated_at) on every sync.
create index if not exists storefront_variants_sweep_idx
  on public.storefront_variants (brand_id, updated_at);

alter table public.storefront_variants enable row level security;
grant select on public.storefront_variants to authenticated;
grant all on public.storefront_variants to service_role;

-- Exactly the read rule storefront_products carries: get_my_brand_id() honours
-- the assistant's txn-local scope GUC, so an admin in view-as stays pinned to
-- the one brand. Writes are service-role only (the sync), so there is no insert
-- or update policy by design.
drop policy if exists "storefront_variants: brand or admin read" on public.storefront_variants;
create policy "storefront_variants: brand or admin read"
  on public.storefront_variants for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = public.get_my_brand_id()
  );
