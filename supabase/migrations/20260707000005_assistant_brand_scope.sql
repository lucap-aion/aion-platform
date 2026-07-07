-- Fix: the brand assistant's run_sql tool leaked other brands' data when the
-- caller was an ADMIN "viewing-as" a brand (impersonation keeps the admin's JWT
-- and only swaps the client-side profile). run_sql ran through ai_run_query_user
-- (SECURITY INVOKER) under the admin's session, so get_my_role() = 'admin' and
-- the "admin: all on <table>" RLS policies returned EVERY brand's rows. The
-- model writes SQL with no brand filter (the prompt says data is "already scoped
-- to your brand"), so e.g. a Luisa Beccaria chat surfaced Roberto Coin products.
-- Knowledge search was already safe (match_brand_knowledge filters by p_brand_id
-- explicitly); only the free-form SQL path (run_sql + custom report sections)
-- leaked.
--
-- Fix: a brand-scoped SQL runner (ai_run_query_scoped) that pins RLS to a single
-- brand_id for the duration of one query — even for an admin caller — via two
-- transaction-local GUCs the RLS helpers honor. The GUCs are set ONLY inside
-- ai_run_query_scoped, so every other code path (portal writes, other RPCs, the
-- admin platform's own query-ai) is byte-for-byte unchanged.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GUC-aware RLS helpers.
--    app.assistant_scope='1' forces the caller to be treated as a plain brand
--    user (so the "admin: all" bypass policies do NOT fire), and
--    app.assistant_brand_id pins get_my_brand_id() to the scoped brand.
--    Both are unset (→ NULL) on every normal request, so behaviour is identical
--    to before unless ai_run_query_scoped set them in this transaction.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_brand_id()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(current_setting('app.assistant_brand_id', true), '')::bigint,
    (select brand_id from public.profiles where user_id = auth.uid() limit 1)
  )
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when nullif(current_setting('app.assistant_scope', true), '') = '1'
      then 'brand_user'
    else coalesce(
      (select role from public.profiles where user_id = auth.uid() limit 1),
      (select 'admin'::text from public.admins where user_id = auth.uid() limit 1)
    )
  end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Normalise the three brand-read policies that scoped via an inline
--    get_my_profile_id() subquery (which resolves to the CALLER's own brand, i.e.
--    the admin's brand under view-as) to use get_my_brand_id() like every other
--    brand policy. Behaviour-preserving for real brand users and real admins;
--    the only difference is that get_my_brand_id() now honours the scope GUC.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "storefront_products: brand or admin read" on public.storefront_products;
create policy "storefront_products: brand or admin read"
  on public.storefront_products for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = public.get_my_brand_id()
  );

drop policy if exists "brand_knowledge_docs: brand or admin read" on public.brand_knowledge_docs;
create policy "brand_knowledge_docs: brand or admin read"
  on public.brand_knowledge_docs for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = public.get_my_brand_id()
  );

drop policy if exists "brand_knowledge_chunks: brand or admin read" on public.brand_knowledge_chunks;
create policy "brand_knowledge_chunks: brand or admin read"
  on public.brand_knowledge_chunks for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = public.get_my_brand_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ai_run_query_scoped(p_sql, p_brand_id): the run_sql / report-SQL runner.
--    SECURITY INVOKER (so RLS is enforced against the caller), but it first sets
--    the two scope GUCs (transaction-local) so RLS resolves to p_brand_id and the
--    admin bypass policies never fire. An admin may scope to any brand (view-as);
--    a brand user may only scope to their own brand. Same allowlist as
--    ai_run_query_user; capped at 1000 rows / 15s.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ai_run_query_scoped(p_sql text, p_brand_id integer)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
  if v_normalised ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|comment|vacuum|reindex|cluster|listen|notify|do|prepare|deallocate|execute|call|set|reset|lock|begin|commit|rollback|savepoint)\M' then
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
$$;

revoke all on function public.ai_run_query_scoped(text, integer) from public;
grant execute on function public.ai_run_query_scoped(text, integer) to authenticated;
