-- Customer wishlist — one row per (customer, catalogue item) pair. Customers
-- favourite pieces from their brand's catalogue on /discover; brand-side
-- aggregation (a future "what's in demand" view) gets to read all of them
-- for their brand via the existing brand-role RLS.

create table if not exists public.wishlist_items (
  id            bigserial primary key,
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  catalogue_id  bigint not null references public.catalogues(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (customer_id, catalogue_id)
);

create index if not exists wishlist_items_customer_idx
  on public.wishlist_items (customer_id);
create index if not exists wishlist_items_catalogue_idx
  on public.wishlist_items (catalogue_id);

alter table public.wishlist_items enable row level security;

grant select, insert, delete on public.wishlist_items to authenticated;
grant all on public.wishlist_items to service_role;

-- Customer owns their own rows.
drop policy if exists "wishlist_items: customer select" on public.wishlist_items;
create policy "wishlist_items: customer select"
  on public.wishlist_items for select to authenticated
  using (customer_id = public.get_my_profile_id());

drop policy if exists "wishlist_items: customer insert" on public.wishlist_items;
create policy "wishlist_items: customer insert"
  on public.wishlist_items for insert to authenticated
  with check (customer_id = public.get_my_profile_id());

drop policy if exists "wishlist_items: customer delete" on public.wishlist_items;
create policy "wishlist_items: customer delete"
  on public.wishlist_items for delete to authenticated
  using (customer_id = public.get_my_profile_id());

-- Brand team can read aggregated demand for their brand's catalogue.
drop policy if exists "wishlist_items: brand select" on public.wishlist_items;
create policy "wishlist_items: brand select"
  on public.wishlist_items for select to authenticated
  using (
    public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
    and catalogue_id in (
      select id from public.catalogues where brand_id = public.get_my_brand_id()
    )
  );

drop policy if exists "wishlist_items: admin all" on public.wishlist_items;
create policy "wishlist_items: admin all"
  on public.wishlist_items for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
