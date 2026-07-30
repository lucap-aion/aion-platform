-- "What is this document?" — the uploader's own words, kept and indexed.
--
-- A file dropped into the knowledge base arrives with no context: a PDF called
-- "Protocollo_v3_FINAL.pdf" tells the assistant nothing about when to reach for
-- it. The person uploading knows exactly what it is and why it matters, and that
-- sentence is often the single most useful piece of retrieval signal in the
-- whole document — especially for internal material full of names the brand
-- invented, which vector search alone is poor at finding.
--
-- So the description is stored on the document AND prepended to the text before
-- chunking, so it is embedded with the first chunk rather than sitting in a
-- column nothing searches.

alter table public.brand_knowledge_docs
  add column if not exists description text;

comment on column public.brand_knowledge_docs.description is
  'Optional note from whoever uploaded this: what it is and when to use it. Prepended to the content before chunking so it is embedded, not just displayed.';
