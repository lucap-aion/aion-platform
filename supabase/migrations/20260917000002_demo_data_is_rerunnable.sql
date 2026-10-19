-- Running the demo book twice doubled it, or failed outright.
--
-- generate_brand_demo_data contains no DELETE anywhere. It appends: another forty clients,
-- another sixty covers, on top of whatever is already there. Its client emails are
-- `first.last` + i with i restarting at 1 on every run, so the second pass re-draws forty
-- names into the same 1-40 index space and dies the moment one (name, index) pair repeats —
-- about a one-in-ten chance per run. That is what happened on dev on 17 September:
--
--   duplicate key value violates unique constraint "profiles_email_brand_unique"
--
-- The whole RPC is one transaction, so the failure rolled back and cost nothing. The nine
-- times in ten it does NOT collide are the dangerous ones: the book silently doubles, and a
-- demo built for forty clients quietly becomes eighty with two of everything.
--
-- It only ever looked fine because the stage had only ever run on a freshly purged brand.
-- It does not stay that way: requeue_stuck_onboarding_stages puts a stage back in the queue,
-- and the panel has a "Re-run everything" button pointed straight at it.
--
-- Rather than rewrite the generator, clear its output first. This is the purge's own list
-- and order — children before parents — with ONE exception.
create or replace function public.reset_brand_demo_book(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; t text; n integer;
begin
  foreach t in array public.demo_purge_order() loop
    if t = 'profiles' then
      -- The exception: a profile with an auth user behind it is one of the demo LOGINS,
      -- not a generated client. Rebuilding the book must not take the account away — and
      -- SQL cannot delete the auth user that would be left behind, so a login removed here
      -- would survive as an orphan that still authenticates. Only the edge function's
      -- purge_demo may remove those, and it deletes the auth side first.
      delete from public.profiles p
       where p.brand_id = p_brand_id
         and p.user_id is null
         and p.id::text in (select row_pk from public.brand_demo_artifacts
                             where brand_id = p_brand_id and table_name = 'profiles');
      get diagnostics n = row_count;
      -- Drop the tags whose rows have gone, and keep the ones still pointing at a login so
      -- a later hand-over purge can still find them.
      delete from public.brand_demo_artifacts a
       where a.brand_id = p_brand_id and a.table_name = 'profiles'
         and not exists (select 1 from public.profiles p where p.id::text = a.row_pk);
    else
      execute format(
        'delete from public.%I where id::text in (
           select row_pk from public.brand_demo_artifacts
           where brand_id = $1 and table_name = $2)', t)
        using p_brand_id, t;
      get diagnostics n = row_count;
      delete from public.brand_demo_artifacts where brand_id = p_brand_id and table_name = t;
    end if;
    v_out := v_out || jsonb_build_object(t, n);
  end loop;
  return jsonb_build_object('ok', true, 'cleared', v_out);
end;
$$;

comment on function public.reset_brand_demo_book(bigint) is
  'Clears a brand''s generated demo book so demo_data can run again, keeping the demo logins. '
  'Called by the demo_data stage before generate_brand_demo_data, which only appends.';
