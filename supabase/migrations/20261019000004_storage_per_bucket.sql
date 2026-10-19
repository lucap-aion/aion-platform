-- "allow all" goes. Every bucket gets the access its callers actually need, and nothing else.
--
-- storage.objects carried `"allow all" FOR ALL TO public` — public includes anon, so the
-- anon key in every page's bundle could read, overwrite and delete objects in every bucket it
-- still covered: the pricing and ops decks and data-request workbooks (decks), brands'
-- uploaded contracts and documents (brand-knowledge-uploads), the monthly internal reports,
-- and the daily Chubb policy/claim exports (which policies_daily_reports also opened to every
-- signed-in user, customers included, through four "authenticated users only" policies).
--
-- Who touches storage, measured 2026-10-19:
--   • edge functions — service role, which RLS does not apply to.
--   • the EC2 cron (aion_cronjobs/chubb.py) — one plain upload per daily file, keyed by
--     SUPABASE_SERVICE_ROLE_KEY with a fallback to the anon key. Until the host's env is
--     confirmed to carry the service key, anyone may still INSERT into the two daily-report
--     buckets; reading, replacing and deleting them is admin-only from here.
--   • admin screens — logo/image uploads (brand_logos, brand_media, products_media), Chubb
--     report downloads. Admins have no profiles row; get_my_role() falls back to admins.
--   • brand staff — knowledge uploads and the assistant's one-off attachments, always under
--     <brand_id>/… . The old kb policies named roles 'brand_admin' / 'brand_user', which no
--     real brand user has (they are 'brand' + is_master), so brand uploads only ever worked
--     through "allow all".
-- Public buckets (logos, media, product images) are still read through their public URLs,
-- which RLS does not consult. The PII and visit-audio buckets keep their own policies.

drop policy if exists "storage: admin all" on storage.objects;
create policy "storage: admin all"
  on storage.objects for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- Daily Chubb exports: the cron's upload keeps working whichever key it runs with.
drop policy if exists "Access to authenticated users only 1id06ay_0" on storage.objects;
drop policy if exists "Access to authenticated users only 1id06ay_1" on storage.objects;
drop policy if exists "Access to authenticated users only 1id06ay_2" on storage.objects;
drop policy if exists "Access to authenticated users only 1id06ay_3" on storage.objects;
drop policy if exists "daily reports: upload" on storage.objects;
create policy "daily reports: upload"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id in ('policies_daily_reports', 'claims_daily_reports'));

-- Knowledge uploads: the brand's own staff, inside the brand's own folder. A folder that is
-- not a number belongs to no brand (CASE, because AND does not promise to test it first).
drop policy if exists "kb uploads: brand insert" on storage.objects;
drop policy if exists "kb uploads: brand read" on storage.objects;
drop policy if exists "kb uploads: brand delete" on storage.objects;
drop policy if exists "kb uploads: staff" on storage.objects;
create policy "kb uploads: staff"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'brand-knowledge-uploads'
    and case when (storage.foldername(name))[1] ~ '^[0-9]+$'
             then public.is_brand_staff(((storage.foldername(name))[1])::int)
             else false end
  )
  with check (
    bucket_id = 'brand-knowledge-uploads'
    and case when (storage.foldername(name))[1] ~ '^[0-9]+$'
             then public.is_brand_staff(((storage.foldername(name))[1])::int)
             else false end
  );

drop policy if exists "allow all" on storage.objects;
