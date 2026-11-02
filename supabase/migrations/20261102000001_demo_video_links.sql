-- Per-recipient links to the demo film, and who opened them.
--
-- The film used to be shared as one signed storage URL, which lasts thirty days and says
-- nothing about who opened it: everyone the link was forwarded to looks the same, and
-- storage keeps no viewer log. Giulio wants to know whether the person he sent it to has
-- watched it. So each recipient gets a token of their own; /watch/<token> plays the film
-- through the watch-demo function, which records the opening and how far it was watched.
--
-- Admin-only tables: brand staff never see these, and the public page reaches them through
-- the function's service role, never through RLS.

create table if not exists public.demo_video_links (
  id              uuid primary key default gen_random_uuid(),
  brand_id        bigint not null references public.brands(id) on delete cascade,
  -- 18 hex characters: short enough for a WhatsApp message, long enough not to be guessed.
  token           text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  recipient_name  text not null,
  recipient_email text,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists demo_video_links_brand_idx on public.demo_video_links (brand_id, created_at desc);

create table if not exists public.demo_video_views (
  id             uuid primary key default gen_random_uuid(),
  link_id        uuid not null references public.demo_video_links(id) on delete cascade,
  opened_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  -- The furthest second reached, not the sum of time played: a viewer who scrubs to the
  -- end has "seen" the end, and one who replays the first minute three times has not.
  max_position_s numeric not null default 0,
  duration_s     numeric,
  completed      boolean not null default false,
  user_agent     text,
  ip             text,
  country        text,
  referrer       text
);
create index if not exists demo_video_views_link_idx on public.demo_video_views (link_id, opened_at desc);

alter table public.demo_video_links enable row level security;
alter table public.demo_video_views enable row level security;

-- Admins have no profiles row, so these are keyed on get_my_role(), which knows them.
drop policy if exists "demo_video_links: admin all" on public.demo_video_links;
create policy "demo_video_links: admin all"
  on public.demo_video_links for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "demo_video_views: admin read" on public.demo_video_views;
create policy "demo_video_views: admin read"
  on public.demo_video_views for select to authenticated
  using (public.get_my_role() = 'admin');
