-- Brand-side "Ask the data": adds a per-user read-only SQL runner that
-- respects RLS (so a brand user can only see their own brand's rows) and a
-- per-user chat-history table for the brand AI assistant.

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_run_query_user(p_sql)
-- Same allowlist as ai_run_query, but SECURITY INVOKER. The function runs
-- under the calling role with RLS active, so a brand_admin/brand_user can
-- only retrieve rows their brand RLS policies allow. Admins still see
-- everything via the admin RLS policies.
--
-- Why a separate function: ai_run_query is SECURITY DEFINER and gated on
-- the admins table. Reusing it for brand users would either bypass RLS or
-- require coupling the gate to multiple roles. A second function keeps
-- the security domains clean.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ai_run_query_user(p_sql text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role       text;
  v_normalised text;
  v_cols       text[];
  v_rows       jsonb;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;

  -- Allow admins and brand users. Customers should not call this.
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('admin', 'brand_admin', 'brand_user') then
    raise exception 'forbidden: brand or admin role required';
  end if;

  if p_sql is null or btrim(p_sql) = '' then
    raise exception 'empty query';
  end if;

  v_normalised := lower(regexp_replace(p_sql, '\s+', ' ', 'g'));

  if v_normalised !~ '^\s*(select|with)\s' then
    raise exception 'only SELECT or WITH queries are allowed';
  end if;

  if v_normalised ~ ';\s*\S' then
    raise exception 'multiple statements are not allowed';
  end if;

  if v_normalised ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|comment|vacuum|reindex|cluster|listen|notify|do|prepare|deallocate|execute|call|set|reset|lock|begin|commit|rollback|savepoint)\M' then
    raise exception 'query contains a forbidden keyword';
  end if;

  set local statement_timeout = '15s';

  execute 'drop table if exists pg_temp.__ai_q_user';
  execute format(
    'create temp table __ai_q_user on commit drop as (select * from (%s) __src limit 1000)',
    rtrim(p_sql, '; ')
  );

  select array_agg(attname order by attnum)
    into v_cols
    from pg_attribute
    where attrelid = 'pg_temp.__ai_q_user'::regclass
      and attnum > 0
      and not attisdropped;

  execute 'select count(*), coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from __ai_q_user t'
    into v_count, v_rows;

  execute 'drop table pg_temp.__ai_q_user';

  return jsonb_build_object(
    'columns',   to_jsonb(coalesce(v_cols, array[]::text[])),
    'rows',      v_rows,
    'row_count', v_count
  );
end;
$$;

revoke all on function public.ai_run_query_user(text) from public;
grant execute on function public.ai_run_query_user(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_chats_brand: chat history for the brand-side assistant.
-- Parallel to ai_chats (which is keyed on admin_id) so we don't have to
-- nullable-FK gymnastics or mix two ownership models in one table.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ai_chats_brand (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  user_id     uuid not null,
  title       text not null,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_chats_brand_profile_updated_idx
  on public.ai_chats_brand (profile_id, updated_at desc);

alter table public.ai_chats_brand enable row level security;

grant select, insert, update, delete on public.ai_chats_brand to authenticated;
grant all on public.ai_chats_brand to service_role;

drop policy if exists "ai_chats_brand: owner select" on public.ai_chats_brand;
create policy "ai_chats_brand: owner select"
  on public.ai_chats_brand for select
  using (profile_id = public.get_my_profile_id());

drop policy if exists "ai_chats_brand: owner insert" on public.ai_chats_brand;
create policy "ai_chats_brand: owner insert"
  on public.ai_chats_brand for insert
  with check (profile_id = public.get_my_profile_id());

drop policy if exists "ai_chats_brand: owner update" on public.ai_chats_brand;
create policy "ai_chats_brand: owner update"
  on public.ai_chats_brand for update
  using (profile_id = public.get_my_profile_id())
  with check (profile_id = public.get_my_profile_id());

drop policy if exists "ai_chats_brand: owner delete" on public.ai_chats_brand;
create policy "ai_chats_brand: owner delete"
  on public.ai_chats_brand for delete
  using (profile_id = public.get_my_profile_id());

drop trigger if exists ai_chats_brand_touch_updated_at on public.ai_chats_brand;
create trigger ai_chats_brand_touch_updated_at
  before update on public.ai_chats_brand
  for each row execute function public.touch_ai_chats_updated_at();
