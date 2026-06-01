-- Follow-up to 20260528000002: the brand role check missed 'brand'.
-- profiles.role can be any of 'brand' | 'brand_admin' | 'brand_user' for a
-- brand-side user (see isBrandRole in src/contexts/AuthContext.tsx and the
-- schema doc in the query-ai edge function). Without 'brand' here, the
-- first brand owner role (often just 'brand') gets rejected with
-- "forbidden: brand or admin role required" even though the rest of the
-- system treats them as a brand user.

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

  v_role := public.get_my_role();
  if v_role is null or v_role not in ('admin', 'brand', 'brand_admin', 'brand_user') then
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
