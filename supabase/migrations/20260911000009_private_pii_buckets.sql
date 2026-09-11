-- Claim photographs, customer faces and receipts stop being public (audit item 3).
--
-- claims_media, profile_pictures and purchase_receipts were public buckets, and
-- the database stored the full public URL of every file. A URL that leaks once
-- works for ever, for anyone, with no session — a claim photograph forwarded in
-- an email stays readable by whoever receives it.
--
-- Worse, and not in the audit: storage.objects carries a policy called
-- "allow all", FOR ALL, TO public, USING (true). `public` includes `anon`, so
-- the anon key that ships in the JavaScript bundle could read, overwrite and
-- DELETE any object in any bucket — every brand logo, every claim photo. Making
-- the buckets private without touching that would have changed nothing: the
-- request would simply have gone through the authenticated endpoint instead.
--
-- So: the three buckets go private, "allow all" stops covering them (every
-- other bucket keeps exactly the behaviour it has today), and access to them is
-- decided per object.
--
-- The client half shipped first (4e694bb) and is live on dev — it signs reads
-- and stores paths, and understands the legacy URLs still in the database. In
-- the other order every avatar and claim photo in the app 404s at once.

-- ── 1. The buckets ───────────────────────────────────────────────────────────
update storage.buckets set public = false
 where id in ('claims_media', 'profile_pictures', 'purchase_receipts');

-- ── 2. Stop the blanket policy covering them ─────────────────────────────────
-- Deliberately narrow: this keeps brand_logos, brand_media, products_media,
-- decks, the report buckets and the knowledge uploads behaving exactly as they
-- do now. Tightening those is a separate decision with its own blast radius.
drop policy if exists "allow all" on storage.objects;
create policy "allow all"
  on storage.objects for all to public
  using (bucket_id not in ('claims_media', 'profile_pictures', 'purchase_receipts'))
  with check (bucket_id not in ('claims_media', 'profile_pictures', 'purchase_receipts'));

-- ── 3. Claim media ───────────────────────────────────────────────────────────
-- Writes are keyed on the first path segment, which is the owning client's
-- profile id: a client writes into their own folder, brand staff into a folder
-- belonging to one of their clients, an admin anywhere.
--
-- Reads add one more route, and it is the one that matters for history: 20 of
-- the 27 files here predate the folder convention and sit at the bucket root
-- with no owner in their path. Rather than move them and rewrite the rows that
-- point at them, a file is readable if it is referenced by a claim the caller
-- can already see. RLS on `claims` applies inside that subquery, so it grants
-- exactly the same people who can open the claim itself — the client, their
-- brand, and us — and nobody else.
drop policy if exists "claims_media: read" on storage.objects;
create policy "claims_media: read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'claims_media' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
      or (storage.foldername(name))[1] in (
        select p.id::text from public.profiles p where p.brand_id = public.get_my_brand_id()
      )
      or exists (
        select 1 from public.claims c
        where c.media is not null and array_to_string(c.media, '|') like '%' || storage.objects.name || '%'
      )
    )
  );

drop policy if exists "claims_media: write" on storage.objects;
create policy "claims_media: write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'claims_media' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
      or (storage.foldername(name))[1] in (
        select p.id::text from public.profiles p where p.brand_id = public.get_my_brand_id()
      )
    )
  );

-- Replacing or removing a claim photograph is ours alone. A client attaches
-- evidence; they do not get to withdraw it once a claim is being assessed.
drop policy if exists "claims_media: admin change" on storage.objects;
create policy "claims_media: admin change"
  on storage.objects for update to authenticated
  using (bucket_id = 'claims_media' and public.get_my_role() = 'admin')
  with check (bucket_id = 'claims_media' and public.get_my_role() = 'admin');

drop policy if exists "claims_media: admin delete" on storage.objects;
create policy "claims_media: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'claims_media' and public.get_my_role() = 'admin');

-- ── 4. Faces ─────────────────────────────────────────────────────────────────
-- Same shape. The legacy route here is the profiles row itself: an avatar at
-- the bucket root is readable by whoever can already read the profile pointing
-- at it, which RLS on `profiles` decides.
drop policy if exists "profile_pictures: read" on storage.objects;
create policy "profile_pictures: read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile_pictures' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
      or (storage.foldername(name))[1] in (
        select p.id::text from public.profiles p where p.brand_id = public.get_my_brand_id()
      )
      or exists (
        select 1 from public.profiles p
        where p.avatar is not null and p.avatar like '%' || storage.objects.name
      )
    )
  );

-- Your own face, or an admin's (admins upload to an `admins/` folder because
-- they have no profiles row — see the RLS note in 20260911000002).
drop policy if exists "profile_pictures: write" on storage.objects;
create policy "profile_pictures: write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile_pictures' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
    )
  );

drop policy if exists "profile_pictures: replace" on storage.objects;
create policy "profile_pictures: replace"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile_pictures' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
    )
  )
  with check (
    bucket_id = 'profile_pictures' and (
      public.get_my_role() = 'admin'
      or (storage.foldername(name))[1] = public.get_my_profile_id()::text
    )
  );

drop policy if exists "profile_pictures: admin delete" on storage.objects;
create policy "profile_pictures: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile_pictures' and public.get_my_role() = 'admin');

-- ── 5. Receipts ──────────────────────────────────────────────────────────────
-- Nothing in the client reads or writes this bucket — policies.purchase_receipt
-- holds a reference number, not a URL (0 of 653 rows point at storage). It gets
-- no policy beyond admin, which also means nothing to break.
drop policy if exists "purchase_receipts: admin only" on storage.objects;
create policy "purchase_receipts: admin only"
  on storage.objects for all to authenticated
  using (bucket_id = 'purchase_receipts' and public.get_my_role() = 'admin')
  with check (bucket_id = 'purchase_receipts' and public.get_my_role() = 'admin');
