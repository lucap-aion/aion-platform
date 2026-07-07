-- Per-brand Assistant configuration: lets a brand shape its own in-store
-- assistant (name, freeform instructions, where its data lives, signature
-- moves, scope) without a code change. Replaces the hardcoded brand-specific
-- block that used to live in the brand-assistant edge function.
--
-- data_home tells the assistant where THIS brand's clients/products live:
--   'sql'       — clients are app users; query the CRM tables (default, today's
--                 behaviour for every brand).
--   'knowledge' — clients/products live in the knowledge base as text cards
--                 (e.g. Luisa Beccaria); steer name/style questions to
--                 search_knowledge, since profiles/policies are empty for them.
--   'hybrid'    — both; check the CRM and the knowledge base before concluding.

create table if not exists public.brand_assistant_config (
  brand_id            integer primary key references public.brands(id) on delete cascade,
  assistant_name      text,
  custom_instructions text,
  data_home           text not null default 'sql'
                        check (data_home in ('sql', 'knowledge', 'hybrid')),
  signature_moves     jsonb not null default '[]'::jsonb,  -- [{ "title", "prompt" }]
  scope_note          text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id) on delete set null
);

-- Touch updated_at on write (reuse the shared trigger fn).
drop trigger if exists brand_assistant_config_touch_updated_at on public.brand_assistant_config;
create trigger brand_assistant_config_touch_updated_at
  before update on public.brand_assistant_config
  for each row execute function public.touch_ai_chats_updated_at();

-- ── RLS: everyone in the brand may READ their config (the assistant needs it);
-- only brand admins / master users (and AION admins) may WRITE it.
alter table public.brand_assistant_config enable row level security;
grant select, insert, update on public.brand_assistant_config to authenticated;
grant all on public.brand_assistant_config to service_role;

drop policy if exists "brand_assistant_config: brand or admin read" on public.brand_assistant_config;
create policy "brand_assistant_config: brand or admin read"
  on public.brand_assistant_config for select
  using (
    public.get_my_role() = 'admin'
    or brand_id = (
      select p.brand_id from public.profiles p where p.id = public.get_my_profile_id()
    )
  );

drop policy if exists "brand_assistant_config: brand admin insert" on public.brand_assistant_config;
create policy "brand_assistant_config: brand admin insert"
  on public.brand_assistant_config for insert
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

drop policy if exists "brand_assistant_config: brand admin update" on public.brand_assistant_config;
create policy "brand_assistant_config: brand admin update"
  on public.brand_assistant_config for update
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1 from public.profiles p
      where p.id = public.get_my_profile_id()
        and p.brand_id = brand_assistant_config.brand_id
        and (p.role = 'brand_admin' or (p.role = 'brand_user' and p.is_master))
    )
  );

-- ── Seed Luisa Beccaria (brand 17) with the exact behaviour it had hardcoded in
-- the edge function, so nothing regresses when the hardcoded block is removed.
insert into public.brand_assistant_config (brand_id, data_home, custom_instructions, signature_moves)
values (
  17,
  'knowledge',
  $ins$Where this brand's clients & products live:
- CLIENTS / "schede anagrafiche" (total & yearly spend, segment VIC/Premium/Regular/Entry, loyalty, favourite categories, sizes & colours, trunk shows attended, top products) and the London trunk-show confirmed-attendee list are ONLY in the KNOWLEDGE BASE. Use search_knowledge (by the client's name) — the SQL tables profiles/policies do NOT contain this brand's clients, so run_sql returns empty for them. A client card is titled "Scheda cliente — <Name> (ID <n>)".
- PRODUCTS live in TWO places: (a) the KNOWLEDGE BASE has product cards with sales history + a "Trunk Show Londra 2026" flag — use search_knowledge for style/recommendation questions ("cosa raccomando a…", pizzo/ricamo, per il trunk show); titled "Scheda prodotto — <code> <description>". (b) The SQL table storefront_products holds the LIVE online catalogue (name, description, price, availability, image_url) — use run_sql for price/availability/what's-online, and it also powers photo search. Combine both when useful, and cite what you used.$ins$,
  jsonb_build_array(
    jsonb_build_object(
      'title', 'Completa il look (styling / cross-sell)',
      'prompt', $m1$from a chosen piece OR a client, build ONE coordinated outfit from the live catalogue — the hero piece plus complementary accessories, shoes, bag, belt in matching colours/collection (and the client's size/colours when known). Do it with run_sql on storefront_products selecting those pieces WITH image_url so they render as photo cards, then add ONE short line on why they work together. Prefer available pieces.$m1$
    ),
    jsonb_build_object(
      'title', 'Clienteling message',
      'prompt', $m2$when asked to write to a client, draft a short, warm, ready-to-send WhatsApp/email note — personalised from her card (favourite categories, sizes, colours, last purchase, trunk shows) and the relevant NEW arrivals from the catalogue. Put the message in a Markdown quote block (>) so the associate can copy it verbatim, in the client's language, with an elegant sign-off, never pushy.$m2$
    ),
    jsonb_build_object(
      'title', 'Styling from an inspiration photo',
      'prompt', $m3$if the associate attaches a photo as INSPIRATION (a look to recreate, not an exact item to identify), use the visual matches as a starting point and build a coordinated outfit around the closest pieces — and say clearly it's a styling suggestion inspired by the photo, not an exact match.$m3$
    )
  )
)
on conflict (brand_id) do nothing;
