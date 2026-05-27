-- Tourism statistics ingested from ISTAT SDMX (free public feed).
-- ISTAT publishes monthly arrivals (AR) and overnight stays (PR) at NUTS-2/NUTS-3
-- level. Comune-level data is not in the free feed, so we store at province
-- granularity and map shops.city -> province at correlation time.
--
-- Source: dataflow 122_54_DF_DCSC_TUR_3 (Movimento dei clienti negli esercizi
-- ricettivi per tipo di esercizio - mensili).
-- REF_AREA codes are old-NUTS-2006 (ITD31..ITD37 for Veneto provinces).

create extension if not exists unaccent with schema extensions;

create table if not exists public.tourism_stats (
  id              bigserial primary key,
  region          text not null,
  province        text not null,
  area_code       text not null,
  granularity     text not null check (granularity in ('province','comune')),
  period_start    date not null,
  period_end      date not null,
  arrivals        bigint,
  presences       bigint,
  source          text not null,
  scraped_at      timestamptz not null default now(),
  constraint tourism_stats_unique unique (area_code, granularity, period_start)
);

create index if not exists tourism_stats_province_period_idx
  on public.tourism_stats (province, period_start);
create index if not exists tourism_stats_period_idx
  on public.tourism_stats (period_start);

alter table public.tourism_stats enable row level security;

grant select on public.tourism_stats to authenticated;
grant all on public.tourism_stats to service_role;

drop policy if exists "tourism_stats: admins read" on public.tourism_stats;
create policy "tourism_stats: admins read"
  on public.tourism_stats for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Static Veneto comune -> province map. Covers the comuni that appear in
-- shops.city; can be extended without a code deploy by inserting rows.
create table if not exists public.veneto_comune_province (
  comune_norm   text primary key,
  province      text not null,
  area_code     text not null
);

grant select on public.veneto_comune_province to authenticated;
grant all on public.veneto_comune_province to service_role;

alter table public.veneto_comune_province enable row level security;
drop policy if exists "veneto_comune_province: read all" on public.veneto_comune_province;
create policy "veneto_comune_province: read all"
  on public.veneto_comune_province for select
  using (true);

-- Normalise: lowercase + strip accents + collapse whitespace. Used for lookup.
-- unaccent() is in the public-readable schema; mark function STABLE so it can
-- still be used in expressions without locking us out of indexes later.
create or replace function public.tourism_norm(p text)
returns text
language sql
stable
as $$
  select trim(regexp_replace(
    lower(extensions.unaccent(coalesce(p, ''))),
    '\s+', ' ', 'g'
  ));
$$;

-- Seed Veneto provincial capitals + major comuni. Insert is idempotent.
insert into public.veneto_comune_province (comune_norm, province, area_code) values
  ('venezia',      'Venezia', 'ITD35'),
  ('mestre',       'Venezia', 'ITD35'),
  ('chioggia',     'Venezia', 'ITD35'),
  ('jesolo',       'Venezia', 'ITD35'),
  ('caorle',       'Venezia', 'ITD35'),
  ('san dona di piave','Venezia','ITD35'),
  ('portogruaro',  'Venezia', 'ITD35'),
  ('mira',         'Venezia', 'ITD35'),
  ('cavallino-treporti','Venezia','ITD35'),
  ('verona',       'Verona',  'ITD31'),
  ('villafranca di verona','Verona','ITD31'),
  ('san bonifacio','Verona',  'ITD31'),
  ('legnago',      'Verona',  'ITD31'),
  ('bardolino',    'Verona',  'ITD31'),
  ('peschiera del garda','Verona','ITD31'),
  ('vicenza',      'Vicenza', 'ITD32'),
  ('bassano del grappa','Vicenza','ITD32'),
  ('schio',        'Vicenza', 'ITD32'),
  ('thiene',       'Vicenza', 'ITD32'),
  ('arzignano',    'Vicenza', 'ITD32'),
  ('belluno',      'Belluno', 'ITD33'),
  ('cortina d''ampezzo','Belluno','ITD33'),
  ('feltre',       'Belluno', 'ITD33'),
  ('pieve di cadore','Belluno','ITD33'),
  ('treviso',      'Treviso', 'ITD34'),
  ('conegliano',   'Treviso', 'ITD34'),
  ('castelfranco veneto','Treviso','ITD34'),
  ('vittorio veneto','Treviso','ITD34'),
  ('montebelluna', 'Treviso', 'ITD34'),
  ('mogliano veneto','Treviso','ITD34'),
  ('asolo',        'Treviso', 'ITD34'),
  ('padova',       'Padova',  'ITD36'),
  ('abano terme',  'Padova',  'ITD36'),
  ('montegrotto terme','Padova','ITD36'),
  ('este',         'Padova',  'ITD36'),
  ('cittadella',   'Padova',  'ITD36'),
  ('rovigo',       'Rovigo',  'ITD37'),
  ('adria',        'Rovigo',  'ITD37'),
  ('lendinara',    'Rovigo',  'ITD37')
on conflict (comune_norm) do nothing;
