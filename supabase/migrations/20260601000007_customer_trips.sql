-- Customer trips — the "travel mode" surface. Customer declares an upcoming
-- trip (destination + dates) on /travel; brand sees their customers'
-- upcoming travel on the customer detail page so the clienteling team can
-- proactively reach out before the customer leaves home with their piece.

create table if not exists public.customer_trips (
  id                    bigserial primary key,
  customer_id           uuid not null references public.profiles(id) on delete cascade,
  destination_country   text not null,
  destination_city      text,
  start_date            date not null,
  end_date              date,
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists customer_trips_customer_idx
  on public.customer_trips (customer_id, start_date desc);
create index if not exists customer_trips_dates_idx
  on public.customer_trips (start_date, end_date);

alter table public.customer_trips enable row level security;

grant select, insert, update, delete on public.customer_trips to authenticated;
grant all on public.customer_trips to service_role;

-- Customer manages their own trips.
drop policy if exists "customer_trips: customer all" on public.customer_trips;
create policy "customer_trips: customer all"
  on public.customer_trips for all to authenticated
  using (customer_id = public.get_my_profile_id())
  with check (customer_id = public.get_my_profile_id());

-- Brand-role users see their own customers' trips. Joined via profiles so
-- the brand check follows the customer's brand_id, not via a denormalised
-- column on the trip row itself.
drop policy if exists "customer_trips: brand select" on public.customer_trips;
create policy "customer_trips: brand select"
  on public.customer_trips for select to authenticated
  using (
    public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
    and customer_id in (
      select id from public.profiles where brand_id = public.get_my_brand_id()
    )
  );

drop policy if exists "customer_trips: admin all" on public.customer_trips;
create policy "customer_trips: admin all"
  on public.customer_trips for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
