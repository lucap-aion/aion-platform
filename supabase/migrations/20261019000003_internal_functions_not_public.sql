-- Three holes found reviewing dev for the prod promotion, all live on dev.
--
-- 1. Internal SECURITY DEFINER functions anyone could call.
--    Postgres grants EXECUTE to PUBLIC on every new function, and these files only ever
--    revoked it from a few. With the anon key alone — it is in every page's bundle —
--    `rpc/knowledge_functions_headers` returned KNOWLEDGE_BATCH_SECRET, the header that
--    makes a caller "service" to send-email, onboard-brand and promote-brand. The ticks let
--    anyone start a full re-crawl of every brand (real API spend), and reset_brand_demo_book
--    deletes a demo book. These are called by pg_cron (as postgres) or by edge functions
--    with the service key, never by a browser.
--
-- 2. The assistant's SQL runners blocked `set` but not `set_config(`: `\m…\M` treats `_` as
--    part of a word, so `set` never matches inside `set_config`. get_my_brand_id() trusts
--    app.assistant_brand_id once it is set, so a brand user — or, through ai_run_query_user,
--    a customer — could set it to another brand's id inside their own SELECT and read that
--    brand's rows through RLS.
--
-- 3. brand_fee_rates() returned a brand's per-category premiums and fees to any signed-in
--    user. Only compute_business_case (service role) needs it.
--
-- Admin screens that call RPCs while signed in keep `authenticated`; only anon loses them.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'knowledge_functions_headers',
      'knowledge_crawl_tick', 'knowledge_seed_weekly',
      'onboarding_tick', 'storefront_sync_tick', 'storefront_orders_tick',
      'catalogue_image_index_tick', 'catalogue_price_sync_tick',
      'requeue_stuck_crawl_items', 'requeue_stuck_onboarding_stages', 'fail_exhausted_crawl_items',
      'next_onboarding_stage', 'next_onboarding_stages',
      'brand_onboarding_set', 'reset_brand_demo_book', 'pick_demo_client_profile',
      'background_job_health_check', 'background_job_watch',
      'brand_fee_rates',
      'shopify_get_token', 'shopify_set_token', 'shopify_clear_token',
      'log_assistant_escalation'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'commercial_pipeline', 'admin_dashboard_aggregates',
      'compute_tourism_correlations', 'tourism_unmatched_shops'
    ])
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- 2. The runners, unchanged except for set_config and current_setting in the blocklist.
CREATE OR REPLACE FUNCTION public.ai_run_query_scoped(p_sql text, p_brand_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role        text;
  v_real_brand  bigint;
  v_normalised  text;
  v_cols        text[];
  v_rows        jsonb;
  v_count       integer;
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required';
  end if;
  if p_brand_id is null then
    raise exception 'brand scope required';
  end if;

  -- Read the REAL identity BEFORE entering scoped mode.
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('admin', 'brand', 'brand_admin', 'brand_user') then
    raise exception 'forbidden: brand or admin role required';
  end if;
  -- A non-admin can only ever query their OWN brand.
  if v_role <> 'admin' then
    v_real_brand := public.get_my_brand_id();
    if v_real_brand is null or v_real_brand <> p_brand_id then
      raise exception 'forbidden: cannot query another brand';
    end if;
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
  if v_normalised ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|comment|vacuum|reindex|cluster|listen|notify|do|prepare|deallocate|execute|call|set|set_config|current_setting|reset|lock|begin|commit|rollback|savepoint)\M' then
    raise exception 'query contains a forbidden keyword';
  end if;

  -- Enter brand scope: transaction-local, so it evaporates when this RPC's
  -- implicit transaction ends. get_my_role()/get_my_brand_id() honour these,
  -- pinning RLS to p_brand_id even for an admin caller (view-as).
  perform set_config('app.assistant_brand_id', p_brand_id::text, true);
  perform set_config('app.assistant_scope', '1', true);

  set local statement_timeout = '15s';

  execute 'drop table if exists pg_temp.__ai_q_scoped';
  execute format(
    'create temp table __ai_q_scoped on commit drop as (select * from (%s) __src limit 1000)',
    rtrim(p_sql, '; ')
  );

  select array_agg(attname order by attnum)
    into v_cols
    from pg_attribute
    where attrelid = 'pg_temp.__ai_q_scoped'::regclass
      and attnum > 0
      and not attisdropped;

  execute 'select count(*), coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from __ai_q_scoped t'
    into v_count, v_rows;

  execute 'drop table pg_temp.__ai_q_scoped';

  return jsonb_build_object(
    'columns',   to_jsonb(coalesce(v_cols, array[]::text[])),
    'rows',      v_rows,
    'row_count', v_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ai_run_query_user(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if v_normalised ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|comment|vacuum|reindex|cluster|listen|notify|do|prepare|deallocate|execute|call|set|set_config|current_setting|reset|lock|begin|commit|rollback|savepoint)\M' then
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
$function$;

