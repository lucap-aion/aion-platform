-- generate_brand_demo_data(brand_id, customers, policies) — a believable book of
-- business for a brand nobody has sold to yet, so the platform demos full.
--
-- Everything is derived from the brand's OWN scraped catalogue: the pieces, the
-- prices and the currency are really theirs, so the dashboards, covers, customer
-- histories and the assistant all read like a live account of THAT house rather
-- than generic filler. What we invent is only the people and the dates.
--
-- Every inserted row is logged in brand_demo_artifacts, so purge_brand_demo_data()
-- removes the demo completely before the account goes live. Nothing touches rows
-- the function didn't create.
--
-- Deterministic per brand (seeded random), so re-running gives the same demo.

-- Two catalogue sources, in order of truthfulness:
--   1. storefront_products — real pieces AND real prices (Shopify shops).
--   2. the indexed product pages — real pieces, no prices. Sites that render
--      prices in JS (Pomellato) leave nothing to scrape, so the caller passes
--      p_avg_ticket and cover values are drawn around it. Those are DECLARED
--      demo prices, not the brand's; the pieces themselves are still real.
drop function if exists public.generate_brand_demo_data(bigint, integer, integer);

create or replace function public.generate_brand_demo_data(
  p_brand_id   bigint,
  p_customers  integer default 40,
  p_policies   integer default 60,
  p_avg_ticket numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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

  select count(*) into v_products from public.storefront_products where brand_id = p_brand_id;
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
      v_fn   text := v_first[1 + floor(random() * array_length(v_first, 1))::int];
      v_ln   text := v_last[1 + floor(random() * array_length(v_last, 1))::int];
      v_loc  jsonb := v_cities -> floor(random() * jsonb_array_length(v_cities))::int;
      v_reg  timestamptz := now() - (random() * 700 || ' days')::interval;
    begin
      insert into public.profiles
        (id, first_name, last_name, email, brand_id, role, status, city, country,
         date_of_birth, registered_at, created_at, is_visible)
      values
        (v_id, v_fn, v_ln,
         lower(regexp_replace(v_fn || '.' || v_ln, '[^a-zA-Z.]', '', 'g')) || i || '@demo.aioncover.com',
         p_brand_id, null, 'active', v_loc ->> 'city', v_loc ->> 'country',
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
      select a.row_pk::uuid into v_cust
      from public.brand_demo_artifacts a
      where a.brand_id = p_brand_id and a.table_name = 'profiles'
      order by random() ^ 2 limit 1;

      select c.id, c.price into v_item
      from public.catalogues c
      where c.brand_id = p_brand_id and c.price is not null
      order by random() limit 1;

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
$$;

-- Take it all back out. Only rows this generator created, newest dependency first.
create or replace function public.purge_brand_demo_data(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; t text; n integer;
begin
  foreach t in array array['feedback','claims','policies','catalogues','profiles','shops'] loop
    execute format(
      'delete from public.%I where id::text in (
         select row_pk from public.brand_demo_artifacts
         where brand_id = $1 and table_name = $2)', t)
      using p_brand_id, t;
    get diagnostics n = row_count;
    v_out := v_out || jsonb_build_object(t, n);
    delete from public.brand_demo_artifacts where brand_id = p_brand_id and table_name = t;
  end loop;
  return jsonb_build_object('ok', true, 'deleted', v_out);
end;
$$;

revoke all on function public.generate_brand_demo_data(bigint, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.purge_brand_demo_data(bigint) from public, anon, authenticated;
grant execute on function public.generate_brand_demo_data(bigint, integer, integer, numeric) to service_role;
grant execute on function public.purge_brand_demo_data(bigint) to service_role;
