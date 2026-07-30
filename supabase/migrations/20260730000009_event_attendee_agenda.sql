-- The invite list is also a schedule and a contact sheet.
--
-- event_attendees was built for attribution after the fact (who came, who
-- converted, who brought them). A real trunk show agenda carries more: each
-- guest has a slot, a venue and a way to reach them, and one show runs across
-- several venues — the Hamptons 2026 edition is a lunch at the host's house on
-- 29 July plus by-appointment days at a gallery from 30 July to 1 August.
--
-- Without these columns the agenda can only be stored as prose, which puts it
-- back in the knowledge base where it can't be sorted by time or filtered by
-- venue — the two things you actually want the morning of the show.
--
-- customer_ref exists because a brand whose clients live in the knowledge base
-- (Luisa Beccaria) has no profiles row to point customer_id at, but its client
-- cards DO carry a stable CRM id ("Scheda cliente — Audrey Gruss (ID 11143)").
-- Keeping that id turns a name match into a durable link.

alter table public.event_attendees
  add column if not exists email            text,
  add column if not exists phone            text,
  add column if not exists appointment_date date,
  add column if not exists appointment_time time,
  add column if not exists venue            text,
  add column if not exists customer_ref     text,
  add column if not exists notes            text;

comment on column public.event_attendees.customer_ref is
  'CRM id from the brand''s knowledge-base client card, for brands with no profiles row. NULL means this guest is not a known client.';
comment on column public.event_attendees.appointment_time is
  'Booked slot. NULL means expected but unslotted (e.g. an open lunch invitation), NOT absent.';

create index if not exists event_attendees_schedule_idx
  on public.event_attendees (event_id, appointment_date, appointment_time);
