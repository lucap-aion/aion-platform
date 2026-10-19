-- Brand onboarding: lead → demo-ready in one click.
--
-- Creating a brand already works. Everything after it was manual: someone had to
-- insert knowledge_sources rows by hand, add the brand to a HARDCODED map in the
-- sync-storefront function and redeploy it, then wait for a weekly cron — and
-- even then the brand platform was empty, because no customers, policies, shops
-- or logins exist for a brand nobody has sold to yet. Pomellato is what that
-- looks like: 2,516 knowledge chunks indexed, 0 products, 1 customer.
--
-- Three pieces here:
--   storefront_sources    — the hardcoded catalogue map, as data. A new brand is
--                           onboarded by inserting a row, not by shipping code.
--   brand_onboarding      — per-stage status for the orchestrator, so the admin
--                           can watch it run and re-run just the stage that failed.
--   demo data             — generate_brand_demo_data() builds a believable book
--                           of business from the brand's OWN scraped catalogue,
--                           every row logged in brand_demo_artifacts so
--                           purge_brand_demo_data() can take it all back out
--                           before the account goes live.

-- ── 1. Storefront sources (replaces the hardcoded STOREFRONTS map) ───────────
create table if not exists public.storefront_sources (
  brand_id     bigint primary key references public.brands(id) on delete cascade,
  base_url     text not null,
  platform     text not null default 'shopify' check (platform in ('shopify', 'none')),
  currency     text not null default 'EUR',
  -- Some shops leave Shopify's product_type empty on real products; skipping
  -- untyped items would then discard the whole catalogue (Luisa Beccaria).
  keep_untyped boolean not null default false,
  enabled      boolean not null default true,
  detected_at  timestamptz,
  last_synced_at timestamptz,
  created_at   timestamptz not null default now()
);

insert into public.storefront_sources (brand_id, base_url, currency, keep_untyped, detected_at)
values
  (2,  'https://www.robertocoin.com', 'EUR', false, now()),
  (17, 'https://luisabeccaria.com',   'EUR', true,  now())
on conflict (brand_id) do nothing;

-- ── 2. Onboarding stage tracking ─────────────────────────────────────────────
create table if not exists public.brand_onboarding (
  id          bigserial primary key,
  brand_id    bigint not null references public.brands(id) on delete cascade,
  -- sources | crawl | storefront | demo_data | demo_users | assistant
  stage       text not null,
  -- pending | running | done | failed | skipped
  status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  detail      jsonb not null default '{}'::jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz not null default now(),
  unique (brand_id, stage)
);

create index if not exists brand_onboarding_brand_idx on public.brand_onboarding (brand_id);

create or replace function public.brand_onboarding_set(
  p_brand_id bigint, p_stage text, p_status text,
  p_detail jsonb default '{}'::jsonb, p_error text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.brand_onboarding (brand_id, stage, status, detail, error, started_at, finished_at, updated_at)
  values (
    p_brand_id, p_stage, p_status, coalesce(p_detail, '{}'::jsonb), p_error,
    case when p_status = 'running' then now() end,
    case when p_status in ('done', 'failed', 'skipped') then now() end,
    now())
  on conflict (brand_id, stage) do update set
    status      = excluded.status,
    detail      = excluded.detail,
    error       = excluded.error,
    started_at  = case when excluded.status = 'running' then now()
                       else public.brand_onboarding.started_at end,
    finished_at = case when excluded.status in ('done', 'failed', 'skipped') then now() end,
    updated_at  = now();
$$;

-- ── 3. Demo artifacts (so a demo can be purged before go-live) ───────────────
create table if not exists public.brand_demo_artifacts (
  id         bigserial primary key,
  brand_id   bigint not null references public.brands(id) on delete cascade,
  table_name text not null,
  row_pk     text not null,
  created_at timestamptz not null default now()
);

create index if not exists brand_demo_artifacts_brand_idx
  on public.brand_demo_artifacts (brand_id, table_name);

-- ── RLS: admin-only. None of this is brand-facing. ───────────────────────────
alter table public.storefront_sources    enable row level security;
alter table public.brand_onboarding      enable row level security;
alter table public.brand_demo_artifacts  enable row level security;

grant select on public.storefront_sources   to authenticated;
grant select on public.brand_onboarding     to authenticated;
grant all    on public.storefront_sources   to service_role;
grant all    on public.brand_onboarding     to service_role;
grant all    on public.brand_demo_artifacts to service_role;

drop policy if exists "admin: all on storefront_sources" on public.storefront_sources;
create policy "admin: all on storefront_sources" on public.storefront_sources for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists "admin: all on brand_onboarding" on public.brand_onboarding;
create policy "admin: all on brand_onboarding" on public.brand_onboarding for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop policy if exists "admin: all on brand_demo_artifacts" on public.brand_demo_artifacts;
create policy "admin: all on brand_demo_artifacts" on public.brand_demo_artifacts for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
