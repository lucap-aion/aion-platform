-- The visit that ends without a sale.
--
-- Everything this platform stores about a client starts with a purchase: a
-- cover, an order, a claim. The person who walked in, was shown four bags, said
-- "I'll think about it" and left is not in the database at all — and that is the
-- person a CRM team most wants back. What the store manager knows about them
-- lives in their head for about ten minutes after the door closes.
--
-- So this table is written by voice, from the shop floor, in the minute after
-- the client leaves. The manager talks; the assistant turns the recording into
-- a card and asks them to confirm it. Two deliberate consequences:
--
--   • customer_id is nullable, and stays nullable. A walk-in with no name is
--     still a visit worth having. Matching to a profile happens when we can,
--     and never blocks the row.
--   • outcome allows 'not_purchased' as a first-class value, not as the absence
--     of a sale. The reason it didn't happen (objection) is the column the
--     whole feature exists for.
--
-- The manager's confirmation is what makes a row real: the assistant writes
-- status 'draft', the human turns it into 'confirmed' — or corrects it first.
-- Nothing reads a draft as fact.

create table if not exists public.store_visits (
  id            uuid primary key default gen_random_uuid(),
  brand_id      integer not null references public.brands(id) on delete cascade,
  shop_id       integer references public.shops(id) on delete set null,
  -- The person who dictated it, so a head of CRM can see who is actually
  -- keeping the floor's memory and who is not.
  recorded_by   uuid references public.profiles(id) on delete set null,

  -- ── Who came in ────────────────────────────────────────────────────────────
  -- Nullable on purpose. See the header: an unmatched visit is the point.
  customer_id   uuid references public.profiles(id) on delete set null,
  -- The name as the manager said it, kept even after a match: it is the
  -- evidence for the match, and the only trace when there is nobody to match to.
  customer_said text,
  -- How sure the matching was, so the UI can ask instead of assuming.
  match_confidence text check (match_confidence in ('exact', 'likely', 'none')),

  visited_at    timestamptz not null default now(),

  -- ── The raw material ───────────────────────────────────────────────────────
  source        text not null default 'voice' check (source in ('voice', 'typed')),
  audio_path    text,           -- object in the private visit_audio bucket
  transcript    text,
  language      text,           -- what they spoke, not what the UI is set to

  -- ── What the assistant made of it ──────────────────────────────────────────
  outcome       text check (outcome in ('purchased', 'not_purchased', 'undecided')),
  summary       text,           -- one line, the way a colleague would recap it
  -- [{ product, sku, size, colour, reaction }] — what was actually touched.
  items         jsonb not null default '[]'::jsonb,
  -- Why it did not close. Free text on purpose: "too heavy for her", "waiting
  -- for the husband to see it" and "price" are not the same objection, and a
  -- fixed vocabulary would have thrown away the useful two.
  objection     text,
  occasion      text,           -- gift, wedding, anniversary, self
  sentiment     text check (sentiment in ('positive', 'neutral', 'negative')),
  follow_up     text,           -- the action, in the manager's own terms
  follow_up_due date,
  tags          text[] not null default '{}',

  -- ── State ──────────────────────────────────────────────────────────────────
  status        text not null default 'draft'
                check (status in ('draft', 'confirmed', 'failed')),
  -- Set by the structuring pass when it had to guess something that matters.
  needs_review  boolean not null default false,
  error         text,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists store_visits_brand_idx
  on public.store_visits (brand_id, visited_at desc);
create index if not exists store_visits_customer_idx
  on public.store_visits (customer_id, visited_at desc)
  where customer_id is not null;
-- The two queries a head of CRM actually runs: who didn't buy, and who is owed
-- a call today.
create index if not exists store_visits_outcome_idx
  on public.store_visits (brand_id, outcome, visited_at desc);
create index if not exists store_visits_followup_idx
  on public.store_visits (brand_id, follow_up_due)
  where follow_up_due is not null and status = 'confirmed';

create or replace function public.touch_store_visit()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists store_visits_touch on public.store_visits;
create trigger store_visits_touch
  before update on public.store_visits
  for each row execute function public.touch_store_visit();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- The role vocabulary here is a minefield: policies written as brand_admin /
-- brand_user deny everyone, because every real brand profile carries role
-- 'brand' (see 20260911000005). And `profiles` holds the brand's CLIENTS too,
-- with the same brand_id — so "a profile of this brand" would hand every client
-- the floor's notes about them. Hence the shape below: anyone of this brand who
-- is not a customer, plus admins, who have no profiles row at all.
alter table public.store_visits enable row level security;
grant select, insert, update, delete on public.store_visits to authenticated;
grant all on public.store_visits to service_role;

create or replace function public.is_brand_staff(p_brand_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = public.get_my_profile_id()
      and p.brand_id = p_brand_id
      and coalesce(p.role, '') <> 'customer'
  );
$$;

drop policy if exists "store_visits: staff read" on public.store_visits;
create policy "store_visits: staff read"
  on public.store_visits for select to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));

drop policy if exists "store_visits: staff insert" on public.store_visits;
create policy "store_visits: staff insert"
  on public.store_visits for insert to authenticated
  with check (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));

-- A manager correcting the card the assistant drafted is the normal path, not
-- an edge case, so update is the same gate as insert.
drop policy if exists "store_visits: staff update" on public.store_visits;
create policy "store_visits: staff update"
  on public.store_visits for update to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id))
  with check (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));

-- Deleting someone's visit history is not a shop-floor action.
drop policy if exists "store_visits: master delete" on public.store_visits;
create policy "store_visits: master delete"
  on public.store_visits for delete to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = store_visits.brand_id
        and coalesce(p.role, '') <> 'customer'
        and p.is_master
    )
  );

-- ── The recording itself ─────────────────────────────────────────────────────
-- Private from the first day, unlike the three buckets 20260911000009 had to
-- retrofit. A client's voice being described is PII; the manager's voice saying
-- it is PII twice over.
insert into storage.buckets (id, name, public)
values ('visit_audio', 'visit_audio', false)
on conflict (id) do update set public = false;

-- Keep the blanket policy from covering it, exactly as that migration did for
-- its three. Every other bucket keeps the behaviour it has today.
drop policy if exists "allow all" on storage.objects;
create policy "allow all"
  on storage.objects for all to public
  using (bucket_id not in ('claims_media', 'profile_pictures', 'purchase_receipts', 'visit_audio'))
  with check (bucket_id not in ('claims_media', 'profile_pictures', 'purchase_receipts', 'visit_audio'));

-- Path convention: <brand_id>/<visit_id>.<ext>. The first segment is the brand,
-- so the check is the same one the table makes.
drop policy if exists "visit_audio: staff read" on storage.objects;
create policy "visit_audio: staff read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'visit_audio' and (
      public.get_my_role() = 'admin'
      -- Guarded: a cast error inside a policy would break every read of the
      -- bucket, not just the malformed object.
      or ((storage.foldername(name))[1] ~ '^[0-9]+$'
          and public.is_brand_staff(((storage.foldername(name))[1])::integer))
    )
  );

drop policy if exists "visit_audio: staff write" on storage.objects;
create policy "visit_audio: staff write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'visit_audio' and (
      public.get_my_role() = 'admin'
      -- Guarded: a cast error inside a policy would break every read of the
      -- bucket, not just the malformed object.
      or ((storage.foldername(name))[1] ~ '^[0-9]+$'
          and public.is_brand_staff(((storage.foldername(name))[1])::integer))
    )
  );
