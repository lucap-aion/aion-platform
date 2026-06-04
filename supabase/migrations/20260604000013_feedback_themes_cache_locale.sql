-- Make the feedback-themes cache locale-aware: the AI summary differs per
-- language, so the cache key must include locale (otherwise the first-generated
-- locale is served to everyone for the 6h TTL). IF EXISTS so it's a no-op where
-- the cache table isn't present.

ALTER TABLE IF EXISTS public.feedback_themes_cache
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

ALTER TABLE IF EXISTS public.feedback_themes_cache
  DROP CONSTRAINT IF EXISTS feedback_themes_cache_brand_id_window_days_key;

ALTER TABLE IF EXISTS public.feedback_themes_cache
  ADD CONSTRAINT feedback_themes_cache_brand_window_locale_key
  UNIQUE (brand_id, window_days, locale);
