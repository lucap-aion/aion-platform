-- Retire the locale duplicates already indexed, and un-mangle the titles.
--
-- The crawler accepted any URL on the right hostname, and Pasquale Bruni's
-- Shopify sitemap lists every Middle East market — so the same page was indexed
-- under ar-sa, ar-qa, ar-kw, en-sa and en-qa. 531 documents covering 139 pages:
-- four fifths of the base is the same text repeated, a quarter of it in Arabic,
-- and the assistant retrieves across all five copies while the embedding bill
-- was paid five times. The crawler no longer does this (preferCanonicalLocale);
-- this is the backlog it left behind.
--
-- SOFT delete, not hard: it sets deleted_at, which match_brand_knowledge already
-- respects and the knowledge page can undo for 30 days. If the locale rule turns
-- out to be wrong for some brand, nothing has been lost.

-- ── 1. Titles ────────────────────────────────────────────────────────────────
-- The body was decoded on the way in and the title was not, so 395 of one
-- brand's documents are called "Fall selection &ndash; Pasquale Bruni" — in the
-- list, in the assistant's context, and in the embedded text.
update public.brand_knowledge_docs set title =
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
  replace(replace(title,
    '&ndash;', '–'), '&mdash;', '—'), '&amp;', '&'), '&nbsp;', ' '),
    '&rsquo;', '’'), '&lsquo;', '‘'), '&ldquo;', '“'), '&rdquo;', '”'),
    '&hellip;', '…'), '&quot;', '"'), '&#39;', ''''), '&apos;', '''')
where title ~ '&(ndash|mdash|amp|nbsp|rsquo|lsquo|ldquo|rdquo|hellip|quot|apos|#39);';

-- ── 2. Locale duplicates ─────────────────────────────────────────────────────
-- Same preference order as the crawler: no locale prefix beats English beats
-- anything else, ties on the shortest URL then lexically, so this and the
-- crawler keep the same copy.
with ranked as (
  select id,
         row_number() over (
           partition by brand_id,
                        regexp_replace(source_url, '^(https?://[^/]+)/[a-z]{2}(-[a-z]{2})?(/|$)', '\1/')
           order by
             (source_url ~ '^https?://[^/]+/[a-z]{2}(-[a-z]{2})?(/|$)') asc,
             (source_url !~ '^https?://[^/]+/en(-[a-z]{2})?(/|$)') asc,
             length(source_url) asc,
             source_url asc
         ) as rn
  from public.brand_knowledge_docs
  where deleted_at is null
    and source_url is not null
    and source_url ~ '^https?://[^/]+/[a-z]{2}(-[a-z]{2})?(/|$)'
)
update public.brand_knowledge_docs d
   set deleted_at = now()
  from ranked r
 where d.id = r.id and r.rn > 1;
