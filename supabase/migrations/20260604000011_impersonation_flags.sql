-- Tag rows created while an admin is impersonating a user, so impersonation
-- activity can be excluded from analytics. NULL = real user activity (default).
-- impersonated_by stores the admin's id (public.admins.id).
--
-- Prod scope: only the core tables that exist in prod (feedback, claims). The
-- wave tables (wishlist_items, ai_chats_brand, cover_share_tokens) are not part
-- of this release, so they're intentionally omitted here.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);
