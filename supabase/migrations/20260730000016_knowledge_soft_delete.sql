-- Deleting knowledge is recoverable.
--
-- Any brand user could permanently delete an indexed document, cascading to its
-- chunks, with no undo. In practice 9 of 10 brand users carry is_master, so
-- "only admins can delete" is not true of the data even though the policy reads
-- that way.
--
-- The answer is not to argue about who may delete. Most of the harm here is an
-- accident, not malice, and the cost is real: the document has to be found and
-- re-uploaded, and its chunks re-embedded. So a delete now hides the document
-- and stops the assistant using it — immediately and completely — while leaving
-- it recoverable for 30 days.

alter table public.brand_knowledge_docs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists brand_knowledge_docs_live_idx
  on public.brand_knowledge_docs (brand_id) where deleted_at is null;

comment on column public.brand_knowledge_docs.deleted_at is
  'Soft delete. A deleted document is invisible to the platform and to the assistant immediately; purge_deleted_knowledge() removes it for good after 30 days.';

-- Retrieval must honour it, or a "deleted" document keeps answering questions.
-- Preserve the existing signature EXACTLY (chunk_id, not id) — callers select
-- these names, and Postgres refuses to change a function's OUT parameters.
create or replace function public.match_brand_knowledge(
  p_brand_id integer,
  p_query_embedding vector,
  p_match_count integer default 6,
  p_min_similarity double precision default 0.2
) returns table (
  chunk_id uuid, doc_id uuid, doc_title text, source_url text,
  category text, content text, similarity double precision
)
language sql volatile security invoker set search_path = public as $$
  select
    c.id as chunk_id, c.doc_id, d.title, d.source_url, d.category, c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.brand_knowledge_chunks c
  join public.brand_knowledge_docs d on d.id = c.doc_id
  where c.brand_id = p_brand_id
    and d.deleted_at is null
    and c.embedding is not null
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 30));
$$;

create or replace function public.soft_delete_knowledge_doc(p_doc_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_title text;
begin
  -- security invoker: the caller's own RLS decides whether they may touch this
  -- row, exactly as the hard delete did. Nothing here widens access.
  update public.brand_knowledge_docs
     set deleted_at = now(), deleted_by = public.get_my_profile_id()
   where id = p_doc_id and deleted_at is null
   returning title into v_title;

  if v_title is null then
    return jsonb_build_object('ok', false, 'reason', 'not found, or already deleted');
  end if;
  return jsonb_build_object('ok', true, 'title', v_title, 'recoverable_until', (now() + interval '30 days')::date);
end $$;

create or replace function public.restore_knowledge_doc(p_doc_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_title text;
begin
  update public.brand_knowledge_docs
     set deleted_at = null, deleted_by = null
   where id = p_doc_id and deleted_at is not null
   returning title into v_title;

  if v_title is null then
    return jsonb_build_object('ok', false, 'reason', 'not found, or not deleted');
  end if;
  return jsonb_build_object('ok', true, 'title', v_title);
end $$;

-- After 30 days it goes for good, chunks included.
create or replace function public.purge_deleted_knowledge()
returns integer
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.brand_knowledge_docs
     where deleted_at is not null and deleted_at < now() - interval '30 days'
    returning 1
  ) select count(*)::int from gone;
$$;

select cron.schedule('purge-deleted-knowledge', '30 4 * * *', $$select public.purge_deleted_knowledge();$$)
where not exists (select 1 from cron.job where jobname = 'purge-deleted-knowledge');

grant execute on function public.soft_delete_knowledge_doc(uuid) to authenticated;
grant execute on function public.restore_knowledge_doc(uuid) to authenticated;
revoke all on function public.purge_deleted_knowledge() from public, anon, authenticated;
grant execute on function public.purge_deleted_knowledge() to service_role;
