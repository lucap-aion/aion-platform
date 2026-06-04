-- Tag rows created while an admin is impersonating a user, so impersonation
-- activity can be excluded from analytics. NULL = real user activity (default).
-- impersonated_by stores the admin's id (public.admins.id).

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

ALTER TABLE public.ai_chats_brand
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

ALTER TABLE public.cover_share_tokens
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.admins(id);

-- query-ai usage log: tag concierge runs an admin made while impersonating.
ALTER TABLE public.ai_query_log
  ADD COLUMN IF NOT EXISTS impersonated_profile_id uuid;
