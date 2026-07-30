-- Deck templates: brand the intro deck instead of rebuilding it by hand.
--
-- The commercial cycle opens with the same 12-slide teaser every time, rebranded
-- for the prospect. Comparing the master (AION_Teaser_New.pptx) against a real
-- branded output (AION x Pasquale Bruni.v1.pptx) shows exactly what that work is:
-- 34 of 47 media files are identical — the AION identity, the icons, the team
-- photos, the pioneer logos. Thirteen change, and they are all brand imagery:
--
--   slide 2  image3.png    hero        the opening product/lifestyle image
--   slide 4  image7.jpeg   hero        loyalty slide imagery
--   slide 5  image9.jpeg   product     small inline piece
--   slide 9  image20-26    pioneers    the "similar programs" logo wall
--   slide 10 image27-29    product     the three benefit-slide pieces
--
-- Plus a handful of editable figures (Over 50% → Over 70% of Gen Z, Top 5%/40%
-- → Top 0.5%/30%, "1-2 years" → "2 years").
--
-- So a template is: a stored .pptx plus a map of which media parts are slots and
-- what kind of image each one wants. Everything not in the map is left alone —
-- that is what keeps the deck on-brand for AION while the pieces become theirs.

create table if not exists public.deck_templates (
  id            bigserial primary key,
  key           text not null unique,
  name          text not null,
  -- intro | operations | business_case
  kind          text not null default 'intro',
  storage_path  text not null,
  -- [{ media: "ppt/media/image3.png", slide: 2, role: "hero"|"product"|"pioneers"|"logo",
  --    note: "what this image is for" }]
  slots         jsonb not null default '[]'::jsonb,
  -- [{ find: "1-2 years", replace_with: "2 years", note: "..." }] — optional
  -- text edits a human may want per brand; applied only when supplied.
  text_slots    jsonb not null default '[]'::jsonb,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.deck_templates enable row level security;
grant select on public.deck_templates to authenticated;
grant all    on public.deck_templates to service_role;

drop policy if exists "admin: all on deck_templates" on public.deck_templates;
create policy "admin: all on deck_templates" on public.deck_templates for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

insert into public.deck_templates (key, name, kind, storage_path, slots, text_slots)
values (
  'intro_teaser',
  'AION intro teaser (12 slides)',
  'intro',
  'templates/AION_Teaser_New.pptx',
  '[
    {"media":"ppt/media/image3.png",   "slide":2,  "role":"hero",     "note":"opening product/lifestyle image"},
    {"media":"ppt/media/image7.jpeg",  "slide":4,  "role":"hero",     "note":"loyalty slide imagery"},
    {"media":"ppt/media/image9.jpeg",  "slide":5,  "role":"product",  "note":"small inline piece"},
    {"media":"ppt/media/image27.jpeg", "slide":10, "role":"product",  "note":"benefits slide, piece 1"},
    {"media":"ppt/media/image28.jpeg", "slide":10, "role":"product",  "note":"benefits slide, piece 2"},
    {"media":"ppt/media/image29.jpeg", "slide":10, "role":"product",  "note":"benefits slide, piece 3"}
  ]'::jsonb,
  '[
    {"find":"1-2 years, then renewable","replace_with":"2 years, then renewable","note":"pilot duration, if agreed"}
  ]'::jsonb
)
on conflict (key) do update set
  slots = excluded.slots, text_slots = excluded.text_slots, name = excluded.name;

-- Where the branded output lands, so it can be handed over as a link.
create table if not exists public.brand_deck_outputs (
  id           bigserial primary key,
  brand_id     bigint not null references public.brands(id) on delete cascade,
  template_key text not null,
  storage_path text not null,
  slots_filled jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  unique (brand_id, template_key)
);

alter table public.brand_deck_outputs enable row level security;
grant select on public.brand_deck_outputs to authenticated;
grant all    on public.brand_deck_outputs to service_role;

drop policy if exists "admin: all on brand_deck_outputs" on public.brand_deck_outputs;
create policy "admin: all on brand_deck_outputs" on public.brand_deck_outputs for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
