-- A demo brand with no visits is a demo of the wrong product.
--
-- generate_brand_demo_data() builds a believable book of business — clients,
-- covers, claims — and every row of it starts at a purchase, because that is
-- what the platform held until store_visits existed. A prospect opening the
-- Visits page would find it empty, which is precisely the impression the
-- feature exists to correct.
--
-- So: the same treatment. The pieces are the brand's own (real names, real
-- SKUs, from their catalogue); the people, the dates and the conversations are
-- invented. Deterministic per brand, and logged in brand_demo_artifacts so the
-- purge takes it away with everything else before a house goes live.
--
-- The distribution is not decorative. Half of these visits end WITHOUT a sale,
-- because that is the real shape of a boutique afternoon and it is the half no
-- CRM has ever held. A demo where everyone buys proves nothing.

create or replace function public.generate_brand_demo_visits(
  p_brand_id bigint,
  p_visits   integer default 14
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- Each template is one afternoon. The objection is written the way a manager
  -- would actually say it — the whole point is that these do NOT collapse into
  -- three tidy categories.
  v_t jsonb := '[
    {"outcome":"purchased","lang":"it","sent":"positive","days":2,"occ":"self",
     "sum":"Cliente abituale, ha preso la borsa che aveva visto online la settimana scorsa.",
     "obj":null,"fu":"Mandarle una foto quando arriva la capsule di primavera","fud":24,
     "tags":["vip","repeat"],
     "tx":"Allora, è tornata la signora che era passata sabato. Aveva già visto la borsa sul sito, l''ha provata, l''ha presa subito. Le ho detto che a marzo arriva la capsule e mi ha chiesto di mandarle una foto appena la vedo."},

    {"outcome":"not_purchased","lang":"it","sent":"neutral","days":2,"occ":"self",
     "sum":"Voleva la 38, in negozio c''era solo la 42. Non ha comprato.",
     "obj":"Non c''era la sua taglia e non voleva ordinarla senza provarla","fu":"Chiamarla quando rientra la 38","fud":5,
     "tags":["stockout"],
     "tx":"Signora giovane, molto decisa, sapeva esattamente cosa voleva. Purtroppo avevamo solo la 42. Le ho proposto di ordinarla ma non se la sentiva senza provarla prima. Le ho preso il numero, la chiamo appena rientra la 38."},

    {"outcome":"not_purchased","lang":"it","sent":"positive","days":3,"occ":"gift",
     "sum":"Cercava un regalo per la moglie, tornerà con lei.",
     "obj":"Aspetta che lo veda lei, non voleva sbagliare taglia","fu":"Tenere da parte il modello fino a domenica","fud":4,
     "tags":["gift"],
     "tx":"È entrato un signore, cercava un regalo per l''anniversario. Gli è piaciuto molto un capo ma aveva paura di sbagliare la taglia, ha detto che torna con la moglie nel weekend. Gli ho detto che glielo teniamo da parte fino a domenica."},

    {"outcome":"undecided","lang":"it","sent":"neutral","days":4,"occ":"self",
     "sum":"Ha provato tre capi, ci pensa. Non è il prezzo, è che ne ha già uno simile.",
     "obj":"Dice che ha già qualcosa di molto simile nell''armadio","fu":"Proporle qualcosa di diverso, non lo stesso modello","fud":10,
     "tags":["repeat"],
     "tx":"Cliente che conosciamo, viene spesso. Ha provato tre cose, stava bene ma continuava a dire che ne ha già uno uguale. Non è una questione di prezzo, è che le proponiamo sempre la stessa roba. La prossima volta le faccio vedere altro."},

    {"outcome":"purchased","lang":"en","sent":"positive","days":5,"occ":"travel",
     "sum":"Tourist from Singapore, bought two pieces, asked about shipping home.",
     "obj":null,"fu":"Send her the tax refund paperwork by email","fud":1,
     "tags":["tourist"],
     "tx":"A lady from Singapore came in this morning, spent about forty minutes, took two pieces. She asked whether we could ship to the hotel and about the tax refund — I said I would email her the paperwork today."},

    {"outcome":"not_purchased","lang":"it","sent":"negative","days":6,"occ":"self",
     "sum":"Ha guardato il cartellino due volte e ha chiesto se facciamo sconti.",
     "obj":"Prezzo — si aspettava una cifra sotto i mille","fu":null,"fud":null,
     "tags":["price-sensitive","first-visit"],
     "tx":"Prima volta che la vedo. Le piaceva molto ma ha guardato il prezzo due volte e mi ha chiesto se facciamo sconti o se conviene aspettare. Le ho spiegato che non facciamo saldi su questa linea e se n''è andata."},

    {"outcome":"not_purchased","lang":"it","sent":"neutral","days":7,"occ":"wedding",
     "sum":"Le serviva per un matrimonio sabato, non arrivava in tempo.",
     "obj":"Tempi di consegna — il matrimonio è sabato e l''ordine non arriva prima","fu":"Richiamarla, ha detto che le serve comunque qualcosa per settembre","fud":-2,
     "tags":["wedding"],
     "tx":"Cercava qualcosa per un matrimonio sabato prossimo. Quello che voleva non ce l''avevamo e l''ordine non arrivava in tempo. Però mi ha detto che a settembre ha un altro evento, quindi la richiamo."},

    {"outcome":"purchased","lang":"it","sent":"positive","days":8,"occ":"self",
     "sum":"Compra due volte l''anno, sempre a inizio stagione. Ha preso il capo che aveva messo da parte.",
     "obj":null,"fu":"Avvisarla per il pre-order della prossima stagione","fud":45,
     "tags":["vip","repeat"],
     "tx":"La signora che viene sempre a inizio stagione. Aveva messo da parte un capo la settimana scorsa, oggi è tornata e l''ha preso. Mi ha chiesto di avvisarla in anticipo per la prossima collezione, dice che preferisce scegliere prima che arrivi tutta la gente."},

    {"outcome":"not_purchased","lang":"en","sent":"neutral","days":9,"occ":"self",
     "sum":"Loved it, but said it was too heavy for the travelling she does.",
     "obj":"Too heavy — she travels constantly and wanted something lighter","fu":"Show her the lighter line when it lands","fud":14,
     "tags":["tourist"],
     "tx":"She really liked it, tried it twice, but she said it was too heavy — she flies every week and wants something she can carry. Nothing we had was light enough. Worth calling her when the lighter pieces arrive."},

    {"outcome":"undecided","lang":"it","sent":"positive","days":10,"occ":"gift",
     "sum":"Regalo per la figlia, vuole prima chiederle il colore.",
     "obj":"Non sapeva che colore preferisse la figlia","fu":"Le mando le foto dei due colori su WhatsApp","fud":2,
     "tags":["gift"],
     "tx":"Voleva fare un regalo alla figlia per la laurea. Era indecisa fra due colori e non voleva rischiare. Le ho detto che le mando le foto di tutti e due su WhatsApp così glielo chiede."},

    {"outcome":"not_purchased","lang":"it","sent":"negative","days":12,"occ":"self",
     "sum":"Aveva già comprato la stessa cosa da un''altra parte la settimana scorsa.",
     "obj":"L''ha comprata da un multimarca a Roma sette giorni fa","fu":null,"fud":null,
     "tags":["lost-to-competitor"],
     "tx":"Peccato, questa l''abbiamo persa. Cercava esattamente quel modello ma me l''ha detto lei: l''ha trovato a Roma la settimana scorsa e l''ha preso lì. Era passata solo per vedere il resto."},

    {"outcome":"not_purchased","lang":"en","sent":"neutral","days":14,"occ":"travel",
     "sum":"Flying back to Seoul the next morning, did not want to carry it.",
     "obj":"Leaving the country tomorrow and did not want it in her luggage","fu":"Offer shipping next time — she asked whether we deliver abroad","fud":null,
     "tags":["tourist","shipping"],
     "tx":"She was very close to buying, honestly. The only thing stopping her was that she flies back to Seoul tomorrow morning and did not want to carry it. She asked if we ship abroad and I was not sure what to tell her."},

    {"outcome":"purchased","lang":"it","sent":"positive","days":16,"occ":"anniversary",
     "sum":"Anniversario, ha preso il capo e ha chiesto il confezionamento regalo.",
     "obj":null,"fu":"Segnare la data, è il loro anniversario ogni anno a settembre","fud":350,
     "tags":["gift","anniversary"],
     "tx":"Coppia molto simpatica, per l''anniversario. Hanno preso una cosa sola ma importante, con il pacchetto regalo. Mi sono segnato la data perché tornano ogni anno più o meno in questo periodo."},

    {"outcome":"not_purchased","lang":"it","sent":"neutral","days":18,"occ":"self",
     "sum":"Voleva il nero, c''era solo il beige. Non le interessava il beige.",
     "obj":"Colore — cercava il nero e il beige non lo prende nemmeno in considerazione","fu":"Chiamarla se rientra in nero","fud":-5,
     "tags":["stockout"],
     "tx":"Sapeva già cosa voleva, l''aveva visto addosso a un''amica. Lo voleva nero. Avevamo solo il beige e non ne ha voluto sapere. Ho preso il numero, se rientra in nero la chiamo."}
  ]'::jsonb;

  v_n        integer := 0;
  v_staff    uuid[];
  v_custs    uuid[];
  v_shop     bigint;
  v_prods    jsonb;
  v_item     jsonb;
  v_id       uuid;
  v_cust     uuid;
  v_i        integer;
  v_days     integer;
  v_fud      integer;
begin
  -- Staff to attribute the notes to. Without one the rows still stand; they
  -- just lose "who is keeping the floor's memory", which is a real question a
  -- head of CRM asks.
  -- Allowlist, not "anyone who isn't a customer": generated clients carry role
  -- NULL, so the lazy test would attribute the shop floor's notes to the
  -- clients themselves (see 20260915000003).
  select array_agg(id) into v_staff
  from (select id from public.profiles
         where brand_id = p_brand_id and role in ('brand','brand_admin','brand_user')
         order by id limit 5) s;

  -- ...and the same NULL is why clients are matched on the other side of it.
  select array_agg(id) into v_custs
  from (select id from public.profiles
         where brand_id = p_brand_id and (role is null or role = 'customer')
         order by id limit 40) c;

  select id into v_shop from public.shops
   where brand_id = p_brand_id order by id limit 1;

  -- The brand's own pieces, so a demo visit names something that exists.
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'sku', sku)), '[]'::jsonb)
    into v_prods
  from (select name, sku from public.storefront_products
         where brand_id = p_brand_id and name is not null
         order by id limit 40) p;

  -- Rebuild rather than accumulate: running this twice should give the same
  -- demo, not twice the demo.
  delete from public.store_visits
   where id::text in (select row_pk from public.brand_demo_artifacts
                       where brand_id = p_brand_id and table_name = 'store_visits');
  delete from public.brand_demo_artifacts
   where brand_id = p_brand_id and table_name = 'store_visits';

  for v_i in 0 .. least(p_visits, jsonb_array_length(v_t)) - 1 loop
    v_days := (v_t -> v_i ->> 'days')::integer;
    v_fud  := nullif(v_t -> v_i ->> 'fud', '')::integer;

    -- Roughly two in five are walk-ins nobody has a name for. That is not a
    -- gap in the demo, it is the demo.
    v_cust := case
      when v_custs is null then null
      when v_i % 5 in (1, 3) then null
      else v_custs[1 + (v_i * 7) % array_length(v_custs, 1)]
    end;

    v_item := case
      when jsonb_array_length(v_prods) = 0 then '[]'::jsonb
      else jsonb_build_array(
        jsonb_build_object(
          'product', v_prods -> ((v_i * 3) % jsonb_array_length(v_prods)) ->> 'name',
          'sku',     v_prods -> ((v_i * 3) % jsonb_array_length(v_prods)) ->> 'sku',
          'size',    case when v_i % 3 = 0 then '38' when v_i % 3 = 1 then '40' else null end,
          'colour',  case when v_i % 4 = 0 then 'nero' when v_i % 4 = 2 then 'beige' else null end,
          'reaction', v_t -> v_i ->> 'obj'
        ))
    end;

    insert into public.store_visits (
      brand_id, shop_id, recorded_by, customer_id, customer_said, match_confidence,
      visited_at, source, transcript, language, outcome, summary, items, objection,
      occasion, sentiment, follow_up, follow_up_due, tags, status, needs_review,
      confirmed_at, created_at
    ) values (
      p_brand_id,
      v_shop,
      case when v_staff is null then null
           else v_staff[1 + v_i % array_length(v_staff, 1)] end,
      v_cust,
      case when v_cust is null then null
           else (select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
                   from public.profiles where id = v_cust) end,
      case when v_cust is null then 'none' else 'exact' end,
      now() - (v_days || ' days')::interval - ((v_i * 37) || ' minutes')::interval,
      'voice',
      v_t -> v_i ->> 'tx',
      v_t -> v_i ->> 'lang',
      v_t -> v_i ->> 'outcome',
      v_t -> v_i ->> 'sum',
      v_item,
      v_t -> v_i ->> 'obj',
      v_t -> v_i ->> 'occ',
      v_t -> v_i ->> 'sent',
      v_t -> v_i ->> 'fu',
      case when v_fud is null then null else (current_date + v_fud) end,
      case when jsonb_typeof(v_t -> v_i -> 'tags') = 'array'
           then array(select jsonb_array_elements_text(v_t -> v_i -> 'tags'))
           else '{}'::text[] end,
      -- One left unconfirmed on purpose: the newest. It is how you show that
      -- the assistant proposes and the manager decides, without saying it.
      case when v_i = 0 then 'draft' else 'confirmed' end,
      v_i = 0,
      case when v_i = 0 then null else now() - (v_days || ' days')::interval end,
      now() - (v_days || ' days')::interval
    ) returning id into v_id;

    insert into public.brand_demo_artifacts (brand_id, table_name, row_pk)
    values (p_brand_id, 'store_visits', v_id::text);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'visits', v_n,
    'with_customer', (select count(*) from public.store_visits
                       where brand_id = p_brand_id and customer_id is not null),
    'catalogue_pieces', jsonb_array_length(v_prods));
end;
$$;

-- The purge has to take these too, or a house going live inherits fourteen
-- conversations that never happened.
create or replace function public.purge_brand_demo_data(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; t text; n integer;
begin
  foreach t in array array['store_visits','feedback','claims','policies','catalogues','profiles','shops'] loop
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

revoke all on function public.generate_brand_demo_visits(bigint, integer) from public, anon, authenticated;
grant execute on function public.generate_brand_demo_visits(bigint, integer) to service_role;
