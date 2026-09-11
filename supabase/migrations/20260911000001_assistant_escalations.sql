-- Questions that reach AION.
--
-- Two feedback loops already existed and both stop at the brand: knowledge_gaps
-- (what the KB was missing) and assistant_feedback (👍/👎). Neither ever reaches
-- us, so the most valuable signal the assistant produces — the questions it
-- could NOT answer — was visible only to the house that asked, and only if
-- somebody opened the Knowledge page. Questions about the platform itself
-- ("can you connect to my Shopify?") were worse still: they are not a knowledge
-- gap, so nothing was logged at all. They simply evaporated.
--
-- This table is that missing inbox. Rows arrive two ways:
--   • source 'associate' — the associate pressed "Ask AION" on an answer. A
--     deliberate act, always its own row, note included.
--   • source 'assistant' — the assistant hit a question about AION (an
--     integration, a feature, something broken) and reported it itself. Deduped
--     per brand + question so one recurring ask is one row with a count, not
--     forty rows.

create table if not exists public.assistant_escalations (
  id             uuid primary key default gen_random_uuid(),
  brand_id       integer not null references public.brands(id) on delete cascade,
  profile_id     uuid references public.profiles(id) on delete set null,
  chat_id        uuid,
  -- Who put it here: the associate, or the assistant on their behalf.
  source         text not null default 'associate' check (source in ('associate', 'assistant')),
  question       text not null,
  -- Generated, not passed in: the dedup key must be the same shape whoever
  -- writes the row — the edge function, or an associate's own insert.
  question_norm  text generated always as (lower(btrim(question))) stored,
  -- What the associate added when sending it (the explicit path only).
  note           text,
  -- What the assistant had answered, so we can see WHY it was escalated.
  answer_excerpt text,
  hits           integer not null default 1,
  status         text not null default 'open' check (status in ('open', 'handled')),
  -- AION's own working note on the row. Never shown to the brand.
  admin_note     text,
  handled_at     timestamptz,
  last_seen      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists assistant_escalations_open_idx
  on public.assistant_escalations (status, last_seen desc);
create index if not exists assistant_escalations_brand_idx
  on public.assistant_escalations (brand_id, last_seen desc);
-- Only the assistant's own reports dedupe; a deliberate send is always kept.
create unique index if not exists assistant_escalations_auto_uniq
  on public.assistant_escalations (brand_id, question_norm)
  where source = 'assistant';

alter table public.assistant_escalations enable row level security;
grant select, insert, update on public.assistant_escalations to authenticated;
grant all on public.assistant_escalations to service_role;

-- Anyone in the brand may send a question to AION about their own brand.
drop policy if exists "assistant_escalations: brand insert" on public.assistant_escalations;
create policy "assistant_escalations: brand insert"
  on public.assistant_escalations for insert
  with check (
    profile_id = public.get_my_profile_id()
    and exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id() and p.brand_id = assistant_escalations.brand_id
    )
  );

-- An AION admin driving the assistant (testing it, or impersonating an
-- associate) has no profiles row of their own, so the brand policy above can
-- never pass for them — get_my_profile_id() is null. Without this they press
-- the button and get an error. ai_chats_brand already carries the same
-- admin-all policy for exactly this reason.
drop policy if exists "assistant_escalations: admin insert" on public.assistant_escalations;
create policy "assistant_escalations: admin insert"
  on public.assistant_escalations for insert
  with check (public.get_my_role() = 'admin');

-- AION sees everything, cross-brand — that is the point of the table. A brand
-- sees only what its own people sent.
drop policy if exists "assistant_escalations: admin or own brand read" on public.assistant_escalations;
create policy "assistant_escalations: admin or own brand read"
  on public.assistant_escalations for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (select p.brand_id from public.profiles p where p.id = public.get_my_profile_id())
  );

-- Working the inbox (status, admin_note) is ours alone: a brand must not be
-- able to close its own request, or read our note by writing to it.
drop policy if exists "assistant_escalations: admin update" on public.assistant_escalations;
create policy "assistant_escalations: admin update"
  on public.assistant_escalations for update
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- The assistant's own path, called by the edge function with the service role.
-- Deduped: the fortieth associate to ask about Shopify bumps a counter rather
-- than burying the other questions.
create or replace function public.log_assistant_escalation(
  p_brand_id       integer,
  p_question       text,
  p_answer_excerpt text default null,
  p_profile_id     uuid default null,
  p_chat_id        uuid default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_brand_id is null or coalesce(btrim(p_question), '') = '' then return; end if;
  insert into public.assistant_escalations
    (brand_id, profile_id, chat_id, source, question, answer_excerpt)
  values
    (p_brand_id, p_profile_id, p_chat_id, 'assistant',
     left(btrim(p_question), 500), nullif(left(coalesce(p_answer_excerpt, ''), 500), ''))
  on conflict (brand_id, question_norm) where source = 'assistant' do update
    set hits      = public.assistant_escalations.hits + 1,
        last_seen = now(),
        -- Asked again after we closed it: it is open again.
        status    = 'open',
        handled_at = null;
end $fn$;

revoke all on function public.log_assistant_escalation(integer, text, text, uuid, uuid) from public;
grant execute on function public.log_assistant_escalation(integer, text, text, uuid, uuid) to service_role;
