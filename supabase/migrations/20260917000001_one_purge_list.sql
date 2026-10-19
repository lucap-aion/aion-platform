-- The purge preview and the purge itself were reading different lists.
--
-- demo_purge_order() is what preview_brand_demo_purge() loops over to tell an admin what a
-- hand-over would take out. purge_brand_demo_data() never called it: it carried its own
-- literal array, and the two drifted in both directions.
--
--   in the purge, missing from the preview:  store_visits
--   in the preview, missing from the purge:  event_attendees
--
-- Both halves cost something real. Prada's demo held eighty shop visits — the feature the
-- whole pitch was built on — and Preview listed shops, covers, claims and clients without
-- one word about them; the purge then deleted all eighty. Nobody reading that screen could
-- have known. In the other direction, ninety event_attendees rows were tagged as demo
-- artifacts and never deleted by table: they went only if the cascade from events happened
-- to reach them, and their rows in brand_demo_artifacts were never cleaned up either,
-- because the loop only clears tags for tables it visits.
--
-- So: one list, and the purge reads it. A table added to the demo from now on is declared
-- in exactly one place and both sides of the hand-over see it.
--
-- Order is still children before parents, and it is load-bearing:
--   store_visits    before profiles and shops (it points at both)
--   claims          before policies
--   event_attendees before events
create or replace function public.demo_purge_order()
returns text[] language sql immutable as $$
  select array['store_visits', 'feedback', 'claims', 'policies', 'event_attendees', 'events',
               'catalogues', 'profiles', 'shops'];
$$;

comment on function public.demo_purge_order() is
  'The one list of tables a demo purge removes, children first. Both preview_brand_demo_purge '
  'and purge_brand_demo_data read it — do not inline a copy.';

-- Same body as before, with the literal array replaced by the shared list.
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
    v_out := v_out || jsonb_build_object(t, n);
    delete from public.brand_demo_artifacts where brand_id = p_brand_id and table_name = t;
  end loop;
  return jsonb_build_object('ok', true, 'deleted', v_out);
end;
$$;
