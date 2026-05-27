-- Generalise the Veneto-only tourism feature to all of Italy.
-- 1. Rename veneto_comune_province -> comune_province (idempotent)
-- 2. Add region column, backfill existing rows to 'Veneto'
-- 3. Seed all 103 ISTAT NUTS-3 provinces (one row per province capital)
--    + common English aliases (rome, milan, venice, florence, etc.)
-- 4. Refresh the RLS policy under the new name

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='veneto_comune_province')
     and not exists (select 1 from information_schema.tables
                     where table_schema='public' and table_name='comune_province') then
    alter table public.veneto_comune_province rename to comune_province;
  end if;
end $$;

alter table public.comune_province add column if not exists region text;
update public.comune_province set region='Veneto' where region is null;
alter table public.comune_province alter column region set not null;

drop policy if exists "veneto_comune_province: read all" on public.comune_province;
drop policy if exists "comune_province: read all" on public.comune_province;
create policy "comune_province: read all" on public.comune_province for select using (true);

insert into public.comune_province (comune_norm, province, area_code, region) values
  ('torino', 'Torino', 'ITC11', 'Piemonte'),
  ('vercelli', 'Vercelli', 'ITC12', 'Piemonte'),
  ('biella', 'Biella', 'ITC13', 'Piemonte'),
  ('verbano-cusio-ossola', 'Verbano-Cusio-Ossola', 'ITC14', 'Piemonte'),
  ('novara', 'Novara', 'ITC15', 'Piemonte'),
  ('cuneo', 'Cuneo', 'ITC16', 'Piemonte'),
  ('asti', 'Asti', 'ITC17', 'Piemonte'),
  ('alessandria', 'Alessandria', 'ITC18', 'Piemonte'),
  ('valle d''aosta', 'Valle d''Aosta', 'ITC20', 'Valle d''Aosta'),
  ('imperia', 'Imperia', 'ITC31', 'Liguria'),
  ('savona', 'Savona', 'ITC32', 'Liguria'),
  ('genova', 'Genova', 'ITC33', 'Liguria'),
  ('la spezia', 'La Spezia', 'ITC34', 'Liguria'),
  ('varese', 'Varese', 'ITC41', 'Lombardia'),
  ('como', 'Como', 'ITC42', 'Lombardia'),
  ('lecco', 'Lecco', 'ITC43', 'Lombardia'),
  ('sondrio', 'Sondrio', 'ITC44', 'Lombardia'),
  ('milano', 'Milano', 'ITC45', 'Lombardia'),
  ('bergamo', 'Bergamo', 'ITC46', 'Lombardia'),
  ('brescia', 'Brescia', 'ITC47', 'Lombardia'),
  ('pavia', 'Pavia', 'ITC48', 'Lombardia'),
  ('lodi', 'Lodi', 'ITC49', 'Lombardia'),
  ('cremona', 'Cremona', 'ITC4A', 'Lombardia'),
  ('mantova', 'Mantova', 'ITC4B', 'Lombardia'),
  ('bolzano', 'Bolzano', 'ITD10', 'Trentino-Alto Adige'),
  ('trento', 'Trento', 'ITD20', 'Trentino-Alto Adige'),
  ('verona', 'Verona', 'ITD31', 'Veneto'),
  ('vicenza', 'Vicenza', 'ITD32', 'Veneto'),
  ('belluno', 'Belluno', 'ITD33', 'Veneto'),
  ('treviso', 'Treviso', 'ITD34', 'Veneto'),
  ('venezia', 'Venezia', 'ITD35', 'Veneto'),
  ('padova', 'Padova', 'ITD36', 'Veneto'),
  ('rovigo', 'Rovigo', 'ITD37', 'Veneto'),
  ('pordenone', 'Pordenone', 'ITD41', 'Friuli-Venezia Giulia'),
  ('udine', 'Udine', 'ITD42', 'Friuli-Venezia Giulia'),
  ('gorizia', 'Gorizia', 'ITD43', 'Friuli-Venezia Giulia'),
  ('trieste', 'Trieste', 'ITD44', 'Friuli-Venezia Giulia'),
  ('piacenza', 'Piacenza', 'ITD51', 'Emilia-Romagna'),
  ('parma', 'Parma', 'ITD52', 'Emilia-Romagna'),
  ('reggio nell''emilia', 'Reggio nell''Emilia', 'ITD53', 'Emilia-Romagna'),
  ('modena', 'Modena', 'ITD54', 'Emilia-Romagna'),
  ('bologna', 'Bologna', 'ITD55', 'Emilia-Romagna'),
  ('ferrara', 'Ferrara', 'ITD56', 'Emilia-Romagna'),
  ('ravenna', 'Ravenna', 'ITD57', 'Emilia-Romagna'),
  ('forli-cesena', 'Forlì-Cesena', 'ITD58', 'Emilia-Romagna'),
  ('rimini', 'Rimini', 'ITD59', 'Emilia-Romagna'),
  ('massa-carrara', 'Massa-Carrara', 'ITE11', 'Toscana'),
  ('lucca', 'Lucca', 'ITE12', 'Toscana'),
  ('pistoia', 'Pistoia', 'ITE13', 'Toscana'),
  ('firenze', 'Firenze', 'ITE14', 'Toscana'),
  ('prato', 'Prato', 'ITE15', 'Toscana'),
  ('livorno', 'Livorno', 'ITE16', 'Toscana'),
  ('pisa', 'Pisa', 'ITE17', 'Toscana'),
  ('arezzo', 'Arezzo', 'ITE18', 'Toscana'),
  ('siena', 'Siena', 'ITE19', 'Toscana'),
  ('grosseto', 'Grosseto', 'ITE1A', 'Toscana'),
  ('perugia', 'Perugia', 'ITE21', 'Umbria'),
  ('terni', 'Terni', 'ITE22', 'Umbria'),
  ('pesaro e urbino', 'Pesaro e Urbino', 'ITE31', 'Marche'),
  ('ancona', 'Ancona', 'ITE32', 'Marche'),
  ('macerata', 'Macerata', 'ITE33', 'Marche'),
  ('ascoli piceno', 'Ascoli Piceno', 'ITE34', 'Marche'),
  ('viterbo', 'Viterbo', 'ITE41', 'Lazio'),
  ('rieti', 'Rieti', 'ITE42', 'Lazio'),
  ('roma', 'Roma', 'ITE43', 'Lazio'),
  ('latina', 'Latina', 'ITE44', 'Lazio'),
  ('frosinone', 'Frosinone', 'ITE45', 'Lazio'),
  ('l''aquila', 'L''Aquila', 'ITF11', 'Abruzzo'),
  ('teramo', 'Teramo', 'ITF12', 'Abruzzo'),
  ('pescara', 'Pescara', 'ITF13', 'Abruzzo'),
  ('chieti', 'Chieti', 'ITF14', 'Abruzzo'),
  ('isernia', 'Isernia', 'ITF21', 'Molise'),
  ('campobasso', 'Campobasso', 'ITF22', 'Molise'),
  ('caserta', 'Caserta', 'ITF31', 'Campania'),
  ('benevento', 'Benevento', 'ITF32', 'Campania'),
  ('napoli', 'Napoli', 'ITF33', 'Campania'),
  ('avellino', 'Avellino', 'ITF34', 'Campania'),
  ('salerno', 'Salerno', 'ITF35', 'Campania'),
  ('foggia', 'Foggia', 'ITF41', 'Puglia'),
  ('bari', 'Bari', 'ITF42', 'Puglia'),
  ('taranto', 'Taranto', 'ITF43', 'Puglia'),
  ('brindisi', 'Brindisi', 'ITF44', 'Puglia'),
  ('lecce', 'Lecce', 'ITF45', 'Puglia'),
  ('potenza', 'Potenza', 'ITF51', 'Basilicata'),
  ('matera', 'Matera', 'ITF52', 'Basilicata'),
  ('cosenza', 'Cosenza', 'ITF61', 'Calabria'),
  ('crotone', 'Crotone', 'ITF62', 'Calabria'),
  ('catanzaro', 'Catanzaro', 'ITF63', 'Calabria'),
  ('vibo valentia', 'Vibo Valentia', 'ITF64', 'Calabria'),
  ('reggio di calabria', 'Reggio di Calabria', 'ITF65', 'Calabria'),
  ('trapani', 'Trapani', 'ITG11', 'Sicilia'),
  ('palermo', 'Palermo', 'ITG12', 'Sicilia'),
  ('messina', 'Messina', 'ITG13', 'Sicilia'),
  ('agrigento', 'Agrigento', 'ITG14', 'Sicilia'),
  ('caltanissetta', 'Caltanissetta', 'ITG15', 'Sicilia'),
  ('enna', 'Enna', 'ITG16', 'Sicilia'),
  ('catania', 'Catania', 'ITG17', 'Sicilia'),
  ('ragusa', 'Ragusa', 'ITG18', 'Sicilia'),
  ('siracusa', 'Siracusa', 'ITG19', 'Sicilia'),
  ('sassari', 'Sassari', 'ITG25', 'Sardegna'),
  ('nuoro', 'Nuoro', 'ITG26', 'Sardegna'),
  ('cagliari', 'Cagliari', 'ITG27', 'Sardegna'),
  ('oristano', 'Oristano', 'ITG28', 'Sardegna')
on conflict (comune_norm) do nothing;

-- English aliases for the most-touristed Italian cities.
insert into public.comune_province (comune_norm, province, area_code, region) values
  ('rome',     'Roma',    'ITE43', 'Lazio'),
  ('milan',    'Milano',  'ITC45', 'Lombardia'),
  ('venice',   'Venezia', 'ITD35', 'Veneto'),
  ('florence', 'Firenze', 'ITE14', 'Toscana'),
  ('naples',   'Napoli',  'ITF33', 'Campania'),
  ('turin',    'Torino',  'ITC11', 'Piemonte')
on conflict (comune_norm) do nothing;
