-- Make the knowledge search something the database can answer with an index.
--
-- The list searches `title ilike '%term%' or content ilike '%term%'`, and a
-- leading wildcard cannot use a btree index, so both halves were sequential
-- scans. Every search ran twice — once for the page, once for the exact count —
-- across every document the brand owns. Luisa Beccaria has 3,782 documents and
-- 3.6 MB of content, which is survivable today and will not stay that way: the
-- crawler adds to this continuously and nothing about the query gets cheaper.
--
-- pg_trgm indexes trigrams, which is exactly what an unanchored ILIKE needs.
create extension if not exists pg_trgm;

create index if not exists brand_knowledge_docs_title_trgm
  on public.brand_knowledge_docs using gin (title gin_trgm_ops);

create index if not exists brand_knowledge_docs_content_trgm
  on public.brand_knowledge_docs using gin (content gin_trgm_ops);

-- The list is always brand-scoped, filtered to live rows and ordered by
-- updated_at. brand_knowledge_docs_brand_idx covers (brand_id, updated_at) but
-- not the deleted_at predicate, so every page still read soft-deleted rows and
-- discarded them. Partial, so it only indexes what the list can ever return.
create index if not exists brand_knowledge_docs_live_recent
  on public.brand_knowledge_docs (brand_id, updated_at desc)
  where deleted_at is null;

-- The category and source filters sit alongside the same brand scope.
create index if not exists brand_knowledge_docs_facets
  on public.brand_knowledge_docs (brand_id, category, source_type)
  where deleted_at is null;

analyze public.brand_knowledge_docs;
