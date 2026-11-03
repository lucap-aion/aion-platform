-- Knowledge cards as rows, so a brand whose clients and products live only as
-- "Scheda cliente — …" / "Scheda prodotto — …" knowledge cards can be TOTALLED
-- and RANKED exactly, not estimated from whichever cards a similarity search
-- happens to return.
--
-- Why: Luisa Beccaria (DEV brand 17) keeps 1,421 client cards and 1,905 product
-- cards and nothing in profiles/policies. The assistant could only reach them
-- through search_knowledge (top-k similarity), so "best seller by pieces",
-- "pizzo vs velluto", "top 10 Italian clients" and "how many brides" were sums
-- over a random sample. The same question gave 238 and then 155 pieces.
--
-- Both views are security_invoker: brand_knowledge_docs RLS applies, so a
-- brand user sees only their own brand and anon sees nothing. Read-only; no
-- data is copied. They parse the card text the ingest wrote, line by line.
-- Euro amounts on the cards use '.' as the thousands separator and no decimals.

create or replace function public.kc_eur(p text)
returns numeric
language sql
immutable
as $$
  select nullif(replace(replace(p, '€', ''), '.', ''), '')::numeric
$$;

create or replace view public.knowledge_product_cards
with (security_invoker = true) as
select
  d.brand_id,
  d.id                                                             as doc_id,
  substring(d.content from '^Scheda prodotto — (\S+) · ')          as code,
  split_part(substring(d.content from '^Scheda prodotto — (\S+) · '), '-', 1) as season,
  btrim(substring(d.content from '^Scheda prodotto — \S+ · ([^\n]*)'))        as description,
  nullif(btrim(substring(d.content from '\nCategoria: ([^·\n]*)')), '')        as category,
  nullif(btrim(substring(d.content from '· Modello ([^ ·\n]*)')), '')          as model,
  -- The model without its variant suffix: 40301CMV, 40301MDV → 40301; H517B → H517.
  substring(nullif(btrim(substring(d.content from '· Modello ([^ ·\n]*)')), '') from '^[A-Za-z]*[0-9]+') as model_family,
  nullif(btrim(substring(d.content from '· Materiale ([^ ·\n]*)')), '')        as material_code,
  nullif(btrim(substring(d.content from '\nComposizione: ([^\n]*)')), '')      as composition,
  public.kc_eur(substring(d.content from '\nPrezzo medio \(listino\): (€-?[0-9.]+)')) as avg_list_price,
  coalesce(replace(substring(d.content from '\nVenduto: (-?[0-9.]+) capi'), '.', '')::int, 0) as units_sold,
  coalesce(public.kc_eur(substring(d.content from 'Ricavo totale (€-?[0-9.]+)')), 0)         as revenue_total,
  coalesce(public.kc_eur(substring(d.content from '\nVenduto:[^\n]*(?:\(|· )2023: (€-?[0-9.]+)')), 0) as revenue_2023,
  coalesce(public.kc_eur(substring(d.content from '\nVenduto:[^\n]*(?:\(|· )2024: (€-?[0-9.]+)')), 0) as revenue_2024,
  coalesce(public.kc_eur(substring(d.content from '\nVenduto:[^\n]*(?:\(|· )2025: (€-?[0-9.]+)')), 0) as revenue_2025,
  coalesce(public.kc_eur(substring(d.content from '\nVenduto:[^\n]*(?:\(|· )2026: (€-?[0-9.]+)')), 0) as revenue_2026,
  replace(substring(d.content from '\nClienti che lo hanno acquistato: ([0-9.]+)'), '.', '')::int as buyers,
  nullif(btrim(substring(d.content from '\nColori: ([^·\n]*)')), '')           as colours,
  nullif(btrim(substring(d.content from 'Taglie vendute \(2026\): ([^\n]*)')), '') as sizes_sold_2026,
  coalesce(substring(d.content from 'Trunk Show di Londra 2026: (Sì|No)') = 'Sì', false)   as at_london_trunk_show_2026,
  coalesce(substring(d.content from 'Trunk Show Hamptons[^:]*: (Sì|No)') = 'Sì', false)   as at_hamptons_trunk_show_2026,
  d.content !~ '\nVenduto: -?[0-9.]+ capi'                          as no_sales_history,
  d.title
from public.brand_knowledge_docs d
where d.deleted_at is null
  and d.title like 'Scheda prodotto — %';

create or replace view public.knowledge_client_cards
with (security_invoker = true) as
with c as (
select
  d.brand_id,
  d.id                                                             as doc_id,
  btrim(substring(d.content from '^Scheda cliente — (.*?) \(ID [^)]*\)'))      as client_name,
  substring(d.content from '^Scheda cliente — .*? \(ID ([^)]*)\)')             as client_code,
  nullif(btrim(substring(d.content from '\nSegmento: ([^·\n]*)')), '')         as segment,
  nullif(btrim(substring(d.content from 'Fedeltà: ([^·\n]*)')), '')            as loyalty,
  substring(d.content from 'Anni attivi: ([0-9]+)')::int                       as years_active,
  case when btrim(substring(d.content from '\nPaese: ([^\n]*)')) in ('', '—', 'n/d') then null
       else btrim(substring(d.content from '\nPaese: ([^\n]*)')) end as country,
  coalesce(public.kc_eur(substring(d.content from '\nSpesa totale [^:]*: (€-?[0-9.]+)')), 0) as spend_total,
  coalesce(public.kc_eur(substring(d.content from '\nSpesa totale[^\n]*(?:\(|· )2023: (€-?[0-9.]+)')), 0) as spend_2023,
  coalesce(public.kc_eur(substring(d.content from '\nSpesa totale[^\n]*(?:\(|· )2024: (€-?[0-9.]+)')), 0) as spend_2024,
  coalesce(public.kc_eur(substring(d.content from '\nSpesa totale[^\n]*(?:\(|· )2025: (€-?[0-9.]+)')), 0) as spend_2025,
  coalesce(public.kc_eur(substring(d.content from '\nSpesa totale[^\n]*(?:\(|· )2026: (€-?[0-9.]+)')), 0) as spend_2026,
  replace(substring(d.content from '\nCapi acquistati: (-?[0-9.]+)'), '.', '')::int as pieces,
  public.kc_eur(substring(d.content from 'Scontrino medio annuo: (€-?[0-9.]+)'))  as avg_annual_ticket,
  ch.channels,
  ch.primary_channel,
  coalesce((ch.channels ->> 'Wholesale')::numeric, 0)              as wholesale_spend,
  coalesce((ch.channels ->> 'Sposa')::numeric, 0)                  as bridal_channel_spend,
  coalesce((cat.categories ->> 'Abiti - Da Sposa')::numeric, 0)    as bridal_dress_spend,
  cat.categories,
  nullif(nullif(btrim(substring(d.content from '\nTrunk show frequentati: ([^\n]*)')), '—'), '') as trunk_shows,
  nullif(btrim(substring(d.content from 'Taglie note \(2026\): ([^·\n]*)')), '')  as sizes_2026,
  nullif(btrim(substring(d.content from 'Colori preferiti \(2026\): ([^\n]*)')), '') as colours_2026,
  d.title
from public.brand_knowledge_docs d
left join lateral (
  select
    jsonb_object_agg(m[1], public.kc_eur(m[2])) as channels,
    (array_agg(m[1] order by public.kc_eur(m[2]) desc))[1] as primary_channel
  from regexp_matches(
         coalesce(substring(d.content from '\nCanali: ([^\n]*)'), ''),
         '\s*([^,€]+?) (€-?[0-9.]+)', 'g') as m
) ch on true
left join lateral (
  select jsonb_object_agg(m[1], public.kc_eur(m[2])) as categories
  from regexp_matches(
         coalesce(substring(d.content from '\nCategorie preferite: ([^\n]*)'), ''),
         '\s*([^,(]+?) \((€-?[0-9.]+)\)', 'g') as m
) cat on true
where d.deleted_at is null
  and d.title like 'Scheda cliente — %'
)
-- Coverage travels on every row, computed over the WHOLE house before any
-- filter the caller adds: asked for "top Italian clients", the model counted
-- the clients with a country AFTER filtering to Italy and reported 125 of
-- 1,421 (the real figure is 315). A window over brand_id cannot be narrowed by
-- the caller's WHERE on country.
select
  c.*,
  count(*) filter (where c.country is not null) over (partition by c.brand_id) as clients_with_country,
  count(*) over (partition by c.brand_id)                                        as clients_total
from c;

revoke all on public.knowledge_product_cards from anon;
revoke all on public.knowledge_client_cards  from anon;
grant select on public.knowledge_product_cards to authenticated, service_role;
grant select on public.knowledge_client_cards  to authenticated, service_role;

comment on view public.knowledge_product_cards is
  'One row per "Scheda prodotto" knowledge card (brand-scoped via RLS). Totals/rankings for brands whose products live in the knowledge base.';
comment on view public.knowledge_client_cards is
  'One row per "Scheda cliente" knowledge card (brand-scoped via RLS). Totals/rankings for brands whose clients live in the knowledge base.';
