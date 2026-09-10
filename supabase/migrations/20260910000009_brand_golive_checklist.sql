-- The go-live checklist, per brand.
--
-- Bringing a brand live is a long list of things across configuration, taxonomy,
-- the sales integration, the insurer and the launch itself. Until now that list
-- lived in a document, which means it lived in one person's copy of it: two
-- admins working the same brand could not see what the other had already closed,
-- and nothing recorded when an item was done or by whom.
--
-- So the state moves into the platform, next to the brand it belongs to. What is
-- deliberately NOT here is the list of items: those live in code
-- (src/lib/goLiveChecklist.ts) because they evolve as the platform does, and a
-- brand should pick up a newly added item automatically rather than being stuck
-- with the list as it stood the day it was created. This table only records what
-- has been done — an item with no row has simply not been touched.
--
-- Not a pipeline: the items genuinely get done out of order (the insurer
-- quotation runs for weeks in the background while configuration proceeds), so
-- nothing here gates anything.
create table if not exists public.brand_golive_checklist (
  brand_id   bigint not null references public.brands(id) on delete cascade,
  -- Matches an item key in the code-side definition. Kept as free text rather
  -- than an enum so adding an item is a deploy, not a migration.
  item_key   text not null,
  done       boolean not null default false,
  note       text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (brand_id, item_key)
);

comment on table public.brand_golive_checklist is
  'Per-brand go-live checklist state, shared across AION admins. Item definitions live in code (src/lib/goLiveChecklist.ts); a missing row means the item has not been touched.';

alter table public.brand_golive_checklist enable row level security;
grant select, insert, update, delete on public.brand_golive_checklist to authenticated;
grant all on public.brand_golive_checklist to service_role;

-- AION staff only. A brand user must never see, let alone tick, the internal
-- list of what is still missing before their own programme can go live.
drop policy if exists "admin: all on brand_golive_checklist" on public.brand_golive_checklist;
create policy "admin: all on brand_golive_checklist" on public.brand_golive_checklist
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

create index if not exists brand_golive_checklist_brand on public.brand_golive_checklist (brand_id);
