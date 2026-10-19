-- Trunk Show events: history + costs + outcomes, so the assistant can plan an
-- event from past performance (optimal duration/period, PR ROI, stock from prior
-- sell-through) and attribute post-event revenue back to invited clients and the
-- influencer who brought them.
--
-- Two tables:
--   events           — one row per trunk show (planned or past), with costs,
--                      guest counts and revenue.
--   event_attendees  — the invite/attribution list: which client was invited,
--                      whether they attended and converted, and who (influencer)
--                      brought them. customer_id is nullable because a brand whose
--                      clients live in the knowledge base (e.g. Luisa Beccaria)
--                      has no CRM profile row — we keep the name in that case.
--
-- RLS mirrors the other brand tables (get_my_brand_id() + is_brand_role(), plus
-- admin-all), so the assistant's brand-scoped SQL runner (ai_run_query_scoped)
-- pins reads to one brand automatically.

create table if not exists public.events (
  id             bigserial primary key,
  brand_id       bigint not null references public.brands(id) on delete cascade,
  name           text not null,
  city           text,
  country        text,
  venue          text,
  start_date     date,
  end_date       date,
  -- planned | confirmed | completed | cancelled
  status         text not null default 'planned'
                   check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  pr_agency      text,
  pr_cost        numeric,
  venue_cost     numeric,
  shipping_cost  numeric,
  other_cost     numeric,
  guests_invited integer,
  guests_attended integer,
  revenue        numeric,
  currency       text not null default 'EUR',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists events_brand_idx on public.events (brand_id, start_date desc);

create table if not exists public.event_attendees (
  id           bigserial primary key,
  event_id     bigint not null references public.events(id) on delete cascade,
  brand_id     bigint not null references public.brands(id) on delete cascade,
  customer_id  uuid references public.profiles(id) on delete set null,
  customer_name text,
  segment      text,             -- VIC / Premium / Regular / Entry (as known)
  invited      boolean not null default true,
  attended     boolean not null default false,
  influencer   text,             -- who brought them (PR / influencer / referral)
  converted    boolean not null default false,
  revenue      numeric,          -- revenue attributed to this attendee at the event
  created_at   timestamptz not null default now()
);

create index if not exists event_attendees_event_idx on public.event_attendees (event_id);
create index if not exists event_attendees_brand_idx on public.event_attendees (brand_id);

-- updated_at touch on events (reuse the shared trigger fn).
drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_ai_chats_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.events          enable row level security;
alter table public.event_attendees enable row level security;

grant select on public.events          to authenticated;
grant select on public.event_attendees to authenticated;
grant all    on public.events          to service_role;
grant all    on public.event_attendees to service_role;

drop policy if exists "admin: all on events" on public.events;
create policy "admin: all on events" on public.events for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists "brand: all on own brand events" on public.events;
create policy "brand: all on own brand events" on public.events for all to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role())
  with check (brand_id = public.get_my_brand_id() and public.is_brand_role());

drop policy if exists "admin: all on event_attendees" on public.event_attendees;
create policy "admin: all on event_attendees" on public.event_attendees for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists "brand: all on own brand event_attendees" on public.event_attendees;
create policy "brand: all on own brand event_attendees" on public.event_attendees for all to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role())
  with check (brand_id = public.get_my_brand_id() and public.is_brand_role());

-- ── Example seed data (Luisa Beccaria, brand 17) ─────────────────────────────
-- DEV-only illustrative history so the trunk-show playbook has something to plan
-- from. Clearly-rounded example figures — replace with the brand's real numbers.
insert into public.events
  (brand_id, name, city, country, venue, start_date, end_date, status, pr_agency,
   pr_cost, venue_cost, shipping_cost, other_cost, guests_invited, guests_attended, revenue, notes)
values
  (17, 'Trunk Show Milano SS24', 'Milano', 'IT', 'Palazzo Serbelloni', '2024-03-14', '2024-03-16', 'completed', 'Studio Milano PR', 12000, 9000, 3500, 4000, 420, 96, 182000, 'Example seed data'),
  (17, 'Trunk Show New York FW24', 'New York', 'US', 'The Mark Hotel', '2024-10-09', '2024-10-11', 'completed', 'Bergdorf Relations', 18000, 14000, 9800, 6000, 360, 74, 221000, 'Example seed data'),
  (17, 'Trunk Show London SS25', 'London', 'GB', 'Claridge''s', '2025-05-07', '2025-05-09', 'completed', 'Mayfair PR', 15000, 12500, 7200, 5000, 300, 81, 196500, 'Example seed data'),
  (17, 'Trunk Show London 2026', 'London', 'GB', null, '2026-05-06', '2026-05-08', 'planned', null, null, null, null, null, null, null, null, 'Upcoming — planning in progress')
on conflict do nothing;

-- A few attributed attendees for the completed London SS25 event (id resolved by
-- name so this stays correct regardless of serial values).
insert into public.event_attendees (event_id, brand_id, customer_name, segment, invited, attended, influencer, converted, revenue)
select e.id, 17, v.customer_name, v.segment, true, v.attended, v.influencer, v.converted, v.revenue
from public.events e
cross join (values
  ('Eugenia Gemmo',        'VIC',     true,  'Mayfair PR',      true,  14200),
  ('Margherita Moroni',    'Premium', true,  'Referral',        true,   6800),
  ('Anastasia Sakellariou','VIC',     true,  'Mayfair PR',      true,  22500),
  ('Jayne Scott',          'Regular', true,  'Instagram @xxx',  false,     0),
  ('Doriana Giustina',     'Premium', false, 'Referral',        true,   4300)
) as v(customer_name, segment, attended, influencer, converted, revenue)
where e.brand_id = 17 and e.name = 'Trunk Show London SS25'
on conflict do nothing;
