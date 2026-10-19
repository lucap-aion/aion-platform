-- The inputs the commercial cycle asks for, and never remembered.
--
-- Three of the cycle's fields lived only in React state, so they were retyped on
-- every visit and lost on every reload:
--
--   legal entity        the data request's most important cell. It was seeded
--                       from brands.name via `'legal_name', b.name` in the
--                       overview, which meant the "no legal entity set" warning
--                       could never fire and every workbook went out saying
--                       "Pomellato" where it should say "Pomellato S.p.A."
--   registered address  composed from the four hq_* columns, editable, discarded
--   product focus       never seeded, never saved, never anywhere
--
--   the business-case perimeter — eight fields per segment — was component state
--                       too, so the pricing conversation could not be picked back
--                       up. A formal Chubb quotation takes one to two months; the
--                       perimeter it applies to has to still be there when it lands.
--
-- So they become columns and a table. Nothing here changes an existing value:
-- every column is nullable with no default, and the overview below falls back to
-- exactly what it used to return when they are null.

-- ── 1. The data-request identity ─────────────────────────────────────────────
alter table public.brands
  add column if not exists legal_name         text,
  add column if not exists registered_address text,
  add column if not exists product_focus      text;

comment on column public.brands.legal_name is
  'The legal entity the programme is contracted with — "Pomellato S.p.A.", not "Pomellato". Distinct from name, which is the trading name shown in the portal. NULL means nobody has stated it, and the data request says so rather than quietly using the trading name.';
comment on column public.brands.registered_address is
  'Registered address as it should appear on the data request, when it differs from the composed hq_* fields. NULL = use hq_address, hq_postcode, hq_city, hq_country.';
comment on column public.brands.product_focus is
  'Categories in scope for the pilot, in the client''s own words — "High jewellery, EU boutiques". Goes into the data request and frames the perimeter in step 4.';

-- ── 2. Prospect or client ────────────────────────────────────────────────────
-- The brands table has held both since the beginning, separated only by `status`
-- — which is pending/verified/blocked, an account-verification concept that says
-- nothing about whether these people have signed anything.
--
-- Two things need the distinction. The brands list needs to be able to show the
-- deals without the live programmes in the way. And demo generation, which is
-- refused on production because "a live brand account must contain only its own
-- data", is exactly the right thing to do for a prospect who has not signed an
-- NDA and whose account holds nothing at all.
--
-- DEFAULT false: every brand that exists today is a client, which is true —
-- Roberto Coin, Luisa Beccaria and Pomellato are live. New brands are created as
-- prospects by the app, and promote-brand clears the flag at hand-over.
alter table public.brands
  add column if not exists is_prospect boolean not null default false;

comment on column public.brands.is_prospect is
  'True while this house is a deal rather than a client. Set when the brand is created, cleared at hand-over. Gates demo generation: fabricated clients and covers are acceptable in a prospect''s empty account and never in a live one.';

create index if not exists brands_is_prospect on public.brands (is_prospect) where is_prospect;

-- ── 3. The perimeter, kept ───────────────────────────────────────────────────
-- One row per brand: the perimeter as last edited, whatever state it is in. It is
-- deliberately NOT a history of priced scenarios — the conversation has one live
-- perimeter at a time, and versioning it is a bigger idea than this needs.
--
-- The segments are jsonb rather than a child table because they are the argument
-- to compute_business_case, which already takes jsonb, and round-tripping them
-- through columns and back would be work in service of nothing.
create table if not exists public.brand_business_case (
  brand_id          bigint primary key references public.brands(id) on delete cascade,
  months            integer not null default 36 check (months between 1 and 120),
  setup_discounted  boolean not null default true,
  include_api       boolean not null default false,
  -- [{name, category, coverage, damage_scope, revenues, cogs_ratio, avg_price, start_month}]
  segments          jsonb   not null default '[]'::jsonb,
  -- Where these numbers came from, when they came from the client's own returned
  -- workbook rather than from someone typing them. Kept so the provenance of a
  -- perimeter is answerable months later, when the formal quotation arrives.
  imported_from     text,
  imported_at       timestamptz,
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);

comment on table public.brand_business_case is
  'The live pricing perimeter for one brand — the argument to compute_business_case, kept between sessions. Not a history: one row per brand, overwritten as the conversation moves.';

alter table public.brand_business_case enable row level security;
grant select, insert, update, delete on public.brand_business_case to authenticated;
grant all on public.brand_business_case to service_role;

drop policy if exists "admin: all on brand_business_case" on public.brand_business_case;
create policy "admin: all on brand_business_case" on public.brand_business_case
  for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- ── 4. The overview tells the truth about the three fields ───────────────────
-- Same shape as before, four additions. `legal_name` stops being an alias for the
-- trading name: null now means null, which is what lets the screen say the field
-- is unset instead of pre-filling it with an answer nobody gave.
create or replace function public.commercial_cycle_overview(p_brand_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'AION admin only' using errcode = '42501';
  end if;

  return (select jsonb_build_object(
    'brand', (select jsonb_build_object(
                'id', b.id, 'name', b.name, 'website', b.website, 'slug', b.slug,
                'logo_small', b.logo_small,
                'is_prospect', b.is_prospect,
                'legal_name', b.legal_name,
                'product_focus', b.product_focus,
                -- The override when there is one, the composed hq_* fields when
                -- there is not. The screen shows one address either way.
                'address', coalesce(
                  nullif(b.registered_address, ''),
                  nullif(concat_ws(', ', b.hq_address, b.hq_postcode, b.hq_city, b.hq_country), '')),
                'address_is_override', nullif(b.registered_address, '') is not null)
              from public.brands b where b.id = p_brand_id),
    'artifacts', coalesce((select jsonb_object_agg(o.template_key, jsonb_build_object(
                    'storage_path', o.storage_path,
                    'generated_at', o.generated_at,
                    'slots_filled', jsonb_array_length(coalesce(o.slots_filled, '[]'::jsonb))))
                  from public.brand_deck_outputs o where o.brand_id = p_brand_id), '{}'::jsonb),
    'stages', coalesce((select jsonb_object_agg(s.stage, jsonb_build_object(
                    'status', s.status,
                    'queued', s.queued_at is not null and s.status = 'pending',
                    'attempts', s.attempts,
                    'error', s.error,
                    'detail', s.detail,
                    'finished_at', s.finished_at))
                  from public.brand_onboarding s where s.brand_id = p_brand_id), '{}'::jsonb),
    'progress', coalesce((select jsonb_object_agg(p.step::text, jsonb_build_object(
                    'state', p.state, 'note', p.note,
                    'happened_on', p.happened_on, 'updated_at', p.updated_at))
                  from public.brand_commercial_progress p where p.brand_id = p_brand_id), '{}'::jsonb),
    -- The perimeter, so step 4 opens on what was left there rather than on one
    -- blank segment. Null when the conversation has not started.
    'business_case', (select jsonb_build_object(
                    'months', c.months, 'setup_discounted', c.setup_discounted,
                    'include_api', c.include_api, 'segments', c.segments,
                    'imported_from', c.imported_from, 'imported_at', c.imported_at,
                    'updated_at', c.updated_at)
                  from public.brand_business_case c where c.brand_id = p_brand_id),
    'counts', jsonb_build_object(
       'products',   (select count(*) from public.storefront_products where brand_id = p_brand_id),
       'knowledge_docs', (select count(*) from public.brand_knowledge_docs where brand_id = p_brand_id),
       'knowledge_chunks', (select count(*) from public.brand_knowledge_chunks where brand_id = p_brand_id),
       'customers',  (select count(*) from public.profiles
                       where brand_id = p_brand_id and (role is null or role = 'customer')),
       'policies',   (select count(*) from public.policies where brand_id = p_brand_id),
       'shops',      (select count(*) from public.shops where brand_id = p_brand_id),
       -- A crawl still draining is the difference between "the catalogue stage
       -- finished and found nothing" and "give it another minute".
       'crawl_pending', (select count(*) from public.knowledge_crawl_queue
                          where brand_id = p_brand_id and status = 'pending'),
       'brand_users',(select count(*) from public.profiles
                       where brand_id = p_brand_id and role in ('brand', 'brand_admin', 'brand_user'))),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
                    'category', q.category, 'coverage', q.coverage,
                    'damage_scope', q.damage_scope, 'rate_of_cogs', q.rate_of_cogs,
                    'quoted_for', q.quoted_for, 'quoted_at', q.quoted_at,
                    'own_quote', coalesce(q.brand_id = p_brand_id, false))
                    order by q.category, q.coverage)
                  from public.insurance_quotes q where q.active), '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.commercial_cycle_overview(bigint) from public, anon;
grant execute on function public.commercial_cycle_overview(bigint) to authenticated, service_role;
