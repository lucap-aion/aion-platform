-- Brand campaigns — audit log + record-of-send for bulk outreach to a saved
-- segment (the chips on BrandCustomers). The brand picks a segment + intent,
-- AI drafts a template (subject + body with {first_name}-style placeholders),
-- the brand reviews and exports the recipient list as CSV / addresses for
-- their email tool. We don't actually send — that's deliberately deferred
-- until a deliverability / SPF / GDPR-consent story is in place. The row
-- here records the recipient set so brands can answer "who got this?".

create table if not exists public.brand_campaigns (
  id              bigserial primary key,
  brand_id        bigint not null references public.brands(id) on delete cascade,
  segment_key     text not null,
  intent          text not null,
  subject         text not null,
  body            text not null,
  recipient_count int not null default 0,
  recipient_ids   uuid[] not null default '{}'::uuid[],
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists brand_campaigns_brand_created_idx
  on public.brand_campaigns (brand_id, created_at desc);

alter table public.brand_campaigns enable row level security;

grant select, insert, update, delete on public.brand_campaigns to authenticated;
grant all on public.brand_campaigns to service_role;

drop policy if exists "brand_campaigns: brand select" on public.brand_campaigns;
create policy "brand_campaigns: brand select"
  on public.brand_campaigns for select to authenticated
  using (
    brand_id = public.get_my_brand_id()
    and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
  );

drop policy if exists "brand_campaigns: brand insert" on public.brand_campaigns;
create policy "brand_campaigns: brand insert"
  on public.brand_campaigns for insert to authenticated
  with check (
    brand_id = public.get_my_brand_id()
    and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
  );

drop policy if exists "brand_campaigns: brand delete" on public.brand_campaigns;
create policy "brand_campaigns: brand delete"
  on public.brand_campaigns for delete to authenticated
  using (
    brand_id = public.get_my_brand_id()
    and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
  );

drop policy if exists "brand_campaigns: admin select" on public.brand_campaigns;
create policy "brand_campaigns: admin select"
  on public.brand_campaigns for select to authenticated
  using (public.get_my_role() = 'admin');
