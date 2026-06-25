-- Let AION admins manage brand assistant chats (incl. while viewing-as a brand
-- user). Without this, the owner-only policies on ai_chats_brand reject an
-- admin's writes during impersonation (the JWT is the admin's, so
-- get_my_profile_id() doesn't match the impersonated brand user's profile_id),
-- and assistant conversations silently fail to persist.
--
-- Permissive policy: admins may do anything; the existing owner policies still
-- let each brand user see/manage their own chats.

drop policy if exists "ai_chats_brand: admin all" on public.ai_chats_brand;
create policy "ai_chats_brand: admin all"
  on public.ai_chats_brand for all
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
