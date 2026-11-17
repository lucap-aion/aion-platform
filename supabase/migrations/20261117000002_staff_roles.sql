-- Staff roles: what each kind of brand user can open and ask.
--
-- Roberto Coin's review (Giulio, 2026-11-09): different users need different access — a store
-- manager should not see sales by category for every store — up to the point of fixing the
-- four or five questions a given kind of user may ask the assistant.
--
-- A role belongs to one brand and says three things:
--   pages            the portal screens it can open ('/dashboard', '/customers', …). The
--                    assistant is not in this list; assistant_mode decides it.
--   assistant_mode   'full'   — ask anything, as every user can today
--                    'preset' — only the brand's approved questions, sent by id; the words
--                               come from this row, never from the browser
--                    'off'    — no assistant at all
--   preset_questions [{ "id": "…", "label": "…", "question": "…" }]. A question may say
--                    {{shop}}, which becomes the asker's own store.
--
-- NULL staff_role_id = no restriction, which is every user today. Masters are never restricted:
-- they are the ones who set roles. So nothing changes for anybody until a master assigns one.

create table if not exists public.brand_staff_roles (
  id               bigserial primary key,
  brand_id         bigint not null references public.brands(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 60),
  pages            text[] not null default '{}',
  assistant_mode   text not null default 'full' check (assistant_mode in ('full', 'preset', 'off')),
  preset_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(preset_questions) = 'array'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, name)
);

alter table public.profiles
  add column if not exists staff_role_id bigint references public.brand_staff_roles(id) on delete restrict;
-- RESTRICT, not SET NULL: a role's members with no role would have full access, and a restriction
-- must never lift as a side effect of tidying up. Reassign them first.
alter table public.profiles drop constraint if exists profiles_staff_role_id_fkey;
alter table public.profiles add constraint profiles_staff_role_id_fkey
  foreign key (staff_role_id) references public.brand_staff_roles(id) on delete restrict;
create index if not exists profiles_staff_role_id_idx on public.profiles(staff_role_id) where staff_role_id is not null;

-- Is the caller a master of this brand? SECURITY DEFINER so a policy or trigger on profiles
-- can ask without recursing through profiles' own RLS.
create or replace function public.am_brand_master(p_brand_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('brand', 'brand_admin', 'brand_user')
      and p.is_master is true
      and p.brand_id = p_brand_id
  );
$$;
revoke all on function public.am_brand_master(bigint) from public, anon;
grant execute on function public.am_brand_master(bigint) to authenticated;

alter table public.brand_staff_roles enable row level security;
grant select, insert, update, delete on public.brand_staff_roles to authenticated;
grant all on public.brand_staff_roles to service_role;
grant usage, select on sequence public.brand_staff_roles_id_seq to authenticated;

-- Everyone on the brand's staff reads the brand's roles: a restricted user's own portal needs
-- its role to know what to show. Only a master writes them. Admins have no profile row, so
-- they get their own policy (see admin_no_profile_row_rls).
drop policy if exists "brand staff: read own brand roles" on public.brand_staff_roles;
create policy "brand staff: read own brand roles" on public.brand_staff_roles for select to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role());

drop policy if exists "brand master: write own brand roles" on public.brand_staff_roles;
create policy "brand master: write own brand roles" on public.brand_staff_roles for all to authenticated
  using (public.am_brand_master(brand_id)) with check (public.am_brand_master(brand_id));

drop policy if exists "admin: all on brand_staff_roles" on public.brand_staff_roles;
create policy "admin: all on brand_staff_roles" on public.brand_staff_roles for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- ── Who may change a staff member's access ─────────────────────────────────────────────────
--
-- "brand: all on own brand profiles" lets ANY brand user write every profile of the brand —
-- which it has to, because staff edit their clients' records. But it also meant a non-master
-- could make themselves master, delete a master, or (now) clear their own role, with one
-- REST call; and an invited user claiming their invitation could set is_master in the same
-- update, since that policy checks only user_id. Roles mean nothing while that is open.
--
-- So access is a master's to change: is_master, staff_role_id, role and brand_id, and adding
-- or removing a staff row. Everyone else can still edit their own details and the brand's
-- clients exactly as before. Service-role callers (edge functions, SQL) have no auth.uid()
-- and pass; so do AION admins.
create or replace function public.guard_staff_access()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  staff text[] := array['brand', 'brand_admin', 'brand_user'];
  target_brand bigint;
begin
  -- A role must be one of the row's own brand's.
  if tg_op <> 'DELETE' and new.staff_role_id is not null and not exists (
    select 1 from public.brand_staff_roles r where r.id = new.staff_role_id and r.brand_id = new.brand_id
  ) then
    raise exception 'that role belongs to another brand' using errcode = '42501';
  end if;

  if caller is null or public.get_my_role() = 'admin' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  target_brand := case when tg_op = 'DELETE' then old.brand_id else new.brand_id end;
  if public.am_brand_master(target_brand)
     and (tg_op = 'INSERT' or public.am_brand_master(old.brand_id)) then
    -- A master may not demote themselves into a corner: the last master of a brand stays one.
    if tg_op = 'UPDATE' and old.user_id = caller and old.is_master is true and new.is_master is not true
       and not exists (select 1 from public.profiles p where p.brand_id = old.brand_id and p.is_master is true
                         and p.role = any(staff) and p.id <> old.id) then
      raise exception 'you are the only master of this brand' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.role = any(staff) or coalesce(new.is_master, false) or new.staff_role_id is not null then
      raise exception 'only a master can add staff' using errcode = '42501';
    end if;
  elsif tg_op = 'DELETE' then
    if old.role = any(staff) then
      raise exception 'only a master can remove staff' using errcode = '42501';
    end if;
  else
    if new.role is distinct from old.role
       or new.brand_id is distinct from old.brand_id
       or new.is_master is distinct from old.is_master
       or new.staff_role_id is distinct from old.staff_role_id then
      raise exception 'only a master can change a staff member''s access' using errcode = '42501';
    end if;
    -- A colleague's row is not theirs to edit; their own is, and so is claiming an invitation.
    if old.role = any(staff) and old.user_id is distinct from caller
       and not (old.user_id is null and new.user_id = caller) then
      raise exception 'only a master can edit a colleague' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_staff_access on public.profiles;
create trigger trg_guard_staff_access
  before insert or update or delete on public.profiles
  for each row execute function public.guard_staff_access();

create or replace function public.touch_brand_staff_roles() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_brand_staff_roles on public.brand_staff_roles;
create trigger trg_touch_brand_staff_roles before update on public.brand_staff_roles
  for each row execute function public.touch_brand_staff_roles();
