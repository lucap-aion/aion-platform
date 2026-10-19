-- A book of business a CRM team can actually work with.
--
-- generate_brand_demo_data builds enough to make the screens look alive: forty
-- clients, sixty covers, a handful of claims. That is a demo of the PRODUCT.
-- It is not enough to be a demo of the JOB — a head of CRM opens a platform and
-- immediately tries to do their work in it: filter to the clients they can
-- actually call, find the ones who have not bought in a year, see who came to
-- the last trunk show and who converted. Forty clients with no phone numbers
-- and no events answers none of that.
--
-- So this adds the depth, and only the depth. It does not touch what is already
-- there except to fill in the two fields every CRM team reaches for first and
-- the generator leaves empty: a phone number and a nationality. Everything it
-- creates is logged in brand_demo_artifacts, so the purge still takes the whole
-- demo away before a house goes live.
--
-- Rerunnable: it tops up to the targets rather than adding another full set.

create or replace function public.generate_brand_crm_depth(
  p_brand_id bigint,
  p_clients  integer default 320,
  p_visits   integer default 80
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
    -- One region decides the name, the city, the dial code and the nationality.
    v_place := v_regions -> floor(random() * jsonb_array_length(v_regions))::int;
    v_fn := (v_place -> 'first' ->> floor(random() * jsonb_array_length(v_place -> 'first'))::int);
    v_ln := (v_place -> 'last'  ->> floor(random() * jsonb_array_length(v_place -> 'last'))::int);
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
        select c.id, c.price into v_item from public.catalogues c
         where c.brand_id = p_brand_id and c.price is not null order by random() limit 1;
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
$$;

-- Events were never in the purge list, so a demo left them behind.
create or replace function public.purge_brand_demo_data(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; t text; n integer;
begin
  foreach t in array array['store_visits','feedback','claims','policies','events','catalogues','profiles','shops'] loop
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

revoke all on function public.generate_brand_crm_depth(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.generate_brand_crm_depth(bigint, integer, integer) to service_role;
