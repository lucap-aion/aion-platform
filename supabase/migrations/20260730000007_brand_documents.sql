-- Brand documents: the paperwork a new brand needs, written in that brand's voice.
--
-- Every brand that goes live needs the same set of documents — a customer FAQ, a
-- one-page pitch for the sales floor, a summary of what the cover actually does,
-- the activation email, and a commercial proposal for the brand itself. Today
-- exactly one brand has them: Roberto Coin, hand-written, 17 FAQ entries in two
-- languages. Pomellato and Luisa Beccaria have none, so their FAQ page is empty
-- and their associates have nothing to hold.
--
-- These are drafts for a human to approve, not published copy: status starts at
-- 'draft', and the FAQ only lands on brands.faq_en / faq_it when someone
-- approves it. Each row keeps the sources it was written from, so a claim in a
-- document can be traced back to the brand's own indexed material.

create table if not exists public.brand_documents (
  id           bigserial primary key,
  brand_id     bigint not null references public.brands(id) on delete cascade,
  -- faq | associate_onepager | cover_summary | welcome_email | partnership_proposal
  kind         text not null,
  locale       text not null default 'en' check (locale in ('en', 'it')),
  title        text not null,
  body_md      text not null,
  -- FAQ carries a structured payload as well, in the shape the FAQ page renders.
  body_json    jsonb,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  model        text,
  sources      jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid,
  unique (brand_id, kind, locale)
);

create index if not exists brand_documents_brand_idx on public.brand_documents (brand_id, kind);

alter table public.brand_documents enable row level security;
grant select on public.brand_documents to authenticated;
grant all    on public.brand_documents to service_role;

drop policy if exists "admin: all on brand_documents" on public.brand_documents;
create policy "admin: all on brand_documents" on public.brand_documents for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- A brand may READ its own documents (they're about them), but only AION staff
-- write them — these carry commercial terms and cover wording.
drop policy if exists "brand: read own documents" on public.brand_documents;
create policy "brand: read own documents" on public.brand_documents for select to authenticated
  using (brand_id = public.get_my_brand_id() and public.is_brand_role());

-- Approving the FAQ is what puts it on the public FAQ page, in the block shape
-- the page already renders ({ title, content: { type: 'blocks', blocks: [...] } }).
create or replace function public.approve_brand_faq(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_en jsonb; v_it jsonb;
begin
  select body_json into v_en from public.brand_documents
   where brand_id = p_brand_id and kind = 'faq' and locale = 'en';
  select body_json into v_it from public.brand_documents
   where brand_id = p_brand_id and kind = 'faq' and locale = 'it';

  if v_en is null and v_it is null then
    return jsonb_build_object('ok', false, 'reason', 'no FAQ draft to approve — generate it first');
  end if;

  update public.brands set
    faq_en = coalesce(v_en, faq_en),
    faq_it = coalesce(v_it, faq_it)
  where id = p_brand_id;

  update public.brand_documents
     set status = 'published', approved_at = now()
   where brand_id = p_brand_id and kind = 'faq';

  return jsonb_build_object('ok', true,
    'faq_en', coalesce(jsonb_array_length(v_en), 0),
    'faq_it', coalesce(jsonb_array_length(v_it), 0));
end;
$$;

revoke all on function public.approve_brand_faq(bigint) from public, anon, authenticated;
grant execute on function public.approve_brand_faq(bigint) to service_role;
