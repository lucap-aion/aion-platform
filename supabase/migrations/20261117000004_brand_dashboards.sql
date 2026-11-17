-- Saved dashboards: a brand's own Insights.
--
-- Kevin (Roberto Coin), via Giulio 2026-11-09: "uno spazio dove registrare dashboard, come se
-- fosse la loro sezione di insight". The assistant already builds reports — KPIs, charts and
-- tables, each a SQL query — and they vanished with the chat. A dashboard keeps the report's
-- SPEC, not its numbers, and re-runs it on open through the same brand-scoped runner, so it
-- is always current and costs no model call.
--
-- Who may do what, and why it is shaped like this:
--   - Saving is for staff who may ask the assistant anything. A spec is SQL; letting a role
--     limited to preset questions save one would let it run whatever it liked.
--   - A dashboard is its owner's until they share it with the brand's staff. A shared
--     dashboard is how a master hands a restricted role a fixed view — the other half of
--     "pre-define what each kind of user can see".
--   - The function runs a dashboard BY ID, read through these policies; it never runs a spec
--     the browser sends.

create or replace function public.am_unrestricted_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    left join public.brand_staff_roles r on r.id = p.staff_role_id
    where p.user_id = auth.uid()
      and p.role in ('brand', 'brand_admin', 'brand_user')
      and (p.is_master is true or p.staff_role_id is null or r.assistant_mode = 'full')
  );
$$;
revoke all on function public.am_unrestricted_staff() from public, anon;
grant execute on function public.am_unrestricted_staff() to authenticated;

create table if not exists public.brand_dashboards (
  id               bigserial primary key,
  brand_id         bigint not null references public.brands(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  title            text not null check (length(trim(title)) between 1 and 200),
  -- generate_report's input: { kind, client?, period?, title?, subtitle?, sections? }
  spec             jsonb not null check (jsonb_typeof(spec) = 'object'),
  shared           boolean not null default false,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists brand_dashboards_brand_idx on public.brand_dashboards (brand_id, position, created_at);

alter table public.brand_dashboards enable row level security;
grant select, insert, update, delete on public.brand_dashboards to authenticated;
grant all on public.brand_dashboards to service_role;
grant usage, select on sequence public.brand_dashboards_id_seq to authenticated;

drop policy if exists "staff: read own or shared dashboards" on public.brand_dashboards;
create policy "staff: read own or shared dashboards" on public.brand_dashboards for select to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role()
         and (owner_profile_id = public.get_my_profile_id() or shared));

drop policy if exists "staff: save own dashboards" on public.brand_dashboards;
create policy "staff: save own dashboards" on public.brand_dashboards for insert to authenticated
  with check (brand_id = public.get_my_brand_id() and public.is_brand_role()
              and owner_profile_id = public.get_my_profile_id() and public.am_unrestricted_staff());

-- The owner edits and removes their own; a master can tidy the brand's (e.g. unshare one).
drop policy if exists "staff: change own dashboards" on public.brand_dashboards;
create policy "staff: change own dashboards" on public.brand_dashboards for update to authenticated
  using (brand_id = public.get_my_brand_id()
         and ((owner_profile_id = public.get_my_profile_id() and public.am_unrestricted_staff())
              or public.am_brand_master(brand_id)))
  with check (brand_id = public.get_my_brand_id());

drop policy if exists "staff: delete own dashboards" on public.brand_dashboards;
create policy "staff: delete own dashboards" on public.brand_dashboards for delete to authenticated
  using (brand_id = public.get_my_brand_id()
         and (owner_profile_id = public.get_my_profile_id() or public.am_brand_master(brand_id)));

drop policy if exists "admin: all on brand_dashboards" on public.brand_dashboards;
create policy "admin: all on brand_dashboards" on public.brand_dashboards for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

drop trigger if exists trg_touch_brand_dashboards on public.brand_dashboards;
create trigger trg_touch_brand_dashboards before update on public.brand_dashboards
  for each row execute function public.touch_brand_staff_roles();
