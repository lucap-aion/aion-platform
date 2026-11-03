-- Team discussions: internal collaboration for a house's staff.
--
-- Asked for by Lucrezia (Luisa Beccaria, 2026-11-03): "poter mandare mail
-- interne nel team direttamente dalla piattaforma". What she wanted to pass on
-- was an assistant answer; what the team then needs is somewhere to talk about
-- it. So: threads (optionally opened from an assistant answer, which travels
-- with the thread as a snapshot), messages with @mentions of colleagues, free
-- tags on a thread, followers, and notifications that show in the app and go
-- out by email.
--
-- Who is in: STAFF of the house — profiles.role in brand / brand_admin /
-- brand_user with that brand_id. profiles also holds the house's CLIENTS
-- (role customer, same brand_id), so brand_id alone would let a client read
-- the staff room. AION admins have no profiles row (get_my_profile_id() is
-- NULL for them), so every policy carries the get_my_role() = 'admin'
-- companion, or view-as would silently see nothing.

-- ── Who counts as staff ──────────────────────────────────────────────────────
create or replace function public.is_brand_staff(p_brand_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_brand_id is not null
     and public.get_my_brand_id() = p_brand_id
     and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.team_threads (
  id               uuid primary key default gen_random_uuid(),
  brand_id         bigint not null references public.brands(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  created_by       uuid references public.profiles(id) on delete set null,
  status           text not null default 'open' check (status in ('open', 'closed')),
  tags             text[] not null default '{}',
  -- Where the thread started, when it started somewhere: an assistant answer
  -- (chat_id + the question and answer as they were), or nothing.
  context_type     text check (context_type in ('assistant_answer')),
  context_chat_id  uuid,
  context          jsonb,
  message_count    integer not null default 0,
  last_activity_at timestamptz not null default now(),
  impersonated_by  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists team_threads_brand_activity on public.team_threads (brand_id, last_activity_at desc);
create index if not exists team_threads_tags on public.team_threads using gin (tags);

create table if not exists public.team_messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.team_threads(id) on delete cascade,
  brand_id          bigint not null references public.brands(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  body              text not null check (char_length(btrim(body)) between 1 and 8000),
  mentions          uuid[] not null default '{}',
  impersonated_by   uuid,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz
);
create index if not exists team_messages_thread on public.team_messages (thread_id, created_at);

create table if not exists public.team_thread_followers (
  thread_id  uuid not null references public.team_threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  brand_id   bigint not null references public.brands(id) on delete cascade,
  muted      boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (thread_id, profile_id)
);

create table if not exists public.team_notifications (
  id               uuid primary key default gen_random_uuid(),
  brand_id         bigint not null references public.brands(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  thread_id        uuid not null references public.team_threads(id) on delete cascade,
  message_id       uuid references public.team_messages(id) on delete cascade,
  kind             text not null check (kind in ('mention', 'reply')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  read_at          timestamptz,
  emailed_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (message_id, profile_id)
);
create index if not exists team_notifications_inbox on public.team_notifications (profile_id, read_at, created_at desc);

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- A thread: its brand is the caller's own (an admin names it), its creator is
-- the caller (an admin viewing as someone names that profile, and is recorded),
-- and the creator follows it.
create or replace function public.team_thread_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_my_role() = 'admin' then
    new.impersonated_by := auth.uid();
    if new.created_by is not null and not exists (
      select 1 from public.profiles p where p.id = new.created_by and p.brand_id = new.brand_id
        and p.role in ('brand', 'brand_admin', 'brand_user')) then
      raise exception 'created_by is not staff of this brand';
    end if;
  else
    new.created_by := public.get_my_profile_id();
    new.impersonated_by := null;
  end if;
  new.tags := coalesce((select array_agg(distinct lower(btrim(t))) from unnest(new.tags) t
                        where btrim(t) <> '' and char_length(btrim(t)) <= 40), '{}');
  new.message_count := 0;
  new.last_activity_at := now();
  return new;
end $$;

create or replace function public.team_thread_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.team_thread_followers (thread_id, profile_id, brand_id)
    values (new.id, new.created_by, new.brand_id) on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.team_thread_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only the conversation's own fields move; where it lives and who opened it don't.
  new.brand_id := old.brand_id;
  new.created_by := old.created_by;
  new.context_type := old.context_type;
  new.context_chat_id := old.context_chat_id;
  new.context := old.context;
  new.created_at := old.created_at;
  new.tags := coalesce((select array_agg(distinct lower(btrim(t))) from unnest(new.tags) t
                        where btrim(t) <> '' and char_length(btrim(t)) <= 40), '{}');
  new.updated_at := now();
  return new;
end $$;

-- A message: its brand comes from its thread, its author is the caller, and
-- only colleagues of that house can be mentioned — anything else in the list
-- is dropped, never notified.
create or replace function public.team_message_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand bigint;
begin
  select brand_id into v_brand from public.team_threads where id = new.thread_id;
  if v_brand is null then raise exception 'no such thread'; end if;
  new.brand_id := v_brand;

  if public.get_my_role() = 'admin' then
    new.impersonated_by := auth.uid();
    if new.author_profile_id is not null and not exists (
      select 1 from public.profiles p where p.id = new.author_profile_id and p.brand_id = v_brand
        and p.role in ('brand', 'brand_admin', 'brand_user')) then
      raise exception 'author is not staff of this brand';
    end if;
  else
    new.author_profile_id := public.get_my_profile_id();
    new.impersonated_by := null;
  end if;

  new.mentions := coalesce((
    select array_agg(distinct p.id)
    from public.profiles p
    where p.id = any(new.mentions)
      and p.brand_id = v_brand
      and p.role in ('brand', 'brand_admin', 'brand_user')
      and p.id is distinct from new.author_profile_id
  ), '{}');
  new.created_at := now();
  new.edited_at := null;
  return new;
end $$;

create or replace function public.team_message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mentioned colleagues: a mention notification each.
  insert into public.team_notifications (brand_id, profile_id, thread_id, message_id, kind, actor_profile_id)
  select new.brand_id, m, new.thread_id, new.id, 'mention', new.author_profile_id
  from unnest(new.mentions) m
  on conflict do nothing;

  -- Everyone else following the thread, unless they muted it: a reply.
  insert into public.team_notifications (brand_id, profile_id, thread_id, message_id, kind, actor_profile_id)
  select new.brand_id, f.profile_id, new.thread_id, new.id, 'reply', new.author_profile_id
  from public.team_thread_followers f
  where f.thread_id = new.thread_id
    and not f.muted
    and f.profile_id is distinct from new.author_profile_id
    and not (f.profile_id = any(new.mentions))
  on conflict do nothing;

  -- Whoever writes or is mentioned follows from now on (a mute stays a mute).
  insert into public.team_thread_followers (thread_id, profile_id, brand_id)
  select new.thread_id, x, new.brand_id
  from unnest(array_remove(array_append(new.mentions, new.author_profile_id), null)) x
  on conflict do nothing;

  update public.team_threads
     set message_count = message_count + 1, last_activity_at = new.created_at, updated_at = now()
   where id = new.thread_id;
  return new;
end $$;

create or replace function public.team_message_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An edit changes the words, nothing else — in particular not who was
  -- mentioned, which already went out.
  new.thread_id := old.thread_id;
  new.brand_id := old.brand_id;
  new.author_profile_id := old.author_profile_id;
  new.mentions := old.mentions;
  new.created_at := old.created_at;
  new.impersonated_by := old.impersonated_by;
  new.edited_at := now();
  return new;
end $$;

drop trigger if exists team_thread_before_insert on public.team_threads;
create trigger team_thread_before_insert before insert on public.team_threads
  for each row execute function public.team_thread_before_insert();
drop trigger if exists team_thread_after_insert on public.team_threads;
create trigger team_thread_after_insert after insert on public.team_threads
  for each row execute function public.team_thread_after_insert();
drop trigger if exists team_thread_before_update on public.team_threads;
create trigger team_thread_before_update before update on public.team_threads
  for each row execute function public.team_thread_before_update();
drop trigger if exists team_message_before_insert on public.team_messages;
create trigger team_message_before_insert before insert on public.team_messages
  for each row execute function public.team_message_before_insert();
drop trigger if exists team_message_after_insert on public.team_messages;
create trigger team_message_after_insert after insert on public.team_messages
  for each row execute function public.team_message_after_insert();
drop trigger if exists team_message_before_update on public.team_messages;
create trigger team_message_before_update before update on public.team_messages
  for each row execute function public.team_message_before_update();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.team_threads enable row level security;
alter table public.team_messages enable row level security;
alter table public.team_thread_followers enable row level security;
alter table public.team_notifications enable row level security;

drop policy if exists "team_threads: staff read" on public.team_threads;
create policy "team_threads: staff read" on public.team_threads for select to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));
drop policy if exists "team_threads: staff create" on public.team_threads;
create policy "team_threads: staff create" on public.team_threads for insert to authenticated
  with check (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));
drop policy if exists "team_threads: staff update" on public.team_threads;
create policy "team_threads: staff update" on public.team_threads for update to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id))
  with check (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));
-- Deleting a conversation removes everyone's messages: its creator, a master, or AION.
drop policy if exists "team_threads: creator or master delete" on public.team_threads;
create policy "team_threads: creator or master delete" on public.team_threads for delete to authenticated
  using (public.get_my_role() = 'admin' or (public.is_brand_staff(brand_id) and (
    created_by = public.get_my_profile_id()
    or exists (select 1 from public.profiles p where p.id = public.get_my_profile_id() and p.is_master))));

drop policy if exists "team_messages: staff read" on public.team_messages;
create policy "team_messages: staff read" on public.team_messages for select to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));
drop policy if exists "team_messages: staff write" on public.team_messages;
create policy "team_messages: staff write" on public.team_messages for insert to authenticated
  with check (public.get_my_role() = 'admin' or exists (
    select 1 from public.team_threads t where t.id = thread_id and public.is_brand_staff(t.brand_id)));
drop policy if exists "team_messages: author edit" on public.team_messages;
create policy "team_messages: author edit" on public.team_messages for update to authenticated
  using (public.get_my_role() = 'admin' or author_profile_id = public.get_my_profile_id())
  with check (public.get_my_role() = 'admin' or author_profile_id = public.get_my_profile_id());
drop policy if exists "team_messages: author delete" on public.team_messages;
create policy "team_messages: author delete" on public.team_messages for delete to authenticated
  using (public.get_my_role() = 'admin' or author_profile_id = public.get_my_profile_id());

drop policy if exists "team_followers: staff read" on public.team_thread_followers;
create policy "team_followers: staff read" on public.team_thread_followers for select to authenticated
  using (public.get_my_role() = 'admin' or public.is_brand_staff(brand_id));
drop policy if exists "team_followers: own row" on public.team_thread_followers;
create policy "team_followers: own row" on public.team_thread_followers for all to authenticated
  using (public.get_my_role() = 'admin' or profile_id = public.get_my_profile_id())
  with check (public.get_my_role() = 'admin' or (profile_id = public.get_my_profile_id() and public.is_brand_staff(brand_id)));

-- Notifications are written by the message trigger only; a person reads and
-- marks their own.
drop policy if exists "team_notifications: own read" on public.team_notifications;
create policy "team_notifications: own read" on public.team_notifications for select to authenticated
  using (public.get_my_role() = 'admin' or profile_id = public.get_my_profile_id());
drop policy if exists "team_notifications: own mark read" on public.team_notifications;
create policy "team_notifications: own mark read" on public.team_notifications for update to authenticated
  using (public.get_my_role() = 'admin' or profile_id = public.get_my_profile_id())
  with check (public.get_my_role() = 'admin' or profile_id = public.get_my_profile_id());

revoke all on public.team_threads, public.team_messages, public.team_thread_followers, public.team_notifications from anon;
grant select, insert, update, delete on public.team_threads, public.team_messages, public.team_thread_followers to authenticated;
grant select on public.team_notifications to authenticated;
grant update (read_at) on public.team_notifications to authenticated;
grant all on public.team_threads, public.team_messages, public.team_thread_followers, public.team_notifications to service_role;
