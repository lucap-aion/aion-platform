-- Optional weekly schedule for the tourism-ingest Edge Function.
-- DISABLED BY DEFAULT — run the function manually from the AdminInsights
-- Tourism tab first to confirm ISTAT returns data. To enable, set the two
-- settings below and uncomment the cron.schedule() call.
--
-- Required GUCs (run once as postgres):
--   alter database postgres set "app.functions_base_url"
--     = 'https://<project-ref>.supabase.co/functions/v1';
--   alter database postgres set "app.service_role_key"
--     = '<service-role-jwt>';

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Idempotent: drop any prior schedule with the same name before re-creating.
do $$
begin
  perform 1 from cron.job where jobname = 'tourism-ingest-weekly';
  if found then
    perform cron.unschedule('tourism-ingest-weekly');
  end if;
exception when undefined_table then
  null; -- pg_cron not yet installed in this DB
end $$;

-- Uncomment after the manual run validates the pipeline:
--
-- select cron.schedule(
--   'tourism-ingest-weekly',
--   '15 4 * * 1',  -- every Monday 04:15 UTC
--   $cron$
--     select net.http_post(
--       url     := current_setting('app.functions_base_url') || '/tourism-ingest',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type',  'application/json'
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
