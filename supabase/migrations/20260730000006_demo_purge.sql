-- Taking the demo back out: remove what we invented, keep what is really theirs.
--
-- After a demo converts, the brand's account has to become the brand's account.
-- What we fabricated (clients, covers, boutiques, claims, feedback, logins) must
-- go; what we harvested from the brand itself (the indexed site, the news, the
-- product catalogue, the brand record, its theme and fees) must stay — that work
-- took a crawl and is the whole point of the platform.
--
-- Three things here:
--   preview_brand_demo_purge()  — what WOULD be deleted and what would be kept,
--                                 so the admin can see the blast radius first.
--   adopt_legacy_demo_rows()    — earlier hand-seeded example rows (the trunk
--                                 shows tagged "Example seed data") predate the
--                                 artifact log, so they'd survive a purge and
--                                 quietly become "the brand's data". Tag them.
--   purge_brand_demo_data()     — now also clears events/attendees, and reports
--                                 what it kept alongside what it removed.
--
-- Auth logins are NOT deleted here; SQL can't safely remove auth users. The
-- onboard-brand function deletes them first and then calls this — see the
-- purge_demo action there.

-- Rows this house never wrote itself. Order matters: children before parents.
create or replace function public.demo_purge_order()
returns text[] language sql immutable as $$
  select array['feedback', 'claims', 'policies', 'event_attendees', 'events',
               'catalogues', 'profiles', 'shops'];
$$;

-- Older seeded example data predates brand_demo_artifacts. Recognise it by the
-- marker it was inserted with, and log it so a purge can reach it.
create or replace function public.adopt_legacy_demo_rows(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_events integer := 0; v_att integer := 0;
begin
  with seeded as (
    select id from public.events
    where brand_id = p_brand_id and coalesce(notes, '') ilike '%example seed data%'
  ), logged as (
    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk)
    select p_brand_id, 'events', s.id::text from seeded s
    where not exists (
      select 1 from public.brand_demo_artifacts a
      where a.brand_id = p_brand_id and a.table_name = 'events' and a.row_pk = s.id::text)
    returning 1
  ) select count(*) into v_events from logged;

  with att as (
    select ea.id from public.event_attendees ea
    join public.brand_demo_artifacts a
      on a.brand_id = p_brand_id and a.table_name = 'events' and a.row_pk = ea.event_id::text
    where ea.brand_id = p_brand_id
  ), logged as (
    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk)
    select p_brand_id, 'event_attendees', t.id::text from att t
    where not exists (
      select 1 from public.brand_demo_artifacts a2
      where a2.brand_id = p_brand_id and a2.table_name = 'event_attendees' and a2.row_pk = t.id::text)
    returning 1
  ) select count(*) into v_att from logged;

  return jsonb_build_object('events', v_events, 'event_attendees', v_att);
end;
$$;

-- Dry run: exactly what a purge would remove, and what it would leave behind.
create or replace function public.preview_brand_demo_purge(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_remove jsonb := '{}'::jsonb;
  v_logins jsonb;
  t text; n integer;
begin
  foreach t in array public.demo_purge_order() loop
    execute format(
      'select count(*)::int from public.%I where id::text in (
         select row_pk from public.brand_demo_artifacts where brand_id = $1 and table_name = $2)', t)
      into n using p_brand_id, t;
    if n > 0 then v_remove := v_remove || jsonb_build_object(t, n); end if;
  end loop;

  -- Demo logins are profiles with an auth user behind them; the caller deletes
  -- those auth users, so surface them separately.
  select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'role', coalesce(p.role, 'customer'))), '[]'::jsonb)
    into v_logins
  from public.profiles p
  join public.brand_demo_artifacts a
    on a.brand_id = p_brand_id and a.table_name = 'profiles' and a.row_pk = p.id::text
  where p.user_id is not null;

  return jsonb_build_object(
    'brand_id', p_brand_id,
    'will_remove', v_remove,
    'will_remove_logins', v_logins,
    'will_keep', jsonb_build_object(
      'brand_record', 1,
      'knowledge_docs',   (select count(*)::int from public.brand_knowledge_docs   where brand_id = p_brand_id),
      'knowledge_chunks', (select count(*)::int from public.brand_knowledge_chunks where brand_id = p_brand_id),
      'knowledge_sources',(select count(*)::int from public.knowledge_sources      where brand_id = p_brand_id),
      'catalogue_products',(select count(*)::int from public.storefront_products   where brand_id = p_brand_id),
      'real_customers',   (select count(*)::int from public.profiles p
                            where p.brand_id = p_brand_id and (p.role is null or p.role = 'customer')
                              and not exists (select 1 from public.brand_demo_artifacts a
                                              where a.brand_id = p_brand_id and a.table_name = 'profiles'
                                                and a.row_pk = p.id::text)),
      'real_policies',    (select count(*)::int from public.policies po
                            where po.brand_id = p_brand_id
                              and not exists (select 1 from public.brand_demo_artifacts a
                                              where a.brand_id = p_brand_id and a.table_name = 'policies'
                                                and a.row_pk = po.id::text))));
end;
$$;

create or replace function public.purge_brand_demo_data(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; t text; n integer;
begin
  foreach t in array public.demo_purge_order() loop
    execute format(
      'delete from public.%I where id::text in (
         select row_pk from public.brand_demo_artifacts
         where brand_id = $1 and table_name = $2)', t)
      using p_brand_id, t;
    get diagnostics n = row_count;
    if n > 0 then v_out := v_out || jsonb_build_object(t, n); end if;
    delete from public.brand_demo_artifacts where brand_id = p_brand_id and table_name = t;
  end loop;

  return jsonb_build_object('ok', true, 'deleted', v_out,
    'kept', jsonb_build_object(
      'knowledge_chunks',   (select count(*)::int from public.brand_knowledge_chunks where brand_id = p_brand_id),
      'catalogue_products', (select count(*)::int from public.storefront_products    where brand_id = p_brand_id),
      'real_customers',     (select count(*)::int from public.profiles
                              where brand_id = p_brand_id and (role is null or role = 'customer')),
      'real_policies',      (select count(*)::int from public.policies where brand_id = p_brand_id)));
end;
$$;

revoke all on function public.preview_brand_demo_purge(bigint) from public, anon, authenticated;
revoke all on function public.adopt_legacy_demo_rows(bigint)   from public, anon, authenticated;
grant execute on function public.preview_brand_demo_purge(bigint) to service_role;
grant execute on function public.adopt_legacy_demo_rows(bigint)   to service_role;
