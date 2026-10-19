-- Event line items: the pieces physically sent to a trunk show, one row per
-- garment, plus how each one ended up once the show closes.
--
-- Why a table and not just knowledge cards: the shipment already lives in the
-- knowledge base as a collection overview + per-DDT manifests, but those are
-- CHUNKED for semantic retrieval — the Hamptons overview alone splits into 7
-- chunks, so no single search ever returns the whole list. Asking the assistant
-- "what did we ship" cost 10 tool calls of re-searching to reassemble 51 rows,
-- and a different phrasing could stop early and under-report. A "give me all N
-- of something" question needs one exact query, not similarity search. The
-- knowledge cards stay — they answer "tell me about this piece"; this table
-- answers "list/count/aggregate the pieces".
--
-- The outcome columns are deliberately NULLABLE and default to NULL: a show that
-- hasn't been reconciled yet must read as "not known", never as "sold nothing".
-- That distinction is enforced by `outcome` being NULL until someone records it,
-- and it is the whole reason sold_qty has no default of 0.

create table if not exists public.event_items (
  id            bigserial primary key,
  event_id      bigint not null references public.events(id) on delete cascade,
  brand_id      bigint not null references public.brands(id) on delete cascade,

  -- what was sent
  article       text not null,      -- full ERP code, e.g. 'W26-41968-8240'
  description   text,
  category      text,               -- house taxonomy: Abiti / Gonne / Giacche …
  season        text,               -- collection code from the article: W26, P26, P27
  colour_code   text,               -- the DDT's COLOR column (a code, not a name)
  colour_name   text,               -- resolved name when known
  size          text,
  size_scale    text,               -- 'IT' | 'US' — 40 means nothing without this
  qty           integer not null default 1,
  composition   text,

  -- how it got there
  ddt_number    text,
  ddt_date      date,

  -- how it ended up. ALL NULL until the show is reconciled.
  -- sold | returned | retained (kept by the client on approval, not yet invoiced)
  outcome       text check (outcome in ('sold', 'returned', 'retained')),
  sold_qty      integer check (sold_qty >= 0),
  revenue       numeric,
  currency      text not null default 'EUR',
  customer_id   uuid references public.profiles(id) on delete set null,
  customer_name text,               -- brands whose clients live in the knowledge base
  reconciled_at timestamptz,        -- set when the outcome is recorded
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists event_items_event_idx   on public.event_items (event_id);
create index if not exists event_items_brand_idx   on public.event_items (brand_id);
create index if not exists event_items_article_idx on public.event_items (brand_id, article);
create index if not exists event_items_outcome_idx on public.event_items (event_id, outcome);

-- Revenue without a sale, or a sale without an outcome, would quietly corrupt
-- every aggregate built on this table.
-- CASE, not OR: a CHECK only rejects on FALSE, and passes on NULL. Written as
-- a chain of ORs, the 'sold'/'returned' arms evaluate to NULL whenever outcome
-- is NULL, so FALSE OR NULL OR NULL = NULL and the row was accepted — revenue
-- could be set on a piece with no outcome, which is exactly what this is meant
-- to stop. CASE always lands on one branch and returns a definite boolean.
alter table public.event_items drop constraint if exists event_items_outcome_coherent;
alter table public.event_items add constraint event_items_outcome_coherent check (
  case
    when outcome is null  then sold_qty is null and revenue is null
    when outcome = 'sold' then sold_qty is not null and sold_qty > 0
    else coalesce(sold_qty, 0) = 0
  end
);

drop trigger if exists event_items_touch_updated_at on public.event_items;
create trigger event_items_touch_updated_at
  before update on public.event_items
  for each row execute function public.touch_ai_chats_updated_at();

-- ── RLS — mirrors events / event_attendees ───────────────────────────────────
alter table public.event_items enable row level security;

grant select on public.event_items to authenticated;
grant all    on public.event_items to service_role;

drop policy if exists "admin: all on event_items" on public.event_items;
create policy "admin: all on event_items" on public.event_items for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists "brand: all on own brand event_items" on public.event_items;
create policy "brand: all on own brand event_items" on public.event_items for all to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role())
  with check (brand_id = public.get_my_brand_id() and public.is_brand_role());

-- ── Reconciliation view ──────────────────────────────────────────────────────
-- One row per event with sell-through, written so an unreconciled show reports
-- as unknown rather than as zero.
--
-- security_invoker is REQUIRED: a view runs as its owner by default, which would
-- read event_items with RLS bypassed and hand a brand user every brand's shows.
create or replace view public.event_sell_through
with (security_invoker = true) as
select
  e.id                                                     as event_id,
  e.brand_id,
  e.name,
  e.city,
  e.start_date,
  e.status,
  count(i.id)::int                                         as pieces_sent,
  count(i.id) filter (where i.outcome is not null)::int     as pieces_reconciled,
  count(i.id) filter (where i.outcome = 'sold')::int        as pieces_sold,
  count(i.id) filter (where i.outcome = 'returned')::int    as pieces_returned,
  count(i.id) filter (where i.outcome = 'retained')::int    as pieces_retained,
  sum(i.revenue)                                           as revenue_from_items,
  -- NULL, not 0, while nothing has been reconciled — the caller must be able to
  -- tell "no sales" from "not counted yet".
  case when count(i.id) filter (where i.outcome is not null) = 0 then null
       else round(100.0 * count(i.id) filter (where i.outcome = 'sold')
                        / nullif(count(i.id), 0), 1)
  end                                                      as sell_through_pct,
  count(i.id) filter (where i.outcome is not null) = count(i.id)
    and count(i.id) > 0                                    as fully_reconciled
from public.events e
left join public.event_items i on i.event_id = e.id
group by e.id, e.brand_id, e.name, e.city, e.start_date, e.status;

grant select on public.event_sell_through to authenticated, service_role;

comment on table public.event_items is
  'One row per garment sent to an event. Outcome columns stay NULL until the show is reconciled — NULL means not yet counted, never zero sales.';
