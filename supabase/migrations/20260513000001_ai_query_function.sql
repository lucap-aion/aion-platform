-- AI Query: read-only SQL execution for the admin chat assistant.
-- Exposes ai_run_query(p_sql) which an admin can call to execute a single
-- read-only SELECT/CTE query, capped at 1000 rows and 15s. Bypasses RLS via
-- SECURITY DEFINER, but enforces an admin role check inside the function.

create table if not exists public.ai_query_log (
  id          bigserial primary key,
  admin_id    uuid references public.admins(id) on delete set null,
  user_id     uuid,
  question    text,
  sql_text    text,
  row_count   integer,
  duration_ms integer,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_query_log_created_at_idx
  on public.ai_query_log (created_at desc);

alter table public.ai_query_log enable row level security;

drop policy if exists "ai_query_log: admin read" on public.ai_query_log;
create policy "ai_query_log: admin read"
  on public.ai_query_log for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create or replace function public.ai_run_query(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin   boolean;
  v_normalised text;
  v_cols       text[];
  v_rows       jsonb;
  v_count      integer;
begin
  -- caller must be an admin
  select exists (select 1 from public.admins where user_id = auth.uid())
    into v_is_admin;
  if not v_is_admin then
    raise exception 'forbidden: admin role required';
  end if;

  if p_sql is null or btrim(p_sql) = '' then
    raise exception 'empty query';
  end if;

  v_normalised := lower(regexp_replace(p_sql, '\s+', ' ', 'g'));

  -- must start with SELECT or WITH (CTE)
  if v_normalised !~ '^\s*(select|with)\s' then
    raise exception 'only SELECT or WITH queries are allowed';
  end if;

  -- no chained statements: a semicolon may only appear as trailing whitespace
  if v_normalised ~ ';\s*\S' then
    raise exception 'multiple statements are not allowed';
  end if;

  -- crude DDL/DML keyword block (\m..\M = word boundaries)
  if v_normalised ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|comment|vacuum|reindex|cluster|listen|notify|do|prepare|deallocate|execute|call|set|reset|lock|begin|commit|rollback|savepoint)\M' then
    raise exception 'query contains a forbidden keyword';
  end if;

  -- 15s timeout for this call only
  set local statement_timeout = '15s';

  -- materialise into a temp table so we can recover column order and row count
  execute 'drop table if exists pg_temp.__ai_q';
  execute format(
    'create temp table __ai_q on commit drop as (select * from (%s) __src limit 1000)',
    rtrim(p_sql, '; ')
  );

  select array_agg(attname order by attnum)
    into v_cols
    from pg_attribute
    where attrelid = 'pg_temp.__ai_q'::regclass
      and attnum > 0
      and not attisdropped;

  execute 'select count(*), coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from __ai_q t'
    into v_count, v_rows;

  execute 'drop table pg_temp.__ai_q';

  return jsonb_build_object(
    'columns',   to_jsonb(coalesce(v_cols, array[]::text[])),
    'rows',      v_rows,
    'row_count', v_count
  );
end;
$$;

revoke all on function public.ai_run_query(text) from public;
grant execute on function public.ai_run_query(text) to authenticated;
