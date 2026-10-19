-- Add source_url to match_brand_knowledge so the assistant can show clickable,
-- verifiable knowledge sources. Return-type change requires drop + recreate.

drop function if exists public.match_brand_knowledge(integer, vector, integer, double precision);

create or replace function public.match_brand_knowledge(
  p_brand_id        integer,
  p_query_embedding vector(1024),
  p_match_count     integer default 6,
  p_min_similarity  double precision default 0.2
)
returns table (
  chunk_id    uuid,
  doc_id      uuid,
  doc_title   text,
  source_url  text,
  category    text,
  content     text,
  similarity  double precision
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.doc_id,
    d.title,
    d.source_url,
    d.category,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.brand_knowledge_chunks c
  join public.brand_knowledge_docs d on d.id = c.doc_id
  where c.brand_id = p_brand_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 30));
$$;

revoke all on function public.match_brand_knowledge(integer, vector, integer, double precision) from public;
grant execute on function public.match_brand_knowledge(integer, vector, integer, double precision) to authenticated;
