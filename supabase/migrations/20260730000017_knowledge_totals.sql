create or replace function public.brand_knowledge_totals(p_brand_id bigint)
returns table (docs integer, chunks integer)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*)::int from public.brand_knowledge_docs d
      where d.brand_id = p_brand_id and d.deleted_at is null),
    (select count(*)::int from public.brand_knowledge_chunks c
      join public.brand_knowledge_docs d on d.id = c.doc_id
      where c.brand_id = p_brand_id and d.deleted_at is null);
$$;
grant execute on function public.brand_knowledge_totals(bigint) to authenticated;
