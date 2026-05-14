-- Persistent chat history for the admin "Ask the data" page.
-- One row per chat session, owned by an admin; messages live as JSONB.

create table if not exists public.ai_chats (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.admins(id) on delete cascade,
  user_id     uuid not null,
  title       text not null,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_chats_admin_updated_idx
  on public.ai_chats (admin_id, updated_at desc);

alter table public.ai_chats enable row level security;

grant select, insert, update, delete on public.ai_chats to authenticated;
grant all on public.ai_chats to service_role;

drop policy if exists "ai_chats: owner select" on public.ai_chats;
create policy "ai_chats: owner select"
  on public.ai_chats for select
  using (admin_id in (select id from public.admins where user_id = auth.uid()));

drop policy if exists "ai_chats: owner insert" on public.ai_chats;
create policy "ai_chats: owner insert"
  on public.ai_chats for insert
  with check (admin_id in (select id from public.admins where user_id = auth.uid()));

drop policy if exists "ai_chats: owner update" on public.ai_chats;
create policy "ai_chats: owner update"
  on public.ai_chats for update
  using (admin_id in (select id from public.admins where user_id = auth.uid()))
  with check (admin_id in (select id from public.admins where user_id = auth.uid()));

drop policy if exists "ai_chats: owner delete" on public.ai_chats;
create policy "ai_chats: owner delete"
  on public.ai_chats for delete
  using (admin_id in (select id from public.admins where user_id = auth.uid()));

create or replace function public.touch_ai_chats_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_chats_touch_updated_at on public.ai_chats;
create trigger ai_chats_touch_updated_at
  before update on public.ai_chats
  for each row execute function public.touch_ai_chats_updated_at();
