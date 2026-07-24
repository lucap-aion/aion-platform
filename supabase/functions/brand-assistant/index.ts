// brand-assistant: the in-store sales-assistant chat backend (SSE streaming).
//
// Persona: an assistant for store managers / sales associates of a single
// luxury brand. It answers from TWO sources, in one conversation:
//   • search_knowledge — RAG over the brand's uploaded docs (product dossiers,
//     brand story / tone of voice, policies, training) via Voyage embeddings
//     + match_brand_knowledge.
//   • run_sql — read-only, RLS-pinned SQL for live customer & purchase data
//     (what a client bought, when, average ticket, claims, cross-sell).
//
// Events emitted (same shape family as query-ai so the client can reuse render
// logic):
//   event: turn_start   { turn }
//   event: text_delta   { text }
//   event: sql_result   { sql, columns, rows, row_count }
//   event: knowledge    { query, sources: [{doc_title, category, similarity, snippet}] }
//   event: done         {}
//   event: error        { message }

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";
// Analyst persona + full schema/glossary/playbooks, used for ADMIN callers (the
// merged assistant serves both the sales floor and the admin analyst).
import { ANALYST_SYSTEM } from "../_shared/analyst-prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

// Upgraded to Sonnet for far better synthesis, tool use, and selling instinct.
// Override per-env with ASSISTANT_MODEL; followups use a cheap fast model.
const MODEL = Deno.env.get("ASSISTANT_MODEL") ?? "claude-sonnet-4-6";
const FOLLOWUP_MODEL = "claude-haiku-4-5-20251001";
const EMBED_MODEL = "voyage-3.5";
const EMBED_DIMS = 1024;
const MAX_TOOL_TURNS = 12;
const MAX_TOKENS = 3000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sales-floor persona + a COMPACT, customer-facing schema. Deliberately omits
// the AION revenue/premium math (store associates don't price the insurance) —
// this assistant is about the client in front of them and the product on the
// shelf, not platform economics.
const SYSTEM = `
You are AION Assistant — an elite in-store companion for sales associates and
store managers at a luxury house. You help them sell with confidence and serve
every client beautifully: deep product knowledge, the client's history, the
brand's story and values, and company policy — instantly, in words they can use
on the floor. You are their expert colleague, not a search box.

# Voice
- Warm, polished, confident — the tone of a great boutique. Never robotic, never
  cheesy hard-sell.
- Concise and scannable. Lead with the answer. 2-5 sentences or tight bullets,
  with the key facts in **bold**. No walls of text.
- Answer like a knowledgeable colleague, not a disclaimer. For a count or factual
  question, lead with the best number/answer you can get from the data or
  knowledge, then at most ONE short caveat. Never bury the answer under what you
  can't do — find the closest real signal (e.g. count indexed product pages) and
  give it.
- Stay on scope: answer the question that was asked. Add at most 1-2 extra
  context points, and only if they directly help on the floor. Don't pad the
  answer with tangential facts, and don't bring in news/press unless the question
  is about recent news or updates.
- Always reply in the associate's language (match them — Italian or English).

# Sources of truth — use them, never guess
You have two tools. Never invent a price, policy, material, date, or client fact.

## search_knowledge(query) — the brand's own indexed knowledge
The entire brand website + product pages + brand story, craftsmanship, care,
policies, and recent news are indexed. Use it for ANYTHING about the product,
the brand, or a policy.
- Reformulate the user's words into precise search terms ("calf leather care",
  not "how do I look after it").
- For a multi-part question, run a SEPARATE focused search per part (e.g. one
  for the return window, one for who to escalate to). Search as many times as
  you need to answer fully.
- If a search comes back thin or off-topic, try again with different terms
  before concluding you don't have it.
- Synthesize across passages in your own clean words. Retrieved text may carry
  stray website fragments (menus, prices out of context) — ignore the noise,
  never paste raw fragments back. Cite the source document name in one short line.

## run_sql(sql) — live client & sales data (your brand only)
Use for what a client bought and when, average ticket, lifetime value, claims,
feedback, and data-driven cross-sell. Resolve a client by name with ILIKE; if
several match, list them and ask which one before going deeper. If ILIKE returns
NOBODY, say plainly you can't find them under that name and ask for the spelling
or email — never answer about the nearest different person.
Renewals / expiring covers (a core strength): a cover is active when
status='live'; "expiring this month / soon" = expiration_date BETWEEN
CURRENT_DATE AND CURRENT_DATE + interval '30 days'. Use today's date for any
"this month / recently / soon / still active" question.

Don't mix them up: the brand story, craftsmanship, care and policy come from
search_knowledge; client history AND the live product catalogue (with photos)
come from run_sql. When a question is about products or a collection, you often
want BOTH — the story/context from knowledge, and the actual pieces to show from
the catalogue (see "Show the pieces" below).

Schema (your brand only):
- profiles(id, first_name, last_name, email, phone_number, city, country,
    date_of_birth, registered_at, role, avatar) — CLIENTS have role IS NULL or 'customer'.
- policies(id, customer_id->profiles.id, item_id->catalogues.id, shop_id,
    start_date, expiration_date, status, selling_price, recommended_retail_price,
    quantity) — a purchased cover. status: live/expired/cancelled/pending.
    selling_price = what the client paid. Use start_date for "when".
- storefront_products(id, name, category, collection, description, sku, price,
    price_currency, compare_at_price, available, image_url, product_url) — THE
    FULL live catalogue, ingested from the brand's own e-commerce (the complete
    range, with photos and prices). THIS is your product source: for anything
    about what the brand sells, a collection, a look, a category, a price, or a
    cross-sell, query THIS table. price = the online price (EUR); price IS NULL
    means not listed online → say "price on request" / "check in boutique", never
    guess. image_url renders as a photo. Use it to count/aggregate the range
    ("how many pieces", "what's in Venetian Princess").
- catalogues(id, name, category, collection, composition, sku, picture) — the
    SUBSET of products synced into AION from sales; join target for policies (what
    a specific client owns). Use it to resolve a client's purchased items, NOT to
    browse the range — storefront_products is the full catalogue.
- policies(...) above link item_id -> catalogues.id.
  When listing what a CLIENT BOUGHT, ALWAYS show the pieces with photos: join the
  catalogue AND left-join the storefront for a clean image + price, e.g.
    SELECT c.name, c.collection, COALESCE(s.image_url, c.picture) AS image_url,
           po.selling_price AS price, po.start_date
    FROM policies po
    JOIN catalogues c ON c.id = po.item_id
    LEFT JOIN storefront_products s ON s.brand_id = po.brand_id AND s.sku = c.sku
    WHERE po.customer_id = <id> ORDER BY po.start_date DESC
  For the count / average ticket / lifetime total: you only receive the first ~30
  rows here, so for a client with many pieces run ONE aggregate query
  (SUM(selling_price), AVG, COUNT) and state THOSE exact figures — the photo cards
  from the query above stay on screen (a later numbers-only query won't replace
  them). Do NOT build a KPI markdown table and do NOT list the pieces in text: the
  cards render below; give the totals/average in ONE short line. Every product
  list — a client's purchases included — must carry an image column to render as cards.
- claims(id, policy_id->policies.id, type, status, incident_date).
- feedback(id, user_id->profiles.id, satisfaction_rate, recommendation_rate,
    peace_of_mind_rate, comment) — rates 1-5.
- shops(id, name, city, country).
- events(id, name, city, country, venue, start_date, end_date, status, pr_agency,
    pr_cost, venue_cost, shipping_cost, other_cost, guests_invited, guests_attended,
    revenue) — TRUNK SHOWS / brand events, past and planned. status:
    planned/confirmed/completed/cancelled. Use for event history, cost & ROI, and
    planning a new one (see "Trunk show planning").
- event_attendees(id, event_id->events.id, customer_id->profiles.id, customer_name,
    segment, invited, attended, influencer, converted, revenue) — the invite &
    attribution list per event (who was invited, who came, who converted, and which
    influencer brought them).
- brand_knowledge_docs(title, category, source_type, source_url, char_count) —
    INDEXED KNOWLEDGE crawled from the brand's site + news (product/storytelling/
    policy/news/other). Use for the brand STORY, care, policy, craftsmanship — not
    for the product list (storefront_products is the structured product source).
SQL tips: EUR money; cast before round (ROUND(AVG(x)::numeric,2)); ILIKE
'%name%' to find a client; ORDER BY start_date DESC for recency. When you list
products, SELECT image_url + price so photos and prices render; for clients
SELECT avatar. If a query errors, retry once, simpler.

IMPORTANT — how run_sql results reach the associate. Only results WITH A PHOTO
(a product/client image column) render, as clean photo cards. Plain
numeric/aggregate results are for YOUR reasoning only and are NOT shown — so:
- Never run a throwaway meta/count query just to check something (e.g. counting
  claims/feedback/support) expecting it to display. Get what you need and SPEAK
  the key numbers in your short prose. A store manager should never see a raw
  "Source / N" or "count" table — it looks broken to them.
- When there ARE pieces to see (products, a client's items), select an image
  column and give ONE short line of context — the photo cards carry the rest.
- Do NOT build markdown tables of data either. If the manager wants a structured
  breakdown, ranking, or KPI table they can keep, that's what generate_report is
  for (it renders a clean report with charts + PDF/Excel) — offer it instead.
- For disambiguating a few people, a short inline list ("1. … 2. …") is fine.

# Show the pieces — never leave a product answer photo-less
Whenever your answer is about products — a collection, a look, the pieces a
person (e.g. a campaign face or celebrity) wore, a category, a gift idea, or a
cross-sell — don't stop at naming them in words. Pull the ACTUAL pieces from the
catalogue so their photos render as cards the associate can turn and show the
client. A product answer with no pieces to show is a failed answer.
- Pull the pieces from storefront_products (the full catalogue), ALWAYS selecting
  image_url and price:
    SELECT name, collection, category, price, price_currency, image_url, product_url
    FROM storefront_products
    WHERE collection ILIKE '%…%' OR name ILIKE '%…%' OR category ILIKE '%…%'
    ORDER BY price DESC NULLS LAST
    LIMIT 6
  Match generously (try the collection name, then keywords), but return only the
  ~6 BEST pieces — the UI shows big image cards, so it's quality over quantity.
  Don't dump the whole collection; pick the most relevant/iconic to show first.
- Budget / "something under €X" / "most affordable" / "entry price": filter
  price IS NOT NULL AND price <= X and ORDER BY price ASC; say the price band in
  one line. A price-on-request piece (price IS NULL) must NOT count toward a cap.
- Availability / "in stock" / "what can I sell today": filter available = true,
  and add one line that availability is the online-catalogue status, not THIS
  boutique's stock — confirm on the floor.
- Then keep your prose to ONE short line — a lead-in or the single most useful
  point — and let the photo cards below carry the pieces (name + price are on the
  card). Don't describe each piece in text or re-list what the cards already show.
- The catalogue is a subset of the full range. If a named collection isn't in it,
  say so in one line and show the closest pieces you do have — never reply with
  names only when you could show something.

# Visual search — when the associate sends a photo of a piece
The associate can photograph a piece a client is wearing or pointing at. When a
photo is attached you'll receive it AND a ranked list of the closest matches from
YOUR catalogue (by visual similarity), each with name, collection and a score.
- Lead with the identification: the most likely piece by **name** and
  **collection**, in one confident line. Use BOTH your own look at the photo and
  the ranked matches — if the top match clearly fits what you see, name it.
- The matching pieces are already shown as photo cards below your text, so keep
  the prose short: the call, one line on why (materials/collection), and a next
  step (e.g. show her the piece, or a pairing).
- Be honest about confidence. If nothing matches well, or the top scores are low
  and don't look like the photo, say it's not a confident match and show the
  closest options — never invent a name or SKU.
- The catalogue is a subset of the full range, so the exact piece may not be in
  it; if so, say so and offer the closest pieces you do have.

# Reports (downloadable PDF + Excel)
When the associate asks for a report, a client recap/dossier, or weekly/monthly
performance, call generate_report — it renders an on-screen report with charts
and Download PDF / Excel buttons.
- kind="client": pass the client's NAME straight to generate_report — it
  resolves the client itself. Do NOT run a run_sql to look up their id first
  (that would flash a raw table with a system id at the associate). If the tool
  says several clients match, ask which one; don't guess.
- kind="performance": pass period "week" or "month" (default month).
- ANY other report the manager asks for (sales by collection, claims this month,
  renewals expiring, a single shop's numbers, a two-period comparison, best
  sellers, slow movers…) → kind="custom": give a title and a "sections" list,
  each with a type (kpis / bar / line / pie / table / products / note) and a SQL
  SELECT returning rows shaped for it. Compose a few sections (e.g. a KPI row + a
  chart + a table) for a real report. Use CURRENT_DATE / date_trunc for time
  windows. Don't select raw id columns.
After the tool runs, give ONE short sentence ("Here's the report — download it as
PDF or Excel below.") — never re-list the figures; the report shows them.

# Scope — one house only
You represent this house and only this house. Questions that compare, rank, or
comment on ANOTHER brand, a competitor, or the wider market are out of scope —
don't answer them even from general knowledge (your training about any brand may
be outdated or wrong; only the indexed materials + our data are truth). Warmly
redirect to how OUR pieces answer the client's need.

# What you can't do — hand off gracefully
You surface information; you don't take actions. You can't send emails, place or
reserve orders, book appointments, take payments, or change any record. If asked,
say so in one friendly line and hand the action to the associate ("I can't place
the order, but here's everything you need to close it — …").

# Accuracy — NON-NEGOTIABLE
- Use ONLY what the tools return. Do NOT draw on your own prior knowledge about
  this brand — its history, people, dates, products, prices, anything — even if
  you're sure you know it. If it's not in the retrieved passages or query
  results, you don't have it; say so. Your training data about this brand may be
  outdated or wrong; the indexed materials are the only truth.
- Preserve facts EXACTLY as written. Never round, merge, infer, or "tidy up"
  dates, numbers, names, or sequences. If the source says "designing since 1977,
  brand founded 1996", say exactly that — never collapse it to "founded 1977".
- If the sources disagree or are unclear, report what they say and flag the
  uncertainty — never resolve it by guessing.
- Cite where it came from in human terms ("our brand materials", "the FAQ", "the
  Venetian Princess page") — never external news-outlet names or system
  identifiers — and only cite a source that actually supports your claim.

# Deep client brief — "tell me everything about <client>"
When the associate asks for the full picture on a client (a complete brief /
"raccontami tutto su…", "scheda completa di…", "chi è <nome>", "profilo di…"),
build ONE consolidated brief. RESOLVE the client first, then pull their history.
Where the client lives depends on the brand (see "Where this brand's data lives"):

- Clients in the CRM (profiles/policies populated): resolve with run_sql — ILIKE
  on the client's name (role IS NULL or 'customer'). If several match, list them
  and ask which one; if none, say so plainly and ask for the spelling/email —
  never brief the nearest different person. Then, once you have the one client,
  gather in a FEW focused queries:
  • Purchases — the policies→catalogues join (left-join storefront for image +
    price) from the schema, newest first, WITH an image column so they render as
    photo cards.
  • Totals — ONE aggregate (COUNT, SUM(selling_price), AVG). SPEAK these in one
    line; the cards stay on screen (a numbers-only query won't replace them).
  • Signals — open claims (status NOT closed/cancelled) and the latest feedback
    (satisfaction / recommendation / peace-of-mind + comment).
  • Cross-sell — up to 5 pieces from the catalogue the client does NOT own yet,
    same category as past purchases first, WITH image_url so they render as cards.
- Clients in the knowledge base (this brand's data lives there, OR run_sql finds
  no client): RESOLVE the client with lookup_knowledge_card (its name) — that does
  an exact by-name match on the client's card ("Scheda cliente — <Name>"), which
  plain search_knowledge misses because a bare name has little semantic signal. Do
  NOT conclude "no client" from a weak search_knowledge result — use
  lookup_knowledge_card first. The card carries spend, segment (VIC/Premium/
  Regular/Entry), favourite categories, sizes & colours, trunk shows attended and
  top products. If the card names specific products, you may search_knowledge for
  those for more detail. Build the brief from the card, then pull matching NEW
  pieces from the live catalogue (storefront) as photo cards for the cross-sell.

Shape it for the floor, not as a data dump: a 1–2 line identity + value lead ("VIP
client — around €X over N pieces, last bought <month>"), the purchase cards, ONE
line of signals (open claim / feedback), then the cross-sell cards with ONE line
on why they fit. Close with ONE concrete next step (renewal, open claim, ask for
feedback, or the strongest cross-sell). Speak the numbers; never show a raw table.

# Product analysis — "who buys <piece> and why"
When asked who buys a piece / to analyse a product's buyers ("chi compra…",
"analizza i clienti di…", "che clientela ha <pezzo>"), resolve the piece first
(by name or SKU), then give the useful signal — not an analytics dump:
- Clients in the CRM: run_sql to profile its buyers — how many own it, where they
  are (top cities/countries), repeat buyers, the pieces most often owned ALONGSIDE
  it (basket affinity), and satisfaction vs the brand average. Speak the key
  figures in tight prose and show the co-owned pieces as photo cards. Give 1–3
  concrete plays ("pair with <piece> — most of its buyers already own it").
- Clients in the knowledge base: resolve the piece with lookup_knowledge_card (its
  name/code) to pull its product card ("Scheda prodotto — …", sales history,
  trunk-show flag) for context, and show the piece plus its closest catalogue
  pairings as cards. Be honest about what the card does and doesn't tell you.
For anything the associate wants to keep as a structured breakdown or ranking,
offer generate_report instead (it renders a clean report with charts + PDF/Excel).

# Trunk show planning — "help me organise the trunk show in <city> in <month>"
When asked to plan a trunk show / brand event, produce a concrete plan grounded in
THIS brand's past events (the events + event_attendees data), and keep the human
in the loop on judgement calls (venue visits, negotiations, bookings). Work from
what the data supports; be explicit about what it can't tell you.
- Past performance (run_sql on events, completed only): revenue, guests invited vs
  attended (conversion), and cost breakdown per past show. Use it to propose the
  optimal number of days and the best period (compare cities/months you have), and
  to benchmark the new event. Speak the figures.
- PR ROI (run_sql on events): revenue and guests brought per pr_agency, and cost →
  compute € per attending guest / per € revenue, and recommend renew vs change.
- Stock & bags: from a comparable past show's attendance and revenue, suggest how
  many pieces and shopper bags to prepare (order of magnitude, state the basis).
- Invite list & attribution (run_sql on event_attendees): who to prioritise
  (segment VIC/Premium first, past converters), and which influencer drove
  conversions last time (converted + revenue by influencer). For a knowledge-base
  brand, resolve named clients with lookup_knowledge_card for their segment/history.
- Logistics: for the round-trip shipping + duties/VAT estimate, call
  shipping_estimate (destination country, piece count or weight, declared value).
  It's an ESTIMATE — say so, and note trunk-show goods usually travel on an ATA
  Carnet (temporary import, duty deferred until sold).
- Out of scope for the data: venue scouting and team travel need real-world
  research/booking — say plainly you can't pull those from our data and hand them
  to the associate as the human steps, with a checklist of what to confirm.

Deliver it AS A DOWNLOADABLE REPORT. A trunk-show plan is a document the brand
keeps and shares — so for a full "organise / plan the trunk show" request, don't
just answer in chat: gather the data + the shipping_estimate first, then call
generate_report (kind="custom", a fitting title like "Trunk Show — <City> <Month>")
and build these sections from THIS brand's real event data (each section's sql is
brand-scoped automatically):
- kpis — headline planning numbers from past completed events: avg revenue per
  show, avg conversion (guests_attended / guests_invited), avg revenue per
  attending guest, number of past shows.
- bar — revenue by past event (label = city/name, value = revenue).
- table — Invite priorities: past converters from event_attendees (name, segment,
  influencer, revenue) ordered by revenue desc — a ready call list.
- table — PR / influencer ROI: revenue and conversions grouped by influencer (or
  pr_agency on events), so the choice is on measured return.
- note — Logistics: the shipping_estimate figures (round-trip freight, duty/VAT if
  sold, ATA Carnet recommendation) in plain words.
- note — Value summary: state that the assistant cuts trunk-show setup by roughly
  60% (about 66h → 25h per event) — frame that as the service's typical impact, not
  brand data — AND one revenue lever grounded in THEIR numbers: +5% sell-through on
  their average past-show revenue = +€X (compute €X from the events average). Do
  NOT invent AION pricing or fees.
- note — Human steps: venue, PR contract, invite sign-off, ATA Carnet, stylist
  brief, bags, staffing — each with the owner.
After it renders, give ONE short sentence pointing to the report (PDF/Excel below);
don't re-list the figures. Lay any chat-only answer out activity by activity (a
short heading + the number + the one decision the human owns). Don't invent figures
the data doesn't have.

# Selling instinct
When it serves the sale, proactively add something the associate can use: a
relevant cross-sell or pairing, a care tip or talking point that builds desire,
or a heads-up on a renewal / open claim / VIP signal for that client. Close with
ONE concrete next step when it's natural — not on every message.

# Honesty
If something isn't in the indexed knowledge or the data, say so plainly and where
it would come from ("not in our indexed materials — check with HQ"). Never
fabricate.

# Never expose internals
The user is a store associate, not an engineer. NEVER mention table names, column
names, SQL, snake_case identifiers, row counts, or any system mechanics. Cite
sources in natural human terms only — "our website catalogue", "the FAQ", "the
care guide", a collection or page name — never things like "brand_knowledge_docs"
or "(product category count)". Speak as a colleague who simply knows. Phrase
counts naturally ("around 590 pieces online"), not as raw query output.

# Made-to-measure
Live MTM configuration, lead times and pricing aren't connected yet. If asked,
say so and point to the standard MTM process.

Markdown renders (GFM tables OK). Keep every answer floor-ready.
`.trim();

const TOOLS = [
  {
    name: "search_knowledge",
    description:
      "Semantic search over the brand's uploaded knowledge base (product " +
      "dossiers, brand story, tone of voice, care guides, policies, training). " +
      "Use for any question about the product, the brand, or a policy. Returns " +
      "the most relevant passages with their source document titles.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query (the user's intent).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_knowledge_card",
    description:
      "Find a specific knowledge-base CARD by name — a client's card (\"Scheda " +
      "cliente — <Name>\") or a product card (\"Scheda prodotto — <code> <desc>\"). " +
      "Uses an exact by-name (lexical) match, so it reliably resolves a NAMED " +
      "client or product even when semantic search_knowledge misses it (proper " +
      "names carry little semantic signal). Use this to RESOLVE a client/product " +
      "for a brief when the brand's clients/products live in the knowledge base. " +
      "Returns matching cards with their full text.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The client or product name/code to look up (e.g. \"Eugenia Gemmo\").",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "shipping_estimate",
    description:
      "Estimate round-trip freight + import duty/VAT for shipping a trunk-show " +
      "collection to a destination country. Rough parametric estimate (not a live " +
      "carrier quote). Provide the destination country, the number of pieces (or a " +
      "total weight in kg), and the declared value of the collection.",
    input_schema: {
      type: "object",
      properties: {
        destination_country: {
          type: "string",
          description: "Destination ISO code or name (e.g. US, GB/UK, CH, IT/EU).",
        },
        pieces: { type: "number", description: "Number of pieces (garments/items). Used to estimate weight if weight_kg is omitted." },
        weight_kg: { type: "number", description: "Total shipment weight in kg, if known (overrides the pieces estimate)." },
        declared_value: { type: "number", description: "Declared value of the collection in EUR (for duty/VAT)." },
        round_trip: { type: "boolean", description: "Round trip (out + return). Default true." },
      },
      required: ["destination_country"],
    },
  },
  {
    name: "run_sql",
    description:
      "Execute a read-only SQL query (SELECT or WITH) for live client and " +
      "sales data. Already scoped to your brand. Returns columns, rows, " +
      "row_count. Capped at 1000 rows / 15s.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT or WITH query." },
      },
      required: ["sql"],
    },
  },
  {
    name: "generate_report",
    description:
      "Build a downloadable report (PDF + Excel, with charts) shown to the " +
      "associate with download buttons. Two presets: kind='client' (needs the " +
      "client's name) and kind='performance' (period week|month). For ANYTHING " +
      "else — sales by collection, claims this month, renewals expiring, a shop's " +
      "numbers, a period comparison, etc. — use kind='custom' and build it from " +
      "`sections`. Each section has a `type` and a `sql` SELECT that returns rows " +
      "shaped for that type:\n" +
      "  • kpis — one row; each column becomes a KPI card (money columns auto-€).\n" +
      "  • bar | line | pie — 2 columns: first = label, second = numeric value.\n" +
      "  • table — any columns; rendered as a small table (money auto-€).\n" +
      "  • products — columns among name, collection/category, price, image_url, " +
      "product_url; renders as photo cards.\n" +
      "  • note — a short text callout (use `body`, no sql).\n" +
      "The report renders on screen — after calling this, give ONE short sentence " +
      "pointing to it; do NOT re-list the data.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["client", "performance", "custom"], description: "Report type." },
        client: { type: "string", description: "For kind=client: the client's full name." },
        period: { type: "string", enum: ["week", "month"], description: "For kind=performance: bucket size (default month)." },
        title: { type: "string", description: "For kind=custom: the report title." },
        subtitle: { type: "string", description: "For kind=custom: optional subtitle." },
        sections: {
          type: "array",
          description: "For kind=custom: the report sections, in order.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["kpis", "bar", "line", "pie", "table", "products", "note"] },
              title: { type: "string" },
              sql: { type: "string", description: "A single SELECT/WITH query returning rows shaped for this section type." },
              unit: { type: "string", enum: ["eur", "num"], description: "Value unit for kpis/charts (default: auto by column name)." },
              body: { type: "string", description: "For type=note: the text." },
            },
            required: ["type"],
          },
        },
      },
      required: ["kind"],
    },
  },
  // ── Admin-only tools (folded in from query-ai; gated to admin callers) ──────
  {
    name: "render_chart",
    description: "Tell the client to render a Recharts chart from the most recent run_sql result.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "line", "pie"] },
        x_key: { type: "string" },
        y_keys: { type: "array", items: { type: "string" } },
        title: { type: "string" },
      },
      required: ["type", "x_key", "y_keys"],
    },
  },
  {
    name: "generate_daily_chubb_export",
    description:
      "Generate the daily Chubb-formatted export (CSV/XLSX) for a date. `kind`: " +
      "'new_policies' (SalesFile of policies started that day, status=live), " +
      "'cancelled_policies' (cancellation SalesFile), 'claims' (daily Claims XLSX). " +
      "Defaults to yesterday. Returns one signed download URL per Chubb-reporting " +
      "brand. Does NOT push to Chubb SFTP.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to yesterday (UTC)." },
        kind: { type: "string", enum: ["new_policies", "cancelled_policies", "claims"], description: "Which export. Default 'new_policies'." },
        brand_id: { type: "integer", description: "Optional brand id to scope to one brand." },
      },
    },
  },
  {
    name: "generate_monthly_internal_report",
    description:
      "Generate the Monthly Internal Policies Report (Excel) for a month. Defaults " +
      "to every Chubb-reporting brand; pass brand_id to scope. Returns one signed " +
      "download URL per brand. Use for 'the monthly report' / 'internal report'.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "integer", description: "Four-digit year. Defaults to previous month's year." },
        month: { type: "integer", minimum: 1, maximum: 12, description: "Month 1-12. Defaults to previous month." },
        brand_id: { type: "integer", description: "Optional brand id to scope to one brand." },
      },
    },
  },
];

// Tool sets by role: brand users get the sales-floor toolkit; admins get the
// analyst toolkit (charts + Chubb/monthly exports). generate_report is brand-only
// (the admin UI renders 'chart'/'report_files', not the 'report' object);
// shipping_estimate is a trunk-show/brand tool.
const BRAND_TOOL_NAMES = new Set(["search_knowledge", "lookup_knowledge_card", "shipping_estimate", "run_sql", "generate_report"]);
const ADMIN_TOOL_NAMES = new Set(["run_sql", "search_knowledge", "lookup_knowledge_card", "render_chart", "generate_daily_chubb_export", "generate_monthly_internal_report"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError("missing bearer token", 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  // Service-role client for best-effort telemetry the associate's RLS can't
  // write (e.g. logging a knowledge gap). Never used to read another brand.
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);
  const userId = user.id;

  // Resolve who's asking and what they can see. One assistant serves both:
  //   • brand users  → PINNED to their own brand (isolation enforced by the
  //     brand-scoped SQL runner + RLS). They can never reach another brand.
  //   • AION admins   → any brand. With a brand_id they scope to that one brand
  //     (like view-as); without one they go CROSS-BRAND (all brands), for
  //     comparisons/rankings/aggregates.
  let brandId: number | null = null;
  let brandName: string | null = null;
  let isAdmin = false;
  let crossBrand = false;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminRow) {
    isAdmin = true;
    // Scope target: an explicit brand_id, or (from the admin "Ask the data" UI)
    // the brand of the profile the admin is viewing-as. Neither → cross-brand.
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId && body.impersonate_profile_id) {
      const { data: ip } = await userClient
        .from("profiles").select("brand_id").eq("id", String(body.impersonate_profile_id)).maybeSingle();
      brandId = (ip?.brand_id as number) ?? null;
    }
    if (brandId) {
      const { data: b } = await userClient
        .from("brands").select("name").eq("id", brandId).maybeSingle();
      brandName = b?.name ?? null;
    } else {
      crossBrand = true; // admin, no brand chosen → all brands
    }
  } else {
    const { data: profileRow } = await userClient
      .from("profiles")
      .select("brand_id, role, brands(name)")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"])
      .maybeSingle();
    if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
    brandId = profileRow.brand_id as number;
    const rel = (profileRow as { brands?: { name?: string } | { name?: string }[] }).brands;
    brandName = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null;
  }

  const question = String(body.question ?? "").trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const locale = body.locale === "it" ? "it" : "en";
  // Optional photo for visual product search (data URL: "data:image/…;base64,…").
  const image = parseDataUrl(body.image);
  // Optional spreadsheet the user attached to analyse ({ name, text }); the text
  // is a compact table the client already parsed from an .xlsx/.csv. Capped.
  const sheet = body.spreadsheet && typeof body.spreadsheet === "object"
    ? {
        name: String((body.spreadsheet as Record<string, unknown>).name ?? "foglio").slice(0, 200),
        text: String((body.spreadsheet as Record<string, unknown>).text ?? "").slice(0, 60000),
      }
    : null;
  // A photo or a spreadsheet alone is a valid turn; text is only required when
  // there's no attachment.
  if (!question && !image && !sheet?.text) return jsonError("question or attachment is required", 400);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  // The newest user turn carries the photo (as an image block) when present, so
  // the model can reason over it directly alongside the catalogue matches.
  // An attached spreadsheet is appended to the user's turn as context the model
  // reads directly (no separate tool): it can summarise it, compute over it,
  // cross-reference the knowledge base / catalogue, or turn it into a report for
  // PDF/Excel export.
  const sheetBlock = sheet?.text
    ? `\n\n--- ATTACHED SPREADSHEET "${sheet.name}" (data for this question; may be truncated) ---\n${sheet.text}\n--- end spreadsheet ---`
    : "";
  const fallbackText = image
    ? (locale === "it" ? "Che pezzo è questo? Identificalo dal nostro catalogo." : "What piece is this? Identify it from our catalogue.")
    : (sheet ? (locale === "it" ? "Analizza il foglio allegato." : "Analyze the attached spreadsheet.") : "");
  const userText = (question || fallbackText) + sheetBlock;

  const latestContent: Anthropic.ContentBlockParam[] | string = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: userText },
      ] as Anthropic.ContentBlockParam[]
    : userText;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m: { role?: string; content?: string }) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.content ?? ""),
    })),
    { role: "user" as const, content: latestContent },
  ];

  // Role-switch the whole persona. Brand users get the sales-floor SYSTEM; AION
  // admins get the analyst ANALYST_SYSTEM (full schema + glossary + playbooks).
  const baseSystem = isAdmin ? ANALYST_SYSTEM : SYSTEM;
  const scopeNote = !isAdmin
    ? (brandName
        ? `\n\n# Your brand\nYou work for "${brandName}" (brand_id = ${brandId}). All data and knowledge is scoped to this brand. You cannot see or compare other brands.`
        : `\n\n# Your brand\nbrand_id = ${brandId}. All data is scoped to this brand.`)
    : crossBrand
    ? `\n\n# Scope — ALL brands\nYou are an AION admin analyst with read access to EVERY brand. Cross-brand comparisons, rankings ("top brands by X") and all-brand aggregates are expected. Join to brands for names; group/compare by brand when useful.`
    : `\n\n# Scope — one brand\nYou are focused on "${brandName}" (brand_id = ${brandId}). Filter EVERY query to brand_id = ${brandId} (for tables without the column, join through policies). Do not reference or compare other brands.`;
  const languageNote = locale === "it"
    ? "\n\n# Language\nThe associate's UI is in Italian — reply in Italian by default unless they write in another language. SQL identifiers stay English."
    : "";
  // The model has no clock — give it today's date so "this month / expiring
  // soon / recent" reasoning is correct. Boutique-local (Europe/Rome).
  const todayNote = (() => {
    const now = new Date();
    const human = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Rome",
    }).format(now);
    const iso = now.toISOString().slice(0, 10);
    return `\n\n# Today\nToday is ${human} (${iso}). Use this for any "today / this week / this month / recent / expiring soon" reasoning. In SQL prefer CURRENT_DATE / now().`;
  })();

  // Per-brand customization (brand_assistant_config). A brand shapes its own
  // assistant — name, where its data lives, house instructions, signature moves,
  // scope. But setting it up (especially "where your data lives") is fiddly and,
  // if wrong, the assistant can't find the brand's clients. So a brand that
  // hasn't configured anything gets an AUTO config: we detect where the data
  // lives from what actually exists (CRM clients vs knowledge-base cards) and
  // apply default signature moves — the assistant just works, zero setup. A
  // saved config always wins (advanced override).
  // Per-brand customization (name, data-home, signature moves) only applies to a
  // brand USER. Admins use the analyst persona and query directly, so no brand
  // config blocks.
  const brandBlocks = isAdmin
    ? []
    : buildBrandBlocks(
        (await loadAssistantConfig(userClient, brandId)) ?? await autoAssistantConfig(serviceClient, brandId),
        brandName,
      );

  const systemBlocks = [
    { type: "text" as const, text: baseSystem, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: scopeNote },
    ...brandBlocks.map((text) => ({ type: "text" as const, text })),
    ...(languageNote ? [{ type: "text" as const, text: languageNote }] : []),
    { type: "text" as const, text: todayNote },
  ];

  const activeTools = TOOLS.filter((t) =>
    (isAdmin ? ADMIN_TOOL_NAMES : BRAND_TOOL_NAMES).has(t.name)
  );

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Visual search: if a photo was attached, match it against the brand's
        // catalogue-image embeddings, show the pieces as cards, and hand the
        // model the ranked candidates so it can identify + confirm.
        if (image && brandId == null) {
          // Cross-brand admin: visual search is per-brand. Note it and move on.
          messages.push({
            role: "user",
            content: `[VISUAL SEARCH] Visual product search runs against one brand's catalogue, but no brand is selected. Ask the admin which brand's catalogue to match the photo against.`,
          });
        } else if (image) {
          emit("tool_start", { tool: "search_by_image" });
          try {
            const embedding = await voyageEmbedImage(`data:${image.mediaType};base64,${image.data}`);
            const { data: matchData, error: matchErr } = await userClient.rpc(
              "match_storefront_images",
              { p_brand_id: brandId, p_query_embedding: embedding, p_match_count: 6, p_min_similarity: 0.2 },
            );
            if (matchErr) throw new Error(matchErr.message);
            const matches = (matchData ?? []) as {
              name: string; collection: string | null; category: string | null;
              sku: string | null; image_url: string | null; product_url: string | null;
              price: number | null; price_currency: string | null; similarity: number;
            }[];
            if (matches.length) {
              // Render the pieces as photo cards (same shape as sql_result).
              emit("sql_result", {
                sql: null,
                columns: ["name", "collection", "category", "price", "image_url", "product_url"],
                rows: matches.map((m) => ({
                  name: m.name, collection: m.collection, category: m.category,
                  price: m.price, image_url: m.image_url, product_url: m.product_url,
                })),
                row_count: matches.length,
              });
              // Ground the model with the ranked candidates (incl. score, SKU, price).
              const ranked = matches
                .map((m, i) => `${i + 1}. ${m.name}${m.collection ? ` — ${m.collection}` : ""}`
                  + `${m.sku ? ` (SKU ${m.sku})` : ""}`
                  + `${m.price != null ? ` · ${m.price_currency ?? ""} ${m.price}` : " · price not listed online"}`
                  + ` · visual match ${Math.round(m.similarity * 100)}%`)
                .join("\n");
              messages.push({
                role: "user",
                content: `[VISUAL SEARCH] Closest pieces in your catalogue to the attached photo, ranked by visual similarity:\n${ranked}\n\nIdentify the piece using both the photo and this list, per the "Visual search" instructions. The pieces above are already shown to the associate as photo cards.`,
              });
            } else {
              messages.push({
                role: "user",
                content: `[VISUAL SEARCH] No visually similar pieces were found in your catalogue for the attached photo. Tell the associate you can't confidently match it to a catalogued piece, describe what you see, and suggest how to identify it (e.g. check the piece's hallmark/SKU).`,
              });
            }
          } catch (e) {
            console.warn("[brand-assistant visual]", e instanceof Error ? e.message : e);
            messages.push({
              role: "user",
              content: `[VISUAL SEARCH] The visual match couldn't run this time. Still help using the photo you can see and ask a clarifying detail if useful.`,
            });
          }
        }

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          emit("turn_start", { turn });

          const llmStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemBlocks,
            tools: activeTools as Anthropic.Tool[],
            messages,
          });

          for await (const ev of llmStream) {
            if (
              ev.type === "content_block_delta" &&
              (ev.delta as { type?: string }).type === "text_delta"
            ) {
              const text = (ev.delta as { text?: string }).text ?? "";
              if (text) emit("text_delta", { text });
            }
          }

          const finalMessage = await llmStream.finalMessage();
          messages.push({ role: "assistant", content: finalMessage.content });
          if (finalMessage.stop_reason !== "tool_use") break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of finalMessage.content) {
            if (block.type !== "tool_use") continue;

            // Live activity for the UI ("Searching the knowledge base…" etc).
            emit("tool_start", {
              tool: block.name,
              query: block.name === "search_knowledge" ? String((block.input as { query?: string })?.query ?? "") : undefined,
            });

            if (block.name === "run_sql") {
              const sql = String((block.input as { sql?: string })?.sql ?? "");
              // Cross-brand admin → unscoped admin runner (all brands). Everyone
              // else (brand user, or admin focused on one brand) → the brand-scoped
              // runner, which pins RLS to THIS brand so the model's unfiltered SQL
              // can never read another brand's rows.
              const { data, error } = crossBrand
                ? await userClient.rpc("ai_run_query", { p_sql: sql })
                : await userClient.rpc("ai_run_query_scoped", { p_sql: sql, p_brand_id: brandId });
              if (error) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `SQL error: ${error.message}`,
                });
              } else {
                const payload = data as {
                  columns: string[];
                  rows: Record<string, unknown>[];
                  row_count: number;
                };
                const columns = payload.columns ?? [];
                const rows = payload.rows ?? [];
                emit("sql_result", { sql, columns, rows, row_count: payload.row_count ?? rows.length });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    columns,
                    row_count: payload.row_count ?? rows.length,
                    rows_preview: rows.slice(0, 30),
                  }),
                });
              }
            } else if (block.name === "search_knowledge") {
              const query = String((block.input as { query?: string })?.query ?? "").trim();
              if (brandId == null) {
                // Cross-brand admin: the knowledge base is per-brand, so there's no
                // single index to search. Ask the model to pick a brand.
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: "The knowledge base is per-brand. Ask which brand to search, or scope to one brand, then retry — or answer from the structured data instead.",
                });
                continue;
              }
              try {
                const matches = await searchKnowledge(userClient, brandId, query);
                // The model gets the broad set for grounding (below), but only
                // CLEARLY on-topic matches are shown as citations — weak/tangential
                // ones look "out of scope" to the user.
                const shown = matches.filter((m) => (m.similarity ?? 0) >= 0.5).slice(0, 3);
                emit("knowledge", {
                  query,
                  sources: shown.map((m) => ({
                    doc_title: m.doc_title,
                    source_url: m.source_url,
                    category: m.category,
                    similarity: Math.round(m.similarity * 100) / 100,
                    snippet: m.content.slice(0, 200),
                  })),
                });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: matches.length
                    ? JSON.stringify(
                      matches.map((m) => ({
                        source: m.doc_title,
                        category: m.category,
                        similarity: Math.round(m.similarity * 100) / 100,
                        text: m.content,
                      })),
                    )
                    : "No matching knowledge found for this brand. Tell the user this isn't in the knowledge base yet.",
                });
                // Coverage signal: the associate asked something the KB couldn't
                // answer. Log it (deduped, best-effort) so the brand sees what to
                // add. Only when we surfaced nothing relevant.
                if (matches.length === 0) {
                  serviceClient.rpc("log_knowledge_gap", { p_brand_id: brandId, p_query: query, p_top_similarity: null })
                    .then(({ error }) => { if (error) console.warn("[gap log]", error.message); });
                }
              } catch (e) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `knowledge search failed: ${e instanceof Error ? e.message : "unknown"}`,
                });
              }
            } else if (block.name === "lookup_knowledge_card") {
              const name = String((block.input as { name?: string })?.name ?? "").trim();
              try {
                const cards = await lookupKnowledgeCard(userClient, brandId, name);
                emit("knowledge", {
                  query: name,
                  sources: cards.map((c) => ({
                    doc_title: c.title, source_url: null, category: c.category,
                    similarity: 1, snippet: c.content.slice(0, 200),
                  })),
                });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: cards.length
                    ? JSON.stringify(cards.map((c) => ({ card: c.title, category: c.category, text: c.content })))
                    : `No card found matching "${name}" in this brand's knowledge base. Tell the associate you can't find them under that name and ask for the spelling.`,
                });
              } catch (e) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `card lookup failed: ${e instanceof Error ? e.message : "unknown"}`,
                });
              }
            } else if (block.name === "shipping_estimate") {
              const est = estimateShipping(block.input as ShippingInput);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(est),
              });
            } else if (block.name === "generate_report") {
              const input = block.input as { kind?: string; client?: string; period?: string };
              try {
                const report = await buildReport(userClient, brandId, brandName, input);
                if ((report as { error?: string }).error) {
                  toolResults.push({ type: "tool_result", tool_use_id: block.id, content: (report as { error: string }).error });
                } else {
                  emit("report", report);
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: "Report ready and shown to the user with PDF/Excel download buttons. Give ONE short sentence pointing to it; do NOT re-list the figures.",
                  });
                }
              } catch (e) {
                toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `report failed: ${e instanceof Error ? e.message : "unknown"}` });
              }
            } else if (block.name === "render_chart") {
              // Admin analyst: chart from the most recent run_sql result.
              emit("chart", {
                type: String((block.input as { type?: string })?.type ?? "bar"),
                x_key: String((block.input as { x_key?: string })?.x_key ?? ""),
                y_keys: Array.isArray((block.input as { y_keys?: unknown[] })?.y_keys)
                  ? (block.input as { y_keys: unknown[] }).y_keys.map(String) : [],
                title: (block.input as { title?: string })?.title ? String((block.input as { title: string }).title) : undefined,
              });
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "chart spec accepted" });
            } else if (block.name === "generate_daily_chubb_export" || block.name === "generate_monthly_internal_report") {
              // Admin-only export tools — proxy to the existing generator edge
              // functions (they return signed download URLs, no SFTP push).
              const isDaily = block.name === "generate_daily_chubb_export";
              const fnUrl = `${SUPABASE_URL}/functions/v1/${isDaily ? "generate-daily-chubb-export" : "generate-internal-report"}`;
              const inp = block.input as Record<string, unknown>;
              const payload = isDaily
                ? { date: inp.date ?? null, kind: inp.kind ?? "new_policies", brand_id: inp.brand_id ?? null }
                : { year: inp.year ?? null, month: inp.month ?? null, brand_id: inp.brand_id ?? null };
              try {
                const res = await fetch(fnUrl, {
                  method: "POST",
                  headers: { "Authorization": authHeader, "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                });
                const out = await res.json().catch(() => ({}));
                if (!res.ok) {
                  toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `export failed: ${(out as { error?: string })?.error ?? `HTTP ${res.status}`}` });
                } else {
                  const reports = Array.isArray((out as { reports?: unknown[] })?.reports) ? (out as { reports: unknown[] }).reports : [];
                  emit("report_files", { reports });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify({ generated: reports.length, brands: reports.map((r) => ({ brand_name: (r as { brand_name?: string }).brand_name, row_count: (r as { row_count?: number }).row_count })) }),
                  });
                }
              } catch (e) {
                toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `export crashed: ${e instanceof Error ? e.message : "unknown"}` });
              }
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content: `unknown tool: ${block.name}`,
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }

        // Suggest 3 natural follow-ups the associate might tap next (cheap, fast
        // model). Best-effort — never block the answer on it.
        try {
          const followups = await generateFollowups(anthropic, messages, locale);
          if (followups.length) emit("followups", { followups });
        } catch (e) {
          console.warn("[brand-assistant followups]", e instanceof Error ? e.message : e);
        }

        emit("done", {});
      } catch (err: unknown) {
        // Log the detail server-side; show the associate a clean message (never
        // forward a raw provider/DB error, which can carry internals).
        console.error("[brand-assistant]", err);
        emit("error", { message: "Something went wrong on our side — please try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      ...CORS,
    },
  });
});

type KMatch = { doc_id: string; doc_title: string; source_url: string | null; category: string; content: string; similarity: number };

// Resolve a named card (client "Scheda cliente — <Name>" / product "Scheda
// prodotto — …") by an exact lexical match on the doc title — semantic search
// misses bare proper names. brand_id is filtered EXPLICITLY (not via RLS): an
// admin view-as caller has admin RLS on brand_knowledge_docs and would otherwise
// see every brand's cards, so the .eq('brand_id') is the real brand gate here.
async function lookupKnowledgeCard(
  client: ReturnType<typeof createClient>,
  brandId: number | null,
  name: string,
): Promise<{ title: string; category: string; content: string }[]> {
  const q = name.trim();
  if (!q) return [];
  let query = client
    .from("brand_knowledge_docs")
    .select("title, category, content")
    .ilike("title", `%${q}%`)
    .limit(5);
  // Scope to one brand unless a cross-brand admin (brandId null → search all).
  if (brandId != null) query = query.eq("brand_id", brandId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { title: string; category: string; content: string }[];
  // Cap each card so a big doc can't blow the tool-result budget.
  return rows.map((r) => ({ ...r, content: (r.content ?? "").slice(0, 6000) }));
}

// ─── Shipping estimate (trunk-show logistics) ───────────────────────────────
// Rough parametric estimate, NOT a live carrier quote. Zones give an express
// €/kg rate; duty/VAT are the destination's approximate rates on jewellery/apparel
// applied to declared value (only if goods are sold / permanently imported — a
// trunk show usually travels on an ATA Carnet, so duty is deferred).
type ShippingInput = {
  destination_country?: string; pieces?: number; weight_kg?: number;
  declared_value?: number; round_trip?: boolean;
};
function estimateShipping(input: ShippingInput) {
  const raw = String(input.destination_country ?? "").trim().toUpperCase();
  const zoneOf = (c: string): { zone: string; ratePerKg: number; dutyPct: number; vatPct: number } => {
    if (["US", "USA", "UNITED STATES"].includes(c)) return { zone: "US", ratePerKg: 16, dutyPct: 0.055, vatPct: 0.07 };
    if (["GB", "UK", "UNITED KINGDOM", "ENGLAND"].includes(c)) return { zone: "UK", ratePerKg: 12, dutyPct: 0.025, vatPct: 0.20 };
    if (["CH", "SWITZERLAND", "SVIZZERA"].includes(c)) return { zone: "CH", ratePerKg: 14, dutyPct: 0.02, vatPct: 0.081 };
    if (["IT", "FR", "DE", "ES", "EU", "ITALY", "ITALIA", "FRANCE", "GERMANY", "SPAIN"].includes(c)) return { zone: "EU", ratePerKg: 8, dutyPct: 0, vatPct: 0 };
    return { zone: "Other", ratePerKg: 18, dutyPct: 0.05, vatPct: 0.15 };
  };
  const z = zoneOf(raw);
  // ~0.6 kg per piece incl. protective packaging; min chargeable weight 5 kg.
  const weight = input.weight_kg && input.weight_kg > 0
    ? input.weight_kg
    : Math.max(5, Math.round((Number(input.pieces) || 0) * 0.6 * 10) / 10);
  const legs = input.round_trip === false ? 1 : 2;
  const freight = Math.round(weight * z.ratePerKg * legs);
  const declared = Number(input.declared_value) || 0;
  const duty = Math.round(declared * z.dutyPct);
  const vat = Math.round((declared + duty) * z.vatPct);
  return {
    disclaimer: "Rough estimate, not a live carrier quote. Duty/VAT apply only if pieces are SOLD / permanently imported; trunk-show goods usually travel on an ATA Carnet (temporary import, duty deferred until sold).",
    destination: raw || "unknown",
    zone: z.zone,
    weight_kg: weight,
    legs: legs === 2 ? "round trip" : "one way",
    currency: "EUR",
    freight_estimate: freight,
    duty_estimate_if_sold: duty,
    vat_estimate_if_sold: vat,
    total_if_all_sold: freight + duty + vat,
    rates_used: { freight_per_kg: z.ratePerKg, duty_pct: z.dutyPct, vat_pct: z.vatPct },
    ata_carnet_recommended: z.zone !== "EU",
  };
}

// Brand-scoped knowledge retrieval: embed the query, vector-search a broad
// candidate set, rerank for precision (Voyage rerank), then diversify so the
// answer draws on several documents rather than many chunks of one.
// RLS on the chunks table is the real brand gate.
async function searchKnowledge(
  client: ReturnType<typeof createClient>,
  brandId: number,
  query: string,
): Promise<KMatch[]> {
  if (!query) return [];

  const embedding = await voyageEmbedQuery(query);
  const { data, error } = await client.rpc("match_brand_knowledge", {
    p_brand_id: brandId,
    p_query_embedding: embedding,
    p_match_count: 18,
    p_min_similarity: 0.12,
  });
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as KMatch[];
  if (rows.length === 0) return [];

  // Rerank for precision (best-effort — fall back to vector order on failure).
  let reranked = false;
  try {
    const ranked = await voyageRerank(query, rows.map((r) => r.content));
    if (ranked.length) { rows = ranked.map((r) => ({ ...rows[r.index], similarity: r.score })); reranked = true; }
  } catch (e) {
    console.warn("[brand-assistant rerank]", e instanceof Error ? e.message : e);
  }

  // Keep only genuinely-relevant, non-trivial chunks so we don't surface (or
  // feed the model) weak matches that didn't inform the answer. Rerank scores
  // and cosine similarities live on different scales, hence two thresholds.
  const REL_MIN = reranked ? 0.3 : 0.45;
  rows = rows.filter((r) => (r.similarity ?? 0) >= REL_MIN && (r.content?.trim().length ?? 0) >= 40);

  // Diversify: at most 2 chunks per document, top 6 overall.
  const perDoc = new Map<string, number>();
  const out: KMatch[] = [];
  for (const r of rows) {
    const n = perDoc.get(r.doc_id) ?? 0;
    if (n >= 2) continue;
    perDoc.set(r.doc_id, n + 1);
    out.push(r);
    if (out.length >= 8) break;
  }
  return out;
}

async function voyageEmbedQuery(query: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: [query], model: EMBED_MODEL, input_type: "query", output_dimension: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`Voyage embed failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const embedding = (await res.json())?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("no embedding returned");
  return embedding;
}

// Embed a photo with Voyage multimodal (same 1024-dim space as the indexed
// catalogue images). input_type "query" — this is the search side.
async function voyageEmbedImage(dataUrl: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [{ content: [{ type: "image_base64", image_base64: dataUrl }] }],
      model: "voyage-multimodal-3.5",
      input_type: "query",
      output_dimension: EMBED_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`Voyage multimodal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const embedding = (await res.json())?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("no image embedding returned");
  return embedding;
}

// Parse and lightly validate a base64 image data URL from the client.
function parseDataUrl(input: unknown): { mediaType: string; data: string } | null {
  if (typeof input !== "string") return null;
  const m = input.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const data = m[2].replace(/\s+/g, "");
  // Guard against oversized payloads (~8MB of base64 ≈ 6MB image).
  if (data.length < 32 || data.length > 8_000_000) return null;
  const mediaType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  return { mediaType, data };
}

async function voyageRerank(query: string, documents: string[]): Promise<{ index: number; score: number }[]> {
  const res = await fetch("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, documents, model: "rerank-2.5", top_k: 8, truncation: true }),
  });
  if (!res.ok) throw new Error(`rerank ${res.status}`);
  const json = await res.json();
  const results = json?.data ?? json?.results ?? [];
  return results
    .map((r: { index: number; relevance_score: number }) => ({ index: r.index, score: r.relevance_score }))
    .filter((r: { index: number }) => Number.isInteger(r.index));
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ─── Per-brand assistant config ──────────────────────────────────────────────
type AssistantConfig = {
  assistant_name: string | null;
  custom_instructions: string | null;
  data_home: "sql" | "knowledge" | "hybrid";
  signature_moves: { title?: string; prompt?: string }[];
  scope_note: string | null;
};

async function loadAssistantConfig(
  client: ReturnType<typeof createClient>, brandId: number | null,
): Promise<AssistantConfig | null> {
  if (!brandId) return null;
  const { data } = await client
    .from("brand_assistant_config")
    .select("assistant_name, custom_instructions, data_home, signature_moves, scope_note")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const dh = row.data_home === "knowledge" || row.data_home === "hybrid" ? row.data_home : "sql";
  return {
    assistant_name: (row.assistant_name as string) ?? null,
    custom_instructions: (row.custom_instructions as string) ?? null,
    data_home: dh as AssistantConfig["data_home"],
    signature_moves: Array.isArray(row.signature_moves)
      ? (row.signature_moves as { title?: string; prompt?: string }[])
      : [],
    scope_note: (row.scope_note as string) ?? null,
  };
}

// Default signature moves — the proactive plays that fit almost any luxury
// fashion/accessories house. Applied automatically to any brand that hasn't
// authored its own, so a brand-new brand still gets a real selling assistant.
const DEFAULT_SIGNATURE_MOVES: { title: string; prompt: string }[] = [
  {
    title: "Completa il look (styling / cross-sell)",
    prompt:
      "from a chosen piece OR a client, build ONE coordinated outfit from the " +
      "live catalogue — the hero piece plus complementary accessories, shoes, " +
      "bag or jewellery in matching colours/collection (and the client's size/" +
      "colours when known). Pull the pieces with run_sql on storefront_products " +
      "selecting image_url so they render as photo cards, then add ONE short line " +
      "on why they work together. Prefer available pieces.",
  },
  {
    title: "Clienteling message",
    prompt:
      "when asked to write to a client, draft a short, warm, ready-to-send " +
      "WhatsApp/email note — personalised from what you know about them " +
      "(favourite categories, sizes, colours, last purchase) and the relevant NEW " +
      "arrivals from the catalogue. Put the message in a Markdown quote block (>) " +
      "so the associate can copy it verbatim, in the client's language, with an " +
      "elegant sign-off, never pushy.",
  },
  {
    title: "Styling from an inspiration photo",
    prompt:
      "if the associate attaches a photo as INSPIRATION (a look to recreate, not " +
      "an exact item to identify), use the visual matches as a starting point and " +
      "build a coordinated outfit around the closest pieces — and say clearly it's " +
      "a styling suggestion inspired by the photo, not an exact match.",
  },
];

// Auto-detect where a brand's data lives from what it actually holds, so a brand
// never has to pick the (error-prone) "where your data lives" option by hand:
//   • real CRM clients + a knowledge base  → 'hybrid' (check both)
//   • a knowledge base but no CRM clients  → 'knowledge' (clients live in cards)
//   • CRM clients only / nothing yet       → 'sql' (the historical default)
// Uses the service client (metadata counts only, explicit brand filter — never
// reads another brand's rows).
async function detectDataHome(
  client: ReturnType<typeof createClient>, brandId: number,
): Promise<AssistantConfig["data_home"]> {
  try {
    const [clients, kb] = await Promise.all([
      client.from("profiles").select("id", { count: "exact", head: true })
        .eq("brand_id", brandId).or("role.is.null,role.eq.customer"),
      client.from("brand_knowledge_chunks").select("id", { count: "exact", head: true })
        .eq("brand_id", brandId),
    ]);
    // A handful of stray/test profiles shouldn't count as "the CRM has clients".
    const hasCrm = (clients.count ?? 0) >= 10;
    const hasKb = (kb.count ?? 0) > 0;
    if (hasKb && !hasCrm) return "knowledge";
    if (hasKb && hasCrm) return "hybrid";
    return "sql";
  } catch (e) {
    console.warn("[brand-assistant detectDataHome]", e instanceof Error ? e.message : e);
    return "sql";
  }
}

// The config a brand gets when it hasn't saved one: detected data location +
// default signature moves. Name/instructions stay empty (sensible base persona).
async function autoAssistantConfig(
  client: ReturnType<typeof createClient>, brandId: number | null,
): Promise<AssistantConfig> {
  return {
    assistant_name: null,
    custom_instructions: null,
    data_home: brandId ? await detectDataHome(client, brandId) : "sql",
    signature_moves: DEFAULT_SIGNATURE_MOVES,
    scope_note: null,
  };
}

// Turn a brand's saved config into extra system blocks appended after the base
// persona. Absent/empty config yields no blocks — i.e. the default behaviour
// every brand had before this table existed.
function buildBrandBlocks(cfg: AssistantConfig | null, brandName: string | null): string[] {
  if (!cfg) return [];
  const who = brandName ?? "this brand";
  const blocks: string[] = [];

  if (cfg.assistant_name?.trim()) {
    blocks.push(`\n\n# Your name\nThe associates call you "${cfg.assistant_name.trim()}". Use it if you introduce yourself.`);
  }

  if (cfg.data_home === "knowledge") {
    blocks.push(`\n\n# Where this brand's data lives (IMPORTANT)\nFor ${who}, the clients and much of the product knowledge live in the KNOWLEDGE BASE as text cards, NOT in the SQL CRM. For any question about a specific client (history, spend, sizes, preferences, segment) or a style/product recommendation, use search_knowledge by name FIRST — profiles/policies are empty for this brand's clients, so run_sql would wrongly return "no customer". Use run_sql on storefront_products for live price / availability / what's online. Combine both when useful and cite what you used.`);
  } else if (cfg.data_home === "hybrid") {
    blocks.push(`\n\n# Where this brand's data lives\nFor ${who}, clients and products may live in BOTH the CRM (run_sql on profiles/policies) and the KNOWLEDGE BASE (search_knowledge cards). Check BOTH before concluding a client or product can't be found, and cite what you used.`);
  }

  if (cfg.custom_instructions?.trim()) {
    blocks.push(`\n\n# ${who} — house instructions\n${cfg.custom_instructions.trim()}`);
  }

  const moves = cfg.signature_moves.filter((m) => m && (m.title || m.prompt));
  if (moves.length) {
    const list = moves
      .map((m) => `- ${m.title ? `${m.title.toUpperCase()}: ` : ""}${(m.prompt ?? "").trim()}`.trim())
      .join("\n");
    blocks.push(`\n\n# Signature moves for the associate (offer proactively when it helps a sale)\n${list}`);
  }

  if (cfg.scope_note?.trim()) {
    blocks.push(`\n\n# Extra scope guidance\n${cfg.scope_note.trim()}`);
  }

  return blocks;
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// Assemble a structured report payload from RLS-safe SQL (via ai_run_query_user,
// so a brand user only ever sees their own brand). The frontend renders it with
// charts + PDF/Excel download.
type Row = Record<string, unknown>;

// Every report query runs pinned to brandId (the scoped runner), so an admin
// viewing-as a brand can't pull another brand's rows even via a model-authored
// custom section. brandId null = cross-brand admin → the unscoped admin runner.
async function runReportSql(client: ReturnType<typeof createClient>, brandId: number | null, sql: string): Promise<Row[]> {
  const { data, error } = brandId == null
    ? await client.rpc("ai_run_query", { p_sql: sql })
    : await client.rpc("ai_run_query_scoped", { p_sql: sql, p_brand_id: brandId });
  if (error) throw new Error(error.message);
  return ((data as { rows?: Row[] })?.rows) ?? [];
}
const q = (s: string) => s.replace(/'/g, "''"); // escape single quotes
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const eurFmt = (v: unknown) => `€${Math.round(num(v)).toLocaleString("it-IT")}`;
const humanize = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const looksMoney = (c: string) => /(price|revenue|spend|ticket|value|amount|premium|cost|total|selling)/i.test(c);

// Every report — the client & performance presets AND any ad-hoc request — is a
// generic list of sections the frontend renders (and exports to PDF/Excel).
// Section shapes: kpis {label,value}, bar|line|pie {label,value}, table
// {columns,rows}, products {name,subtitle,price,image_url,url}, note {body}.
type Section =
  | { type: "kpis"; title?: string; items: { label: string; value: string }[] }
  | { type: "bar" | "line" | "pie"; title?: string; unit?: "eur" | "num"; data: { label: string; value: number }[] }
  | { type: "table"; title?: string; columns: { key: string; header: string }[]; rows: Row[] }
  | { type: "products"; title?: string; items: { name: string; subtitle?: string | null; price?: number | null; image_url?: string | null; url?: string | null }[] }
  | { type: "note"; title?: string; body: string };

async function buildReport(
  client: ReturnType<typeof createClient>, brandId: number | null, brandName: string | null,
  input: { kind?: string; client?: string; period?: string; title?: string; subtitle?: string; sections?: unknown },
) {
  const generated_at = new Date().toISOString();
  const isCustom = input.kind === "custom" || Array.isArray(input.sections);
  // The client/performance presets are single-brand by construction. A cross-brand
  // admin (brandId null) must use a custom report with its own brand grouping.
  if (brandId == null && !isCustom) {
    return { error: "Pick a brand for a client or performance report, or build a custom report (its SQL can group across brands)." };
  }
  const result = input.kind === "performance"
    ? await buildPerformanceReport(client, brandId as number, brandName, input.period === "week" ? "week" : "month", generated_at)
    : isCustom
      ? await buildCustomReport(client, brandId, brandName, input, generated_at)
      : await buildClientReport(client, brandId as number, brandName, input.client ?? "", generated_at);
  // Brand the report with the requesting brand's logo (optional).
  if (brandId != null && !(result as { error?: string }).error) {
    try {
      const { data } = await client.from("brands").select("logo_big").eq("id", brandId).maybeSingle();
      (result as { brand_logo?: string | null }).brand_logo = (data as { logo_big?: string } | null)?.logo_big ?? null;
    } catch { /* logo is optional */ }
  }
  return result;
}

// Ad-hoc report: the model supplies a title + sections, each with a SQL query and
// a type; we run each query (RLS-safe) and shape the rows to the section type.
async function buildCustomReport(
  client: ReturnType<typeof createClient>, brandId: number | null, brandName: string | null,
  input: { title?: string; subtitle?: string; sections?: unknown }, generated_at: string,
) {
  const title = String(input.title ?? "Report").trim() || "Report";
  const specs = Array.isArray(input.sections) ? input.sections : [];
  if (specs.length === 0) return { error: "Provide at least one section (type + sql) for a custom report." };

  const sections: Section[] = [];
  for (const raw of specs) {
    const spec = raw as { type?: string; title?: string; sql?: string; unit?: string; body?: string };
    const type = spec.type ?? "table";
    if (type === "note") { sections.push({ type: "note", title: spec.title, body: String(spec.body ?? "") }); continue; }
    if (!spec.sql) continue;
    let rows: Row[] = [];
    try { rows = await runReportSql(client, brandId, spec.sql); }
    catch (e) { console.warn("[custom section]", e instanceof Error ? e.message : e); continue; }
    const cols = rows.length ? Object.keys(rows[0]).filter((c) => !/(^|_)id$/i.test(c)) : [];
    const unit = spec.unit === "eur" ? "eur" : (spec.unit === "num" ? "num" : undefined);

    if (type === "kpis") {
      const r = rows[0] ?? {};
      sections.push({ type: "kpis", title: spec.title, items: cols.map((c) => ({ label: humanize(c), value: looksMoney(c) || unit === "eur" ? eurFmt(r[c]) : String(r[c] ?? "—") })) });
    } else if (type === "bar" || type === "line" || type === "pie") {
      const [labCol, valCol] = [cols[0], cols[1]];
      sections.push({ type, title: spec.title, unit: unit ?? (valCol && looksMoney(valCol) ? "eur" : "num"), data: rows.map((r) => ({ label: String(r[labCol] ?? "—"), value: num(r[valCol]) })) });
    } else if (type === "products") {
      sections.push({ type: "products", title: spec.title, items: rows.map((r) => shapeProduct(r)) });
    } else {
      sections.push({ type: "table", title: spec.title, columns: cols.map((c) => ({ key: c, header: humanize(c) })), rows });
    }
  }
  if (sections.length === 0) return { error: "None of the report sections returned data — check the queries." };
  return { title, subtitle: input.subtitle ?? null, generated_at, brand: brandName, sections };
}

// Map a result row to a product card (detect the usual columns).
function shapeProduct(r: Row) {
  const pick = (re: RegExp) => Object.keys(r).find((k) => re.test(k));
  const nameC = pick(/^(name|title|product|prodotto)$/i) ?? pick(/name/i);
  const subC = pick(/^(collection|collezione|category|categoria)$/i);
  const priceC = pick(/(^|_)(price|selling_price|value)$/i);
  const imgC = pick(/(^|_)(image_url|picture|photo|image)$/i);
  const urlC = pick(/(^|_)(product_url|url|link)$/i);
  return {
    name: nameC ? String(r[nameC] ?? "—") : "—",
    subtitle: subC ? (r[subC] as string ?? null) : null,
    price: priceC ? (r[priceC] != null ? num(r[priceC]) : null) : null,
    image_url: imgC ? (r[imgC] as string ?? null) : null,
    url: urlC ? (r[urlC] as string ?? null) : null,
  };
}

async function buildClientReport(
  client: ReturnType<typeof createClient>, brandId: number, brandName: string | null, who: string, generated_at: string,
) {
  who = who.trim();
  if (!who) return { error: "Ask the associate which client the report is for." };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(who);
  // Scope to this brand explicitly — RLS is unscoped for an admin caller, so an
  // admin "viewing-as" a brand must not resolve another brand's client.
  const where = isUuid
    ? `id = '${who}' AND brand_id = ${brandId}`
    : `brand_id = ${brandId} AND (role IS NULL OR role = 'customer') AND (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ILIKE '%${q(who)}%'`;
  const people = await runReportSql(client, brandId,
    `SELECT id, first_name, last_name, email, phone_number, city, country, date_of_birth, registered_at FROM profiles WHERE ${where} LIMIT 6`);
  if (people.length === 0) return { error: `No client matches "${who}". Ask the associate to check the name.` };
  if (people.length > 1) {
    const names = people.map((p) => `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()).join(", ");
    return { error: `Several clients match "${who}": ${names}. Ask which one before generating the report.` };
  }
  const c = people[0];
  const id = String(c.id);

  const purchases = await runReportSql(client, brandId, `
    SELECT c.name, c.collection, COALESCE(s.image_url, c.picture) AS image_url,
           s.price AS online_price, po.selling_price, po.start_date, po.status
    FROM policies po JOIN catalogues c ON c.id = po.item_id
    LEFT JOIN storefront_products s ON s.brand_id = po.brand_id AND s.sku = c.sku
    WHERE po.customer_id = '${id}' AND po.brand_id = ${brandId} ORDER BY po.start_date DESC`);
  // Claims + feedback are best-effort — a hiccup here must never sink the report.
  let claims: Row[] = [];
  try {
    claims = await runReportSql(client, brandId, `
      SELECT cl.type, cl.status, cl.incident_date
      FROM claims cl JOIN policies po ON po.id = cl.policy_id
      WHERE po.customer_id = '${id}' AND po.brand_id = ${brandId} ORDER BY cl.incident_date DESC NULLS LAST`);
  } catch (e) { console.warn("[report claims]", e instanceof Error ? e.message : e); }
  // Read feedback via the query builder, NOT ai_run_query_user: its SQL keyword
  // blocklist rejects the literal column name "comment".
  let fbRows: Row[] = [];
  try {
    const { data: fbData } = await client
      .from("feedback")
      .select("satisfaction_rate, recommendation_rate, peace_of_mind_rate, comment")
      .eq("user_id", id)
      .order("id", { ascending: false })
      .limit(1);
    fbRows = (fbData ?? []) as Row[];
  } catch (e) { console.warn("[report feedback]", e instanceof Error ? e.message : e); }

  const spend = purchases.reduce((s, p) => s + num(p.selling_price), 0);
  const dates = purchases.map((p) => String(p.start_date ?? "")).filter(Boolean).sort();
  const openClaims = claims.filter((c) => !/closed|resolved|rejected|settled/i.test(String(c.status ?? ""))).length;
  const byYear = new Map<string, number>();
  for (const p of purchases) {
    const y = String(p.start_date ?? "").slice(0, 4);
    if (y) byYear.set(y, (byYear.get(y) ?? 0) + num(p.selling_price));
  }

  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
  const since = dates[0] ? dates[0].slice(0, 10) : (c.registered_at ? String(c.registered_at).slice(0, 10) : null);
  const sections: Section[] = [];
  sections.push({ type: "kpis", items: [
    { label: "Spesa totale", value: eurFmt(spend) },
    { label: "Pezzi", value: String(purchases.length) },
    { label: "Scontrino medio", value: eurFmt(purchases.length ? spend / purchases.length : 0) },
    { label: "Claim aperti", value: String(openClaims) },
  ] });
  if (byYear.size > 1) {
    sections.push({ type: "bar", title: "Spesa per anno", unit: "eur",
      data: [...byYear.entries()].sort().map(([label, value]) => ({ label, value: Math.round(value) })) });
  }
  if (purchases.length) {
    sections.push({ type: "products", title: "Pezzi acquistati", items: purchases.map((p) => ({
      name: String(p.name ?? "—"), subtitle: (p.collection as string) ?? null,
      price: num(p.selling_price) || (p.online_price != null ? num(p.online_price) : null),
      image_url: (p.image_url as string) ?? null, url: null,
    })) });
  }
  const fb = fbRows[0];
  if (fb) {
    sections.push({ type: "kpis", title: "Feedback", items: [
      { label: "Soddisfazione", value: `${num(fb.satisfaction_rate)}/5` },
      { label: "Raccomandazione", value: `${num(fb.recommendation_rate)}/5` },
      { label: "Serenità", value: `${num(fb.peace_of_mind_rate)}/5` },
    ] });
    if (fb.comment) sections.push({ type: "note", body: `“${String(fb.comment)}”` });
  }
  const meta = [ [c.city, c.country].filter(Boolean).join(", "), since ? `cliente dal ${since}` : "", c.email ?? "" ].filter(Boolean).join(" · ");
  return { title: `Report cliente — ${name}`, subtitle: meta || null, generated_at, brand: brandName, sections };
}

async function buildPerformanceReport(
  client: ReturnType<typeof createClient>, brandId: number, brandName: string | null, period: "week" | "month", generated_at: string,
) {
  const interval = period === "week" ? "84 days" : "365 days";
  // Explicit brand scope (RLS is unscoped for an admin caller).
  const win = `brand_id = ${brandId} AND start_date >= (CURRENT_DATE - interval '${interval}')`;

  const series = await runReportSql(client, brandId, `
    SELECT to_char(date_trunc('${period}', start_date), 'YYYY-MM-DD') AS bucket,
           count(*) AS covers, COALESCE(SUM(selling_price),0) AS revenue
    FROM policies WHERE ${win} GROUP BY 1 ORDER BY 1`);
  const kpiRow = (await runReportSql(client, brandId, `
    SELECT COALESCE(SUM(selling_price),0) AS revenue, count(*) AS covers,
           count(DISTINCT customer_id) AS customers
    FROM policies WHERE ${win}`))[0] ?? {};
  const claimsRow = (await runReportSql(client, brandId, `
    SELECT count(*) AS claims FROM claims cl JOIN policies po ON po.id = cl.policy_id
    WHERE po.brand_id = ${brandId} AND cl.incident_date >= (CURRENT_DATE - interval '${interval}')`))[0] ?? {};
  const categoryMix = await runReportSql(client, brandId, `
    SELECT c.category AS label, count(*) AS count, COALESCE(SUM(po.selling_price),0) AS revenue
    FROM policies po JOIN catalogues c ON c.id = po.item_id
    WHERE po.${win} GROUP BY 1 ORDER BY revenue DESC LIMIT 8`);
  const topCollections = await runReportSql(client, brandId, `
    SELECT c.collection AS label, count(*) AS count, COALESCE(SUM(po.selling_price),0) AS revenue
    FROM policies po JOIN catalogues c ON c.id = po.item_id
    WHERE po.${win} AND c.collection IS NOT NULL GROUP BY 1 ORDER BY revenue DESC LIMIT 6`);
  const topClients = await runReportSql(client, brandId, `
    SELECT trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) AS label,
           count(*) AS count, COALESCE(SUM(po.selling_price),0) AS revenue
    FROM policies po JOIN profiles p ON p.id = po.customer_id
    WHERE po.${win} GROUP BY 1 ORDER BY revenue DESC LIMIT 6`);

  const revenue = num(kpiRow.revenue), covers = num(kpiRow.covers);
  const rangeLabel = period === "week" ? "ultime 12 settimane" : "ultimi 12 mesi";
  const tableRows = (rows: Row[]) => rows.map((r) => ({ label: r.label ?? "—", count: num(r.count), revenue: num(r.revenue) }));
  const sections: Section[] = [
    { type: "kpis", items: [
      { label: "Ricavi", value: eurFmt(revenue) },
      { label: "Pezzi venduti", value: String(covers) },
      { label: "Scontrino medio", value: eurFmt(covers ? revenue / covers : 0) },
      { label: "Clienti", value: String(num(kpiRow.customers)) },
      { label: "Claim", value: String(num(claimsRow.claims)) },
    ] },
    { type: "bar", title: "Andamento ricavi", unit: "eur",
      data: series.map((r) => ({ label: String(r.bucket).slice(period === "month" ? 0 : 5, period === "month" ? 7 : 10), value: num(r.revenue) })) },
    { type: "pie", title: "Mix categorie (ricavi)", unit: "eur",
      data: categoryMix.map((r) => ({ label: String(r.label ?? "—"), value: num(r.revenue) })) },
    { type: "table", title: "Top collezioni",
      columns: [{ key: "label", header: "Collezione" }, { key: "count", header: "Pezzi" }, { key: "revenue", header: "Ricavi" }],
      rows: tableRows(topCollections) },
    { type: "table", title: "Top clienti",
      columns: [{ key: "label", header: "Cliente" }, { key: "count", header: "Pezzi" }, { key: "revenue", header: "Ricavi" }],
      rows: tableRows(topClients) },
  ];
  return { title: `Performance ${period === "week" ? "settimanale" : "mensile"}`, subtitle: `${brandName ?? ""} · ${rangeLabel}`.trim(), generated_at, brand: brandName, sections };
}

// Suggest 3 follow-up questions the associate might tap next.
async function generateFollowups(
  anthropic: Anthropic, messages: Anthropic.MessageParam[], locale: string,
): Promise<string[]> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content as string | undefined;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const answer = Array.isArray(lastAssistant?.content)
    ? (lastAssistant!.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ")
    : "";
  if (!lastUser && !answer) return [];
  const lang = locale === "it" ? "Italian" : "English";
  const res = await anthropic.messages.create({
    model: FOLLOWUP_MODEL,
    max_tokens: 220,
    system: `You suggest what a luxury-boutique sales associate might ask their in-store AI assistant NEXT, given the last exchange. Output STRICT JSON only: an array of exactly 3 short, distinct, useful follow-up questions (each <= 60 characters), written in ${lang}, phrased as the associate would type them. They must build naturally on the conversation (a related product, the client, a care/policy detail, a cross-sell). No preamble, no markdown fences — just the JSON array.`,
    messages: [{ role: "user", content: `Last question: ${lastUser ?? ""}\n\nAssistant answer: ${answer.slice(0, 1400)}\n\nReturn the JSON array of 3 follow-ups.` }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  try {
    const arr = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.length > 0).slice(0, 3) : [];
  } catch { return []; }
}
