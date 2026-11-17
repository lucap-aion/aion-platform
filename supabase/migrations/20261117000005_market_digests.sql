-- The weekly luxury-CX digest Giulio receives (cloud routine → digest-mail function).
--
-- Each row is one email that went out, kept so next week's run can ask which articles it
-- already covered — the routine has no memory of its own, and it no longer reads a Gmail
-- Sent folder now that the mail leaves through Resend as automations@aioncover.com.
--
-- Only the digest-mail function touches this table, with the service role. RLS is on with
-- no policies on purpose: no signed-in user, admin or not, has a reason to read it.

create table if not exists public.market_digests (
  id          bigint generated always as identity primary key,
  sent_at     timestamptz not null default now(),
  subject     text not null,
  recipients  text[] not null,
  urls        text[] not null default '{}',
  html        text not null,
  is_test     boolean not null default false,
  resend_id   text
);

create index if not exists market_digests_sent_at_idx on public.market_digests (sent_at desc);

alter table public.market_digests enable row level security;
revoke all on public.market_digests from anon, authenticated;
