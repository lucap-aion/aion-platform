-- Customer concierge needs SQL access too. ai_run_query_user previously
-- gated on admin/brand_* roles only; this extends the allowlist to the
-- customer role(s). RLS is unchanged and remains the authoritative scope —
-- a customer running SELECT * FROM policies still only sees their own rows
-- via the existing "Customers can view own policies" policy.

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
  -- profiles.role can legitimately be NULL for end customers (older rows
  -- never had it set); 'customer' is the explicit modern value.
  if v_role is not null
    and v_role not in ('admin', 'brand', 'brand_admin', 'brand_user', 'customer')
  then
    raise exception 'forbidden: unrecognised role';
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
