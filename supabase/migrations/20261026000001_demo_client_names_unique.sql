-- No two demo clients of one house share a name.
--
-- Giulio, 2026-10-26, on the re-recorded Ferragamo film: "Capucine de Vaucelles, Paris" is the
-- 3rd AND the 8th of the top ten clients — two different women, same name, same city. Not a
-- one-off: 61–69 of every 320-client book on prod repeated a name (Brunello, Oris, Ferragamo),
-- and Prada's on dev the same. A CRM team reads a duplicated name as a duplicated record,
-- which is the one data-quality failure their whole job is about.
--
-- Why: both generators drew the first name and the surname independently, at random, once
-- per client. generate_brand_crm_depth adds ~280 clients from regional pools of 548
-- combinations in all, so collisions are a certainty (the birthday problem), and the base
-- generator's pool overlaps the regional one ("Chiara Hartley").
--
-- So one helper picks a name the house has not used yet, and both generators ask it; the
-- regional generator moves to another region (with its own city and dial code) only when
-- its own is used up, and repeats a name only when every pool is. Then the books already
-- written are put right in place — see the end of this file.

-- A first name + surname from these lists that no profile of this brand carries yet, or
-- NULL when every combination is taken. An anti-join, not a NOT EXISTS per combination:
-- 100 combinations against a 320-client book is one hash join, called once per client.
create or replace function public.demo_unused_name(p_brand_id bigint, p_first text[], p_last text[])
returns text[]
language sql volatile
set search_path to 'public'
as $$
  select array[n.f, n.l]
    from (select f, l from unnest(p_first) f cross join unnest(p_last) l) n
    left join public.profiles p
      on p.brand_id = p_brand_id and p.first_name = n.f and p.last_name = n.l
   where p.id is null
   order by random()
   limit 1
$$;

CREATE OR REPLACE FUNCTION public.generate_brand_demo_data(p_brand_id bigint, p_customers integer DEFAULT 40, p_policies integer DEFAULT 60, p_avg_ticket numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first  text[] := array['Sofia','Giulia','Alessandra','Camilla','Beatrice','Vittoria','Chiara','Ludovica',
                           'Charlotte','Olivia','Amelia','Isabella','Eleanor','Victoria','Alice','Emma',
                           'Margaux','Camille','Inès','Elena','Anastasia','Nadia','Layla','Fatima',
                           'Grace','清','Mei','Priya','Ana','Lucia','Marta','Federica','Bianca','Carlotta',
                           'Sophie','Helena','Julia','Marie','Laura','Valentina'];
  v_last   text[] := array['Rossi','Bianchi','Colombo','Ferrari','Esposito','Ricci','Marino','Greco',
                           'Windsor','Ashworth','Whitmore','Carlisle','Beaumont','Fairchild','Hartley',
                           'Delacroix','Moreau','Lefèvre','Dubois','Al Nahyan','Al Maktoum','Haddad',
                           'Novak','Petrova','Kuznetsova','Tanaka','Chen','Sharma','Ortiz','Navarro',
                           'Vandenberg','Lindqvist','Kowalski','Moretti','Barbieri','Fontana','Sartori',
                           'Pellegrini','Gallo','Conti'];
  v_cities jsonb := '[
    {"city":"Milano","country":"IT"},{"city":"Roma","country":"IT"},{"city":"Firenze","country":"IT"},
    {"city":"Paris","country":"FR"},{"city":"London","country":"GB"},{"city":"Madrid","country":"ES"},
    {"city":"New York","country":"US"},{"city":"Miami","country":"US"},{"city":"Los Angeles","country":"US"},
    {"city":"Dubai","country":"AE"},{"city":"Zürich","country":"CH"},{"city":"München","country":"DE"},
    {"city":"Tokyo","country":"JP"},{"city":"Hong Kong","country":"HK"},{"city":"São Paulo","country":"BR"}]'::jsonb;
  v_brand      record;
  v_hq_city    text;
  v_hq_country text;
  v_products   integer;
  v_kb_products integer := 0;
  v_source     text := 'storefront';
  v_shops      integer := 0;
  v_items      integer := 0;
  v_custs      integer := 0;
  v_pols       integer := 0;
  v_claims     integer := 0;
  v_fb         integer := 0;
  r            record;
  v_id         uuid;
  v_pid        bigint;
  v_cid        bigint;
begin
  select * into v_brand from public.brands where id = p_brand_id;
  if v_brand is null then
    raise exception 'brand % not found', p_brand_id;
  end if;

  -- PRICED rows, not rows. This counted every row in the catalogue, and the insert below
  -- takes only the ones with a price — so a house whose catalogue was recovered without
  -- prices (one behind a bot challenge, read from its own sitemap) satisfied the check with
  -- 676 pieces, inserted none of them, and then dereferenced an item it had never found.
  -- A price-less catalogue is exactly the case the knowledge fallback already handles by
  -- asking for a typical ticket; it just was not being reached.
  select count(*) into v_products
    from public.storefront_products
   where brand_id = p_brand_id and price is not null;
  if v_products = 0 then
    -- No e-commerce feed. Fall back to the product pages the crawler indexed.
    select count(*) into v_kb_products
    from public.brand_knowledge_docs
    where brand_id = p_brand_id and category = 'product' and coalesce(title, '') <> '';
    if v_kb_products = 0 then
      return jsonb_build_object('ok', false,
        'reason', 'nothing to build a catalogue from yet — run the crawl and storefront stages first');
    end if;
    if p_avg_ticket is null or p_avg_ticket <= 0 then
      return jsonb_build_object('ok', false, 'needs', 'avg_ticket',
        'reason', format('%s product pages are indexed but carry no prices (the site renders them in JS), '
                      || 'so a typical retail price is needed to value the demo covers', v_kb_products));
    end if;
    v_source := 'knowledge';
  end if;

  -- Deterministic: same brand → same demo, every run.
  perform setseed(((p_brand_id % 97)::numeric / 100.0)::double precision);

  v_hq_city    := coalesce(nullif(v_brand.hq_city, ''), 'Milano');
  v_hq_country := coalesce(nullif(v_brand.hq_country, ''), 'IT');

  -- ── Boutiques ──────────────────────────────────────────────────────────────
  -- The flagship in the brand's own HQ city, then a few marquee markets.
  for r in
    select * from (values
      (v_brand.name || ' — ' || v_hq_city, v_hq_city, v_hq_country),
      (v_brand.name || ' — Paris',   'Paris',   'FR'),
      (v_brand.name || ' — London',  'London',  'GB'),
      (v_brand.name || ' — New York','New York','US')
    ) as t(name, city, country)
  loop
    if not exists (select 1 from public.shops s where s.brand_id = p_brand_id and s.name = r.name) then
      insert into public.shops (brand_id, name, city, country, status)
      values (p_brand_id, r.name, r.city, r.country, 'active')
      returning id into v_cid;
      insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'shops', v_cid::text);
      v_shops := v_shops + 1;
    end if;
  end loop;

  -- ── Catalogue: the sellable subset, taken from their real pieces ──────────
  for r in
    select * from (
      select sp.name, sp.sku, sp.category, sp.collection, sp.description,
             sp.image_url, sp.price, sp.price_currency
      from public.storefront_products sp
      where v_source = 'storefront'
        and sp.brand_id = p_brand_id
        and sp.price is not null
        and coalesce(sp.category, '') <> 'HOME'
      union all
      -- Fallback: real product pages, demo prices spread ±45% around the ticket
      -- the caller declared.
      select d.title,
             nullif(regexp_replace(coalesce(d.source_url, ''), '^.*/([^/?]+)$', '\1'), ''),
             null, null, left(coalesce(d.content, ''), 400), null,
             round((p_avg_ticket * (0.55 + random() * 0.9))::numeric, -1), 'EUR'
      from public.brand_knowledge_docs d
      where v_source = 'knowledge'
        and d.brand_id = p_brand_id and d.category = 'product'
        and coalesce(d.title, '') <> ''
        -- Not every page classified as "product" IS one. Category and listing
        -- pages carry add-to-cart markup too, and their titles are site titles:
        -- "Pomellato Online Boutique | Jewelry - Rings, Earrings, Bracelets".
        -- One of those in a demo customer's covers reads as a bug.
        and d.title !~ '\|'
        and length(d.title) between 4 and 60
        and d.title !~* '(boutique|official (site|store)|online (shop|store)|^shop |^home$|^collections?$|sitemap|newsletter)'
    ) src
    order by random()
    limit greatest(p_policies, 40)
  loop
    insert into public.catalogues
      (brand_id, name, sku, category, collection, description, picture, price, price_currency, price_source)
    values
      (p_brand_id, r.name, r.sku, r.category, r.collection, left(coalesce(r.description, ''), 500),
       r.image_url, r.price, coalesce(r.price_currency, 'EUR'),
       case when v_source = 'storefront' then 'storefront' else 'demo' end)
    returning id into v_cid;
    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'catalogues', v_cid::text);
    v_items := v_items + 1;
  end loop;

  -- ── Clients ────────────────────────────────────────────────────────────────
  for i in 1..p_customers loop
    v_id := gen_random_uuid();
    declare
      -- A name this house has not used yet (see demo_unused_name); a repeat only once all
      -- 1,600 are taken.
      v_name text[] := coalesce(public.demo_unused_name(p_brand_id, v_first, v_last),
                                array[v_first[1 + floor(random() * array_length(v_first, 1))::int],
                                      v_last[1 + floor(random() * array_length(v_last, 1))::int]]);
      v_fn   text := v_name[1];
      v_ln   text := v_name[2];
      v_loc  jsonb := v_cities -> floor(random() * jsonb_array_length(v_cities))::int;
      v_reg  timestamptz := now() - (random() * 700 || ' days')::interval;
    begin
      insert into public.profiles
        (id, first_name, last_name, email, brand_id, role, status, city, country,
         date_of_birth, registered_at, created_at, is_visible)
      values
        (v_id, v_fn, v_ln,
         lower(regexp_replace(v_fn || '.' || v_ln, '[^a-zA-Z.]', '', 'g')) || i || '@demo.aioncover.com',
         p_brand_id, 'customer', 'active', v_loc ->> 'city', v_loc ->> 'country',
         (date '1965-01-01' + (random() * 12000)::int), v_reg, v_reg, true);
      insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'profiles', v_id::text);
      v_custs := v_custs + 1;
    end;
  end loop;

  -- ── Covers: who bought what, when, for how much ────────────────────────────
  -- A power-law-ish spread — a few clients with several pieces, a long tail with
  -- one — so segments, average ticket and repeat-rate all look like a real book.
  for i in 1..p_policies loop
    declare
      v_cust   uuid;
      v_item   record;
      v_shop   bigint;
      v_start  timestamptz;
      v_status text;
    begin
      -- Clients only. The brand's demo LOGINS are tagged as demo profiles too, so
      -- drawing from the tags alone handed covers to <slug>-admin and <slug>-sales,
      -- and the master login came out fifth among a quarter's top clients.
      select a.row_pk::uuid into v_cust
      from public.brand_demo_artifacts a
      join public.profiles p on p.id::text = a.row_pk
      where a.brand_id = p_brand_id and a.table_name = 'profiles'
        and p.role = 'customer'
      order by random() ^ 2 limit 1;

      -- Not from a men's line. Every demo client is a woman — v_first above is all women's
      -- names — so a cover on a menswear piece is a history no client of hers would have,
      -- and the assistant then either suggests men's swim shorts to her or refuses to
      -- suggest anything. A house that sells only menswear still gets covers.
      select c.id, c.price into v_item
      from public.catalogues c
      where c.brand_id = p_brand_id and c.price is not null
        and not public.is_menswear(c.collection, c.name)
      order by random() limit 1;
      if not found then
        select c.id, c.price into v_item
        from public.catalogues c
        where c.brand_id = p_brand_id and c.price is not null
        order by random() limit 1;
      end if;
      -- Belt as well as braces: a cover with no piece behind it is not a cover, and
      -- inserting one fails on a NOT NULL half a loop later with nothing said about why.
      if not found then continue; end if;

      select s.id into v_shop from public.shops s where s.brand_id = p_brand_id order by random() limit 1;

      -- Spread over ~2.5 years so the book has live covers, lapsed ones AND a
      -- handful expiring inside 30 days — otherwise the renewals screen, which
      -- is one of the sharper things to demo, comes up empty.
      v_start := now() - (random() * 900 || ' days')::interval;
      v_status := case when v_start + interval '730 days' < now() then 'expired' else 'live' end;

      insert into public.policies
        (brand_id, customer_id, item_id, shop_id, start_date, expiration_date, status,
         selling_price, recommended_retail_price, cogs, quantity, brand_sale_id, source, created_at)
      values
        (p_brand_id, v_cust, v_item.id, v_shop, v_start, v_start + interval '730 days', v_status,
         round(v_item.price::numeric, 2), round(v_item.price::numeric, 2),
         round((v_item.price * 0.42)::numeric, 2), 1,
         'DEMO-' || p_brand_id || '-' || i, 'demo', v_start)
      returning id into v_pid;
      insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'policies', v_pid::text);
      v_pols := v_pols + 1;

      -- ~8% of covers have a claim, so the claims screen isn't empty.
      if random() < 0.08 then
        insert into public.claims (policy_id, status, type, incident_date, incident_city, description, created_at)
        values (v_pid,
                (array['open','in_review','closed'])[1 + floor(random() * 3)::int],
                (array['damage','theft','loss'])[1 + floor(random() * 3)::int],
                v_start + (random() * 300 || ' days')::interval,
                (v_cities -> floor(random() * jsonb_array_length(v_cities))::int) ->> 'city',
                'Demo claim — generated for the platform preview.',
                v_start + (random() * 300 || ' days')::interval)
        returning id into v_cid;
        insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'claims', v_cid::text);
        v_claims := v_claims + 1;
      end if;
    end;
  end loop;

  -- ── Feedback, so satisfaction/NPS tiles have something to show ─────────────
  for r in
    select a.row_pk::uuid as cust
    from public.brand_demo_artifacts a
    where a.brand_id = p_brand_id and a.table_name = 'profiles'
    order by random() limit greatest(1, p_customers / 3)
  loop
    insert into public.feedback (brand_id, user_id, satisfaction_rate, recommendation_rate, peace_of_mind_rate, comment, created_at)
    values (p_brand_id, r.cust,
            3 + floor(random() * 3), 3 + floor(random() * 3), 3 + floor(random() * 3),
            (array['Beautiful service, very reassuring.',
                   'The activation in boutique was effortless.',
                   'Lovely piece and I feel it is properly looked after.',
                   'Would have liked more detail on what is covered.',
                   null])[1 + floor(random() * 5)::int],
            now() - (random() * 400 || ' days')::interval)
    returning id into v_cid;
    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'feedback', v_cid::text);
    v_fb := v_fb + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'brand_id', p_brand_id, 'catalogue_source', v_source,
    'shops', v_shops, 'catalogue', v_items, 'customers', v_custs,
    'policies', v_pols, 'claims', v_claims, 'feedback', v_fb,
    'prices', case when v_source = 'storefront' then 'real (from the brand catalogue)'
                   else format('demo, around EUR %s', p_avg_ticket) end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_brand_crm_depth(p_brand_id bigint, p_clients integer DEFAULT 320, p_visits integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Names and places are drawn TOGETHER, not independently.
  --
  -- The first version picked a name from one pool and a city from another, and
  -- produced "Noor Aaltonen, Italian" and "Oriane d'Aramon, Japanese". To any
  -- CRM team — whose whole job is knowing exactly who someone is — that reads
  -- as generated at a glance, which is the one thing demo data must not do. So
  -- each region carries its own names, and a client's name, city, dial code and
  -- nationality all come from the same entry.
  --
  -- The pool is deliberately a different one from the base generator's, so
  -- topping up never collides with a client it already created.
  v_regions jsonb := '[
    {"nat":"Italian","dial":"+39","country":"IT","cities":["Milano","Roma","Firenze"],
     "first":["Allegra","Costanza","Ginevra","Benedetta","Caterina","Emanuela","Flaminia","Ludovica","Bianca","Chiara"],
     "last":["Visconti","Borromeo","Ruspoli","Odescalchi","Caetani","Pallavicino","Torlonia","Marchetti","Falcone","Bonomi"]},
    {"nat":"British","dial":"+44","country":"GB","cities":["London"],
     "first":["Arabella","Cressida","Imogen","Rosamund","Tamsin","Verity","Cordelia","Seraphina"],
     "last":["Fitzwilliam","Hexham","Marchmont","Ravensworth","Thornbury","Wentworth","Alderley","Pembrooke"]},
    {"nat":"French","dial":"+33","country":"FR","cities":["Paris"],
     "first":["Solène","Albane","Oriane","Sidonie","Capucine","Anouk","Léonie","Maylis"],
     "last":["de Vaucelles","de Kergorlay","d''Aramon","Montalembert","Beauharnais","Lefèvre"]},
    {"nat":"Emirati","dial":"+971","country":"AE","cities":["Dubai"],
     "first":["Aisha","Noor","Rima","Yasmin","Zahra","Dalia","Farah","Leila"],
     "last":["Al Thani","Al Sabah","Bin Zayed","Kanoo","Chalhoub","Sifri"]},
    {"nat":"Chinese","dial":"+86","country":"CN","cities":["Shanghai","Hong Kong"],
     "first":["Xiulan","Wenjing","Yuxi","Jiahui","Lijuan","Shuang"],
     "last":["Zhang","Huang","Xu","Lin","Chen","Zhao"]},
    {"nat":"Japanese","dial":"+81","country":"JP","cities":["Tokyo"],
     "first":["Haruka","Sakura","Yuki","Rin","Mio","Kaede"],
     "last":["Nakamura","Ishikawa","Fujimoto","Takahashi","Sasaki","Kuroda"]},
    {"nat":"Korean","dial":"+82","country":"KR","cities":["Seoul"],
     "first":["Minji","Seoyeon","Jiwoo","Hyerin","Yerin","Soojin"],
     "last":["Park","Jeong","Kang","Yoon","Lim","Seo"]},
    {"nat":"Spanish","dial":"+34","country":"ES","cities":["Madrid"],
     "first":["Beatriz","Itziar","Macarena","Rocío","Carmen","Lucía"],
     "last":["Mendoza","Azcárate","Iturbe","Salgado","Navarro","Ortiz"]},
    {"nat":"American","dial":"+1","country":"US","cities":["New York","Los Angeles","Miami"],
     "first":["Charlotte","Eleanor","Harper","Vivian","Sloane","Margaux"],
     "last":["Whitmore","Ashworth","Carlisle","Beaumont","Fairchild","Hartley"]},
    {"nat":"Brazilian","dial":"+55","country":"BR","cities":["São Paulo"],
     "first":["Antonella","Valentina","Renata","Manuela","Isadora","Helena"],
     "last":["Salgado","Trentini","Marchetti","Barbosa","Almeida","Ribeiro"]},
    {"nat":"German","dial":"+49","country":"DE","cities":["München"],
     "first":["Astrid","Marlene","Wilhelmina","Eleonore","Greta","Johanna"],
     "last":["von Hohenau","Steinberg","Meister","Falkenrath","Brandt","Keller"]},
    {"nat":"Swiss","dial":"+41","country":"CH","cities":["Zürich"],
     "first":["Elsa","Annika","Ingrid","Nadine","Céline","Fabienne"],
     "last":["Bergqvist","Vandervelde","Lindgren","Zumthor","Rüegg","Bachmann"]}]'::jsonb;

  v_brand      record;
  v_have       integer;
  v_added      integer := 0;
  v_pols       integer := 0;
  v_claims     integer := 0;
  v_fb         integer := 0;
  v_events     integer := 0;
  v_att        integer := 0;
  v_vis        integer := 0;
  v_filled     integer := 0;
  i            integer;
  v_place      jsonb;
  v_id         uuid;
  v_pid        bigint;
  v_cid        bigint;
  v_eid        bigint;
  v_fn         text;
  v_ln         text;
  v_name       text[];
  v_email      text;
  r            record;
begin
  select * into v_brand from public.brands where id = p_brand_id;
  if v_brand is null then raise exception 'brand % not found', p_brand_id; end if;

  if not exists (select 1 from public.catalogues where brand_id = p_brand_id and price is not null) then
    return jsonb_build_object('ok', false,
      'reason', 'no priced catalogue yet — run generate_brand_demo_data first so there is something to have bought');
  end if;

  perform setseed((((p_brand_id * 7) % 89)::numeric / 100.0)::double precision);

  -- ── 1. The two fields a CRM team reaches for first ─────────────────────────
  -- Not a cosmetic gap: a client list with no phone number cannot be worked,
  -- and without a nationality the whole tourist-vs-local question — the first
  -- cut any luxury CRM makes — is unanswerable.
  for r in
    select p.id, p.country, p.city
    from public.profiles p
    where p.brand_id = p_brand_id
      and (p.role is null or p.role = 'customer')
      and (p.phone_number is null or p.nationality is null)
  loop
    -- For clients that already existed, the city is the fact we have; the dial
    -- code and nationality follow from it rather than being rolled at random.
    v_place := coalesce(
      (select e from jsonb_array_elements(v_regions) e
        where e -> 'cities' ? r.city or e ->> 'country' = r.country limit 1),
      v_regions -> 0);
    update public.profiles set
      phone_number = coalesce(phone_number,
        (v_place ->> 'dial') || ' ' || (300 + floor(random() * 699))::text || ' ' || lpad(floor(random() * 9999999)::text, 7, '0')),
      nationality  = coalesce(nationality, v_place ->> 'nat')
    where id = r.id;
    v_filled := v_filled + 1;
  end loop;

  -- ── 2. Enough clients to have to search ───────────────────────────────────
  select count(*) into v_have from public.profiles
   where brand_id = p_brand_id and (role is null or role = 'customer');

  for i in 1 .. greatest(0, p_clients - v_have) loop
    -- One region decides the name, the city, the dial code and the nationality — and the
    -- name is one this house has not used yet. A region whose names are all taken hands
    -- over to another, whole; only when every region is used up does a name repeat.
    v_place := v_regions -> floor(random() * jsonb_array_length(v_regions))::int;
    v_name := public.demo_unused_name(p_brand_id,
      array(select jsonb_array_elements_text(v_place -> 'first')),
      array(select jsonb_array_elements_text(v_place -> 'last')));
    if v_name is null then
      for r in select e from jsonb_array_elements(v_regions) e order by random() loop
        v_name := public.demo_unused_name(p_brand_id,
          array(select jsonb_array_elements_text(r.e -> 'first')),
          array(select jsonb_array_elements_text(r.e -> 'last')));
        if v_name is not null then v_place := r.e; exit; end if;
      end loop;
    end if;
    v_fn := coalesce(v_name[1], v_place -> 'first' ->> floor(random() * jsonb_array_length(v_place -> 'first'))::int);
    v_ln := coalesce(v_name[2], v_place -> 'last'  ->> floor(random() * jsonb_array_length(v_place -> 'last'))::int);
    -- The offset keeps these clear of the base generator's own numbering.
    v_email := lower(regexp_replace(v_fn || '.' || v_ln, '[^a-zA-Z.]', '', 'g')) || (1000 + i) || '@demo.aioncover.com';
    v_id := gen_random_uuid();

    insert into public.profiles
      (id, first_name, last_name, email, phone_number, brand_id, role, status,
       city, country, nationality, date_of_birth, registered_at, created_at, is_visible,
       province, postcode)
    values
      (v_id, v_fn, v_ln, v_email,
       (v_place ->> 'dial') || ' ' || (300 + floor(random() * 699))::text || ' ' || lpad(floor(random() * 9999999)::text, 7, '0'),
       -- 'customer', not null: a generated client is a client, and the NULL
       -- this used to copy from the base generator cost three bugs in a day
       -- (see 20260915000006).
       p_brand_id, 'customer', 'active',
       (v_place -> 'cities' ->> floor(random() * jsonb_array_length(v_place -> 'cities'))::int),
       v_place ->> 'country', v_place ->> 'nat',
       (date '1960-01-01' + (random() * 16000)::int),
       -- Spread over three years, so "registered this quarter" and "hasn't been
       -- seen since 2024" are both real cuts of the same list.
       now() - (random() * 1080 || ' days')::interval,
       now() - (random() * 1080 || ' days')::interval, true,
       -- NOTE: there is no acquisition-source column on profiles in this
       -- database (types.ts still declares utm_source/utm_medium; the table has
       -- neither), so the boutique-vs-online split a CRM team segments on
       -- cannot be represented here. Left out rather than faked into a field
       -- that means something else.
       null, null);
    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk)
    values (p_brand_id, 'profiles', v_id::text);
    v_added := v_added + 1;

    -- A power law, not a flat rate: a few clients with a real history, most
    -- with one piece, and some with none at all — which is what makes "lapsed"
    -- and "one-time buyer" meaningful rather than decorative.
    declare
      v_n integer := case
        when random() < 0.08 then 3 + floor(random() * 4)::int
        when random() < 0.45 then 1
        when random() < 0.75 then 2
        else 0 end;
      j integer;
      v_item record;
      v_shop bigint;
      v_start timestamptz;
    begin
      for j in 1 .. v_n loop
        -- Not from a men's line: every client here is a woman too (see is_menswear).
        select c.id, c.price into v_item from public.catalogues c
         where c.brand_id = p_brand_id and c.price is not null
           and not public.is_menswear(c.collection, c.name)
         order by random() limit 1;
        if not found then
          select c.id, c.price into v_item from public.catalogues c
           where c.brand_id = p_brand_id and c.price is not null order by random() limit 1;
        end if;
        select s.id into v_shop from public.shops s where s.brand_id = p_brand_id order by random() limit 1;
        v_start := now() - (random() * 1080 || ' days')::interval;

        insert into public.policies
          (brand_id, customer_id, item_id, shop_id, start_date, expiration_date, status,
           selling_price, recommended_retail_price, cogs, quantity, brand_sale_id, source, created_at)
        values
          (p_brand_id, v_id, v_item.id, v_shop, v_start, v_start + interval '730 days',
           case when v_start + interval '730 days' < now() then 'expired' else 'live' end,
           round(v_item.price::numeric, 2), round(v_item.price::numeric, 2),
           round((v_item.price * 0.42)::numeric, 2), 1,
           'DEMO-CRM-' || p_brand_id || '-' || i || '-' || j, 'demo', v_start)
        returning id into v_pid;
        insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'policies', v_pid::text);
        v_pols := v_pols + 1;

        if random() < 0.07 then
          insert into public.claims (policy_id, status, type, incident_date, incident_city, description, created_at)
          values (v_pid,
                  (array['open','in_review','closed'])[1 + floor(random() * 3)::int],
                  (array['damage','theft','loss'])[1 + floor(random() * 3)::int],
                  v_start + (random() * 300 || ' days')::interval,
                  (v_place -> 'cities' ->> 0),
                  'Demo claim — generated for the platform preview.',
                  v_start + (random() * 300 || ' days')::interval)
          returning id into v_cid;
          insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'claims', v_cid::text);
          v_claims := v_claims + 1;
        end if;
      end loop;
    end;

    if random() < 0.22 then
      insert into public.feedback (brand_id, user_id, satisfaction_rate, recommendation_rate, peace_of_mind_rate, comment, created_at)
      values (p_brand_id, v_id, 3 + floor(random() * 3), 3 + floor(random() * 3), 3 + floor(random() * 3),
              (array['Impeccable, as always.',
                     'The sales associate remembered what I bought last time — that is why I come back.',
                     'I was not told the piece would take three weeks.',
                     'Lovely boutique, the appointment made all the difference.',
                     null])[1 + floor(random() * 5)::int],
              now() - (random() * 500 || ' days')::interval)
      returning id into v_cid;
      insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'feedback', v_cid::text);
      v_fb := v_fb + 1;
    end if;
  end loop;

  -- ── 3. Trunk shows, invited, attended, converted ───────────────────────────
  -- The one thing a clienteling team measures itself on and the table was empty.
  -- Three, deliberately: one finished and paid for, one just happened and still
  -- has follow-ups owed, one still to come with an agenda to work.
  for r in
    select * from (values
      ('Private View — Autumn Collection', 'Milano',   'IT', 'Palazzo Serbelloni', (current_date - 120), 'completed', 42000::numeric),
      ('Clients'' Evening — Bond Street',   'London',   'GB', 'The Arts Club',      (current_date - 21),  'completed', 28500::numeric),
      ('Trunk Show — Resort',               'Dubai',    'AE', 'Bulgari Resort',     (current_date + 34),  'planned',   null::numeric)
    ) as t(name, city, country, venue, start_date, status, revenue)
  loop
    if not exists (select 1 from public.events e where e.brand_id = p_brand_id and e.name = r.name) then
      insert into public.events
        (brand_id, name, city, country, venue, start_date, end_date, status,
         pr_agency, pr_cost, venue_cost, shipping_cost, other_cost,
         guests_invited, guests_attended, revenue, currency, notes)
      values
        (p_brand_id, r.name, r.city, r.country, r.venue, r.start_date, r.start_date + 2, r.status,
         'Karla Otto', 12000, 18000, 3500, 2400,
         60, case when r.status = 'completed' then 38 else 0 end,
         r.revenue, 'EUR',
         'Demo event — generated for the platform preview.')
      returning id into v_eid;
      insert into public.brand_demo_artifacts (brand_id, table_name, row_pk) values (p_brand_id, 'events', v_eid::text);
      v_events := v_events + 1;

      -- The guest list, drawn from the brand's own book.
      declare v_att_row record; v_att_i integer := 0; begin
        for v_att_row in
          select p.id, p.first_name, p.last_name, p.email, p.phone_number
          from public.profiles p
          where p.brand_id = p_brand_id and (p.role is null or p.role = 'customer')
          order by random() limit 30
        loop
          v_att_i := v_att_i + 1;
          insert into public.event_attendees
            (event_id, brand_id, customer_id, customer_name, segment, invited, attended,
             influencer, converted, revenue, email, phone, appointment_date, appointment_time, venue, notes)
          values
            (v_eid, p_brand_id, v_att_row.id,
             trim(coalesce(v_att_row.first_name,'') || ' ' || coalesce(v_att_row.last_name,'')),
             (array['VIC','loyal','prospect','press'])[1 + floor(random() * 4)::int],
             true,
             r.status = 'completed' and random() < 0.63,
             case when random() < 0.15 then (array['@materamoda','@milanostyle','@thegulfedit'])[1 + floor(random() * 3)::int] else null end,
             r.status = 'completed' and random() < 0.28,
             case when r.status = 'completed' and random() < 0.28 then round((600 + random() * 5400)::numeric, 2) else null end,
             v_att_row.email, v_att_row.phone_number,
             r.start_date,
             -- An agenda: a slot each, and some guests deliberately left without
             -- one, because an open invitation is a real state and dropping
             -- those guests from the list is how a team loses them.
             case when random() < 0.78 then (time '10:00' + (v_att_i * interval '20 minutes')) else null end,
             r.venue,
             null);
          v_att := v_att + 1;
        end loop;
      end;
    end if;
  end loop;

  -- ── 4. Visits, spread wide enough to see a pattern ─────────────────────────
  -- generate_brand_demo_visits writes fourteen hand-written afternoons. Good
  -- for reading; useless for testing a filter. These fill the months behind
  -- them, across every boutique, so "which shop loses the most sales to size"
  -- is a question with an answer.
  declare
    v_pool jsonb;
    v_t jsonb;
    v_cust uuid;
    v_shop bigint;
    v_when timestamptz;
    v_out text;
    v_have_v integer;
  begin
    select count(*) into v_have_v from public.store_visits where brand_id = p_brand_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'summary', summary, 'objection', objection, 'items', items,
             'transcript', transcript, 'occasion', occasion, 'tags', tags,
             'follow_up', follow_up, 'language', language)), '[]'::jsonb)
      into v_pool
    from public.store_visits where brand_id = p_brand_id and summary is not null;

    if jsonb_array_length(v_pool) > 0 then
      for i in 1 .. greatest(0, p_visits - v_have_v) loop
        v_t := v_pool -> floor(random() * jsonb_array_length(v_pool))::int;
        select p.id into v_cust from public.profiles p
         where p.brand_id = p_brand_id and (p.role is null or p.role = 'customer')
         order by random() limit 1;
        select s.id into v_shop from public.shops s where s.brand_id = p_brand_id order by random() limit 1;
        v_when := now() - (random() * 180 || ' days')::interval;
        -- Half end without a sale. That is the shape of a real afternoon and
        -- the half no CRM has ever held.
        v_out := case when random() < 0.50 then 'not_purchased'
                      when random() < 0.72 then 'purchased' else 'undecided' end;
        -- Two in five are walk-ins nobody has a name for.
        if random() < 0.40 then v_cust := null; end if;

        insert into public.store_visits
          (brand_id, shop_id, recorded_by, customer_id, customer_said, match_confidence,
           visited_at, source, transcript, language, outcome, summary, items, objection,
           occasion, sentiment, follow_up, follow_up_due, tags, status, needs_review,
           confirmed_at, created_at)
        values
          (p_brand_id, v_shop,
           (select id from public.profiles where brand_id = p_brand_id
             and role in ('brand','brand_admin','brand_user') order by random() limit 1),
           v_cust,
           case when v_cust is null then null else
             (select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
                from public.profiles where id = v_cust) end,
           case when v_cust is null then 'none' else 'exact' end,
           v_when, 'voice', v_t ->> 'transcript', coalesce(v_t ->> 'language', 'it'),
           v_out, v_t ->> 'summary',
           coalesce(v_t -> 'items', '[]'::jsonb),
           case when v_out = 'purchased' then null else v_t ->> 'objection' end,
           v_t ->> 'occasion',
           case v_out when 'purchased' then 'positive' when 'undecided' then 'neutral' else
             (array['neutral','negative'])[1 + floor(random() * 2)::int] end,
           case when v_out = 'purchased' then null else v_t ->> 'follow_up' end,
           case when v_out <> 'purchased' and random() < 0.6
                then (v_when + (random() * 30 || ' days')::interval)::date else null end,
           case when jsonb_typeof(v_t -> 'tags') = 'array'
                then array(select jsonb_array_elements_text(v_t -> 'tags')) else '{}'::text[] end,
           'confirmed', false, v_when, v_when)
        returning id into v_id;
        insert into public.brand_demo_artifacts (brand_id, table_name, row_pk)
        values (p_brand_id, 'store_visits', v_id::text);
        v_vis := v_vis + 1;
      end loop;
    end if;
  end;

  return jsonb_build_object(
    'ok', true, 'brand_id', p_brand_id,
    'contact_details_filled', v_filled, 'clients_added', v_added,
    'covers', v_pols, 'claims', v_claims, 'feedback', v_fb,
    'events', v_events, 'attendees', v_att, 'visits', v_vis);
end;
$function$;

-- ── The books already written ───────────────────────────────────────────────
-- Every demo client whose name an earlier demo client of the same house already carries is
-- renamed; the earliest keeps it. The new name comes from the region of her nationality, so
-- her city, dial code and nationality still agree with it, and her email follows the name
-- (its number stays). Generated clients only — logged in nobody (user_id), so the demo
-- client login, "Demo Client", is out of it.
--
-- Three places copied a client's name when they were written, and follow her: a guest list
-- (event_attendees, event_items) and the name an associate gave on a visit (store_visits).
-- Covers, claims and feedback hold her id, not her name.
do $$
declare
  -- generate_brand_crm_depth's regions, verbatim.
  v_regions jsonb := '[
    {"nat":"Italian","dial":"+39","country":"IT","cities":["Milano","Roma","Firenze"],
     "first":["Allegra","Costanza","Ginevra","Benedetta","Caterina","Emanuela","Flaminia","Ludovica","Bianca","Chiara"],
     "last":["Visconti","Borromeo","Ruspoli","Odescalchi","Caetani","Pallavicino","Torlonia","Marchetti","Falcone","Bonomi"]},
    {"nat":"British","dial":"+44","country":"GB","cities":["London"],
     "first":["Arabella","Cressida","Imogen","Rosamund","Tamsin","Verity","Cordelia","Seraphina"],
     "last":["Fitzwilliam","Hexham","Marchmont","Ravensworth","Thornbury","Wentworth","Alderley","Pembrooke"]},
    {"nat":"French","dial":"+33","country":"FR","cities":["Paris"],
     "first":["Solène","Albane","Oriane","Sidonie","Capucine","Anouk","Léonie","Maylis"],
     "last":["de Vaucelles","de Kergorlay","d''Aramon","Montalembert","Beauharnais","Lefèvre"]},
    {"nat":"Emirati","dial":"+971","country":"AE","cities":["Dubai"],
     "first":["Aisha","Noor","Rima","Yasmin","Zahra","Dalia","Farah","Leila"],
     "last":["Al Thani","Al Sabah","Bin Zayed","Kanoo","Chalhoub","Sifri"]},
    {"nat":"Chinese","dial":"+86","country":"CN","cities":["Shanghai","Hong Kong"],
     "first":["Xiulan","Wenjing","Yuxi","Jiahui","Lijuan","Shuang"],
     "last":["Zhang","Huang","Xu","Lin","Chen","Zhao"]},
    {"nat":"Japanese","dial":"+81","country":"JP","cities":["Tokyo"],
     "first":["Haruka","Sakura","Yuki","Rin","Mio","Kaede"],
     "last":["Nakamura","Ishikawa","Fujimoto","Takahashi","Sasaki","Kuroda"]},
    {"nat":"Korean","dial":"+82","country":"KR","cities":["Seoul"],
     "first":["Minji","Seoyeon","Jiwoo","Hyerin","Yerin","Soojin"],
     "last":["Park","Jeong","Kang","Yoon","Lim","Seo"]},
    {"nat":"Spanish","dial":"+34","country":"ES","cities":["Madrid"],
     "first":["Beatriz","Itziar","Macarena","Rocío","Carmen","Lucía"],
     "last":["Mendoza","Azcárate","Iturbe","Salgado","Navarro","Ortiz"]},
    {"nat":"American","dial":"+1","country":"US","cities":["New York","Los Angeles","Miami"],
     "first":["Charlotte","Eleanor","Harper","Vivian","Sloane","Margaux"],
     "last":["Whitmore","Ashworth","Carlisle","Beaumont","Fairchild","Hartley"]},
    {"nat":"Brazilian","dial":"+55","country":"BR","cities":["São Paulo"],
     "first":["Antonella","Valentina","Renata","Manuela","Isadora","Helena"],
     "last":["Salgado","Trentini","Marchetti","Barbosa","Almeida","Ribeiro"]},
    {"nat":"German","dial":"+49","country":"DE","cities":["München"],
     "first":["Astrid","Marlene","Wilhelmina","Eleonore","Greta","Johanna"],
     "last":["von Hohenau","Steinberg","Meister","Falkenrath","Brandt","Keller"]},
    {"nat":"Swiss","dial":"+41","country":"CH","cities":["Zürich"],
     "first":["Elsa","Annika","Ingrid","Nadine","Céline","Fabienne"],
     "last":["Bergqvist","Vandervelde","Lindgren","Zumthor","Rüegg","Bachmann"]}]'::jsonb;
  r        record;
  v_place  jsonb;
  v_moved  boolean;
  v_name   text[];
  v_email  text;
  v_full   text;
  v_done   integer := 0;
begin
  for r in
    select d.id, d.brand_id, d.nationality, d.country, d.city, d.email, d.phone_number
      from (select p.*, row_number() over (
                     partition by p.brand_id, p.first_name, p.last_name order by p.created_at, p.id) as rn
              from public.profiles p
             where p.role = 'customer' and p.user_id is null
               and p.email like '%@demo.aioncover.com'
               and exists (select 1 from public.brand_demo_artifacts a
                            where a.brand_id = p.brand_id and a.table_name = 'profiles'
                              and a.row_pk = p.id::text)) d
     where d.rn > 1
     order by d.brand_id, d.created_at, d.id
  loop
    -- Her region: by nationality first (depth clients carry it from birth), then by city.
    select e into v_place
      from jsonb_array_elements(v_regions) e
     where e ->> 'nat' = r.nationality or e -> 'cities' ? r.city or e ->> 'country' = r.country
     order by (e ->> 'nat' = r.nationality) desc nulls last, (e -> 'cities' ? r.city) desc
     limit 1;
    v_moved := false;
    v_name := case when v_place is null then null else public.demo_unused_name(r.brand_id,
      array(select jsonb_array_elements_text(v_place -> 'first')),
      array(select jsonb_array_elements_text(v_place -> 'last'))) end;
    if v_name is null then
      -- Her region is used up (or she has none): another one, and she moves with it.
      for v_place in select e from jsonb_array_elements(v_regions) e order by random() loop
        v_name := public.demo_unused_name(r.brand_id,
          array(select jsonb_array_elements_text(v_place -> 'first')),
          array(select jsonb_array_elements_text(v_place -> 'last')));
        if v_name is not null then v_moved := true; exit; end if;
      end loop;
    end if;
    continue when v_name is null;

    v_email := lower(regexp_replace(v_name[1] || '.' || v_name[2], '[^a-zA-Z.]', '', 'g'))
            || coalesce(substring(r.email from '(\d+)@'), '') || '@demo.aioncover.com';
    if exists (select 1 from public.profiles where brand_id = r.brand_id and email = v_email) then
      v_email := replace(v_email, '@', '.' || left(r.id::text, 4) || '@');
    end if;

    update public.profiles set
      first_name = v_name[1], last_name = v_name[2], email = v_email,
      city        = case when v_moved then v_place -> 'cities' ->> 0 else city end,
      country     = case when v_moved then v_place ->> 'country' else country end,
      nationality = case when v_moved then v_place ->> 'nat' else nationality end,
      phone_number = case when v_moved and phone_number is not null
                          then regexp_replace(phone_number, '^\+\d+', v_place ->> 'dial') else phone_number end
     where id = r.id;

    v_full := v_name[1] || ' ' || v_name[2];
    update public.event_attendees set customer_name = v_full, email = v_email where customer_id = r.id;
    update public.event_items     set customer_name = v_full where customer_id = r.id;
    update public.store_visits    set customer_said = v_full where customer_id = r.id and customer_said is not null;
    v_done := v_done + 1;
  end loop;
  raise notice 'renamed % demo clients', v_done;
end $$;
