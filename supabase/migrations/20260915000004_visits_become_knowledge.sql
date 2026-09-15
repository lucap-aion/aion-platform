-- What the floor says, where the assistant can actually find it.
--
-- store_visits answers questions with a shape: how many did not buy, who is
-- owed a call, what did this client try. It cannot answer the question a head
-- of CRM actually asks out loud — "why are people walking away from the
-- quilted bag?" — because that is not a filter over columns, it is a reading
-- of fourteen conversations.
--
-- The knowledge base already does exactly that, over the brand's own documents.
-- So a CONFIRMED visit is written into it as one small document, embedded like
-- any other, and search_knowledge finds it alongside the house's policies. The
-- shop floor becomes a source the assistant reads, not just a table it counts.
--
-- Only confirmed visits. A draft is one manager's unreviewed dictation, and
-- there is no worse place for an unreviewed sentence than a retrieval index,
-- where it will come back months later with no memory of how it got there.

alter table public.brand_knowledge_docs
  add column if not exists visit_id uuid references public.store_visits(id) on delete cascade;

-- One document per visit: re-confirming a corrected card replaces it rather
-- than adding a second, contradictory account of the same afternoon.
create unique index if not exists brand_knowledge_docs_visit_uniq
  on public.brand_knowledge_docs (visit_id)
  where visit_id is not null;

comment on column public.brand_knowledge_docs.visit_id is
  'Set when this document was written FROM a store visit. Cascades: deleting the visit removes the knowledge it produced, so a note a manager retracts does not survive in the index.';
