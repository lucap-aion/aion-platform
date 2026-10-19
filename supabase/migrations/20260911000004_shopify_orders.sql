-- Orders and customers from a brand's Shopify, not just its catalogue.
--
-- What we read today is the PUBLIC storefront feed: no credentials, no orders,
-- no customers. So an associate advising a client in the boutique cannot see
-- what that same client bought online last month — the two halves of the
-- relationship sit in different systems, and only one of them is ours.
--
-- Orders deliberately do NOT go in `policies`. A policy is an insurance cover,
-- not a purchase; Luisa Beccaria has 1,013 products and zero policies, so
-- bending that table would break the model for the house most likely to use
-- this first. They get their own tables and join the client card alongside
-- covers and trunk-show history.
--
-- Nothing here switches itself on: a connection starts `unconfigured` and
-- `enabled = false`, and the sync refuses to run until someone has tested the
-- token and turned it on.

-- ── The connection ───────────────────────────────────────────────────────────
create table if not exists public.storefront_connections (
  brand_id          integer primary key references public.brands(id) on delete cascade,
  -- "house.myshopify.com" — the admin host, not the public domain.
  shop_domain       text not null,
  api_version       text not null default '2025-07',
  -- The Admin API token lives in Vault; this is only the name of the secret.
  token_secret_name text,
  status            text not null default 'unconfigured'
                      check (status in ('unconfigured', 'untested', 'ok', 'error')),
  -- What the token actually grants, read back from the shop on test, so a
  -- missing scope is a named problem instead of a 403 nobody can explain.
  scopes            text[],
  missing_scopes    text[],
  last_test_at      timestamptz,
  last_error        text,
  -- Off until a human turns it on, after a green test.
  enabled           boolean not null default false,
  -- Don't drag in a decade of history on the first run.
  orders_since      date,
  last_sync_at      timestamptz,
  -- Shopify's cursor (the `page_info` from the Link header) so a long backfill
  -- resumes instead of starting again.
  next_cursor       text,
  orders_synced     integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Orders ───────────────────────────────────────────────────────────────────
create table if not exists public.storefront_orders (
  id                  bigserial primary key,
  brand_id            integer not null references public.brands(id) on delete cascade,
  shopify_order_id    bigint  not null,
  order_number        text,
  placed_at           timestamptz,
  currency            text,
  subtotal            numeric,
  total               numeric,
  total_discounts     numeric,
  financial_status    text,
  fulfillment_status  text,
  cancelled_at        timestamptz,
  customer_email      text,
  customer_name       text,
  customer_phone      text,
  shopify_customer_id bigint,
  -- The AION client this order belongs to, when we can tell. Null is normal:
  -- guest checkout, or a shopper who has never been in a boutique.
  profile_id          uuid references public.profiles(id) on delete set null,
  matched_by          text check (matched_by in ('email', 'phone', 'manual')),
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (brand_id, shopify_order_id)
);

create index if not exists storefront_orders_brand_idx on public.storefront_orders (brand_id, placed_at desc);
create index if not exists storefront_orders_profile_idx on public.storefront_orders (profile_id, placed_at desc);
create index if not exists storefront_orders_email_idx on public.storefront_orders (brand_id, lower(customer_email));

create table if not exists public.storefront_order_items (
  id                 bigserial primary key,
  order_id           bigint  not null references public.storefront_orders(id) on delete cascade,
  brand_id           integer not null references public.brands(id) on delete cascade,
  shopify_line_id    bigint,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  -- The catalogue row this line is, when the SKU matches one we already hold.
  product_id         bigint references public.storefront_products(id) on delete set null,
  sku                text,
  name               text,
  variant_title      text,
  quantity           integer not null default 1,
  price              numeric,
  total_discount     numeric,
  -- Refunds arrive as their own objects on the order; carried here so a
  -- returned piece stops counting as bought.
  refunded_quantity  integer not null default 0,
  unique (order_id, shopify_line_id)
);

create index if not exists storefront_order_items_order_idx on public.storefront_order_items (order_id);
create index if not exists storefront_order_items_sku_idx on public.storefront_order_items (brand_id, sku);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Reads follow storefront_products exactly: the brand, or an admin, and
-- get_my_brand_id() honours the assistant's txn-local scope so view-as stays
-- pinned. Writes are the sync's alone (service role bypasses RLS).
alter table public.storefront_connections  enable row level security;
alter table public.storefront_orders       enable row level security;
alter table public.storefront_order_items  enable row level security;

grant select on public.storefront_connections to authenticated;
grant select on public.storefront_orders to authenticated;
grant select on public.storefront_order_items to authenticated;
grant all on public.storefront_connections to service_role;
grant all on public.storefront_orders to service_role;
grant all on public.storefront_order_items to service_role;

drop policy if exists "storefront_connections: brand or admin read" on public.storefront_connections;
create policy "storefront_connections: brand or admin read"
  on public.storefront_connections for select
  using (public.get_my_role() = 'admin' or brand_id = public.get_my_brand_id());

drop policy if exists "storefront_orders: brand or admin read" on public.storefront_orders;
create policy "storefront_orders: brand or admin read"
  on public.storefront_orders for select
  using (public.get_my_role() = 'admin' or brand_id = public.get_my_brand_id());

drop policy if exists "storefront_order_items: brand or admin read" on public.storefront_order_items;
create policy "storefront_order_items: brand or admin read"
  on public.storefront_order_items for select
  using (public.get_my_role() = 'admin' or brand_id = public.get_my_brand_id());

-- Setting a shop up is AION's job, not the brand's: the credential arrives from
-- the house over a call and a brand user must never be able to point the sync
-- at another shop. Creating a connection and attaching its token therefore runs
-- through the edge function (service role, admin caller only).
--
-- An admin may edit a connection they can already see — the on/off switch and
-- the date to start from. The token is not here to be edited: it lives in Vault
-- and is only ever written through shopify_set_token.
drop policy if exists "storefront_connections: admin update" on public.storefront_connections;
create policy "storefront_connections: admin update"
  on public.storefront_connections for update
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
grant update on public.storefront_connections to authenticated;

-- ── The token ────────────────────────────────────────────────────────────────
-- Vault, not a column. A plaintext Admin API token in a table is one bad RLS
-- policy away from being a brand's whole order book; external_api_credentials
-- holds tokens WE issue, which is a different risk.
create or replace function public.shopify_set_token(p_brand_id integer, p_token text)
returns text language plpgsql security definer set search_path = public, vault, pg_temp as $fn$
declare
  v_name text := 'shopify_token_brand_' || p_brand_id;
  v_id   uuid;
begin
  if p_brand_id is null or coalesce(btrim(p_token), '') = '' then
    raise exception 'brand_id and token are required';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_token, v_name, 'Shopify Admin API token for brand ' || p_brand_id);
  else
    perform vault.update_secret(v_id, p_token);
  end if;
  update public.storefront_connections
     set token_secret_name = v_name, updated_at = now()
   where brand_id = p_brand_id;
  return v_name;
end $fn$;

create or replace function public.shopify_get_token(p_brand_id integer)
returns text language sql security definer set search_path = public, vault, pg_temp as $fn$
  select s.decrypted_secret
    from public.storefront_connections c
    join vault.decrypted_secrets s on s.name = c.token_secret_name
   where c.brand_id = p_brand_id;
$fn$;

-- Forgetting a shop must forget its credential too.
create or replace function public.shopify_clear_token(p_brand_id integer)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $fn$
declare v_name text := 'shopify_token_brand_' || p_brand_id;
begin
  delete from vault.secrets where name = v_name;
  update public.storefront_connections
     set token_secret_name = null, status = 'unconfigured', enabled = false,
         scopes = null, missing_scopes = null, last_error = null, updated_at = now()
   where brand_id = p_brand_id;
end $fn$;

revoke all on function public.shopify_set_token(integer, text) from public;
revoke all on function public.shopify_get_token(integer) from public;
revoke all on function public.shopify_clear_token(integer) from public;
grant execute on function public.shopify_set_token(integer, text) to service_role;
grant execute on function public.shopify_get_token(integer) to service_role;
grant execute on function public.shopify_clear_token(integer) to service_role;
