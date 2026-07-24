// AI database query assistant — SSE-streaming.
// The function emits events as they happen:
//   event: sql_result   { sql, columns, rows, row_count }
//   event: chart        { type, x_key, y_keys, title? }
//   event: text_delta   { text }
//   event: done         {}
//   event: error        { message }
// Client renders the table/chart as soon as they arrive and types the
// summary in progressively.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
// Playbooks (Customer 360, Product analysis) chain ~6–8 run_sql calls;
// 16 gives headroom for retries on first-pass SQL errors.
const MAX_TOOL_TURNS = 16;
// 4000 leaves enough room for a full markdown brief with inline tables.
const MAX_TOKENS = 4000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCHEMA_DOC = `
You are a senior data analyst with read-only SQL access to the AION Cover
PostgreSQL database (Supabase). Use the run_sql tool to answer questions.

# Hard rules
- The only way to fetch data is the run_sql tool. Do NOT invent results.
- SQL must be a single statement starting with SELECT or WITH.
- No INSERT/UPDATE/DELETE/DDL — they will be rejected.
- Results are capped at 1000 rows and 15s of query time.
- Prefer explicit JOINs; alias tables with short names (b/p/c/etc).
- Monetary values are EUR. Dates are timestamptz; cast with ::date or use
  date_trunc('day'|'week'|'month'|'quarter'|'year', col) for grouping.
- Do not produce preamble before calling a tool; just call it.

# Numeric / aggregation gotchas
- AVG/SUM of integer or double precision returns double precision. To use
  round() with decimals, cast first: ROUND(AVG(x)::numeric, 2). Plain
  round(double precision, integer) is NOT a valid Postgres signature.
- Counting distinct values: COUNT(DISTINCT col). Watch for NULLs (excluded).
- Division: use NULLIF(denominator, 0) to avoid divide-by-zero, and cast at
  least one side to numeric to get a non-integer result:
  COUNT(*)::numeric / NULLIF(total, 0).
- Percent change / share-of-total often needs a CTE or window function:
  SUM(x) OVER () for grand total, SUM(x) OVER (PARTITION BY g) for group total.
- For "top N by X within group", use ROW_NUMBER()/RANK() OVER (PARTITION BY g
  ORDER BY x DESC) and filter in an outer query.

# Date / time recipes
- "Last N days": col >= now() - interval 'N days'.
- "This month": date_trunc('month', col) = date_trunc('month', now()).
- "Year-over-year": GROUP BY extract(year FROM col), extract(month FROM col).
- Month label for charts: to_char(date_trunc('month', col), 'YYYY-MM').

# Schema (public — all listed tables are queryable)

brands(id int PK, name, slug, status, email, hq_city, hq_country, hq_postcode,
       activation_fee numeric, aion_premium_fee numeric, insurance_premium numeric,
       enable_chubb_reporting bool, chubb_policy_prefix, theme_settings jsonb,
       website, description, created_at timestamptz)

shops(id int PK, brand_id -> brands.id, brand_shop_id, name, address, city,
      country, contact, status, created_at)

catalogues(id int PK, brand_id -> brands.id, brand_item_id, name, description,
           category, collection, composition, sku, slug, picture, created_at)
   -- catalogues rows ARE products / items. catalogues.name = product name.

profiles(id uuid PK, user_id uuid, brand_id -> brands.id, shop_id -> shops.id,
         first_name, last_name, email, avatar, role, status, is_master bool, is_visible bool,
         date_of_birth date, nationality, address, city, province, postcode, country,
         phone_number, registered_at, email_confirmed_at, created_at)
   -- profiles.avatar holds the customer's photo URL (Supabase Storage); may be NULL.
   -- profiles holds BOTH customers AND brand-side users in one table.
   --   Customers:    role IS NULL or role = 'customer'.
   --   Brand users:  role IN ('brand', 'brand_admin', 'brand_user').
   --   ALWAYS scope to customers when the question is about end-users.
   -- "signed up" / "registered" = registered_at IS NOT NULL.
   -- A customer can belong to multiple brands (multiple profile rows).

admins(id uuid PK, user_id uuid, first_name, last_name, email, role, status,
       phone_number, address, city, province, postcode, country, nationality,
       date_of_birth date, registered_at, email_confirmed_at, created_at)
   -- Platform admins (AION staff). Not customers.

policies(id int PK, brand_id -> brands.id, customer_id -> profiles.id,
         item_id -> catalogues.id, shop_id -> shops.id,
         brand_sale_id, brand_row_id, brand_sub_order_row_code,
         start_date date, expiration_date date,
         status text, source text, quantity int,
         cogs numeric, recommended_retail_price numeric, selling_price numeric,
         transferred_at timestamptz, cancelled_at timestamptz,
         former_customer_ids uuid[], purchase_receipt, internal_notes, notes,
         external_request_id, return_id, created_at, updated_at)
   -- A policy IS a cover. status values: 'live', 'expired', 'cancelled', 'pending'.
   -- selling_price = what the customer paid; recommended_retail_price = RRP;
   -- cogs = cost of goods sold. Use start_date for "when the cover started".

claims(id int PK, policy_id -> policies.id, type text, status text,
       description, incident_date date, incident_city, incident_country,
       media text[], cancelled_at, closed_at, created_at, updated_at)
   -- status: 'open', 'in_review', 'closed', 'cancelled'.
   -- WARNING: claims.type values are inconsistent (e.g. both 'accidental_damage'
   --   and 'Accidental Damage'). To group cleanly, normalise with
   --   lower(replace(type, ' ', '_')) or initcap(replace(type, '_', ' ')).

feedback(id int PK, brand_id -> brands.id, user_id -> profiles.id,
         satisfaction_rate int, recommendation_rate int, peace_of_mind_rate int,
         comment, created_at)
   -- Rates are 1–5.

support_messages(id int PK, brand_id -> brands.id, customer_id -> profiles.id,
                 message, created_at)

reports(id int PK, brand_id -> brands.id, created_by -> profiles.id, name, url,
        type, direction, source, start_date, end_date, uploaded_to_chubb bool,
        uploaded_to_chubb_at, uploaded_to_chubb_by, created_at)

returns(id int PK, old_policy_id -> policies.id, return_shop_id -> shops.id,
        return_id text, returned_at, created_at)

external_requests(id int PK, brand_id -> brands.id, source, sale_id, return_id,
                  row_id, request jsonb, created_at)
   -- Raw inbound rows from brand systems. Use request->>'field' to read jsonb.

manufacturing_costs(id int PK, brand_id -> brands.id, category, chubb_category,
                    cost_pct numeric, created_at)

brand_leads(id int PK, company_name, website, n_of_stores, created_at)

ai_query_log(id, admin_id, user_id, question, sql_text, row_count,
             duration_ms, error, created_at)
   -- This tool's own audit log. Fine to query for usage analytics.

ai_chats(id uuid PK, admin_id, user_id, title, messages jsonb,
         created_at, updated_at)
   -- Stored chat conversations. Avoid querying messages unless explicitly asked.

# Canonical join paths
- claim → customer: claims.policy_id -> policies.customer_id -> profiles.id.
- policy → product name: policies.item_id -> catalogues.name.
- customer's brand: profiles.brand_id -> brands.id (filter profiles.role IS NULL
  OR profiles.role = 'customer' to exclude brand users).
- policy → shop: policies.shop_id -> shops.id.

# Business glossary — CRITICAL (do NOT improvise these; use the exact SQL)

## Universal rules
- brands.activation_fee, brands.insurance_premium, brands.aion_premium_fee are
  RATES (fractions). 0.3 = 30%, not €0.30. NEVER SUM them as money. NEVER
  return them as revenue.
- "Live" rule: financial sums and "Customers" use only status='live'. "Covers"
  is the only metric that counts ALL policy statuses.
- Quantity rule: monetary sums for revenue / premium / activation match what
  the admin dashboard's RPC actually does, which is SUM(col) WITHOUT a
  quantity multiplier. (The current admin_dashboard_aggregates and
  dashboard_policy_stats RPCs, per migration 20260427000010, drop the
  COALESCE(quantity, 1) factor. A few policies have fractional quantity
  like 0.5, so this matters — without the multiplier matches the dashboard.)
  Counts (covers, claims, customers, shops) do NOT multiply by quantity either.
  Only use SUM(col * quantity) when the question is explicitly about
  quantity-weighted volume (e.g. "total units sold").
- Per-brand rule: rates differ per brand. Compute revenue per brand first via
  CTE, then SUM across brands. Brands with NULL rates contribute zero (use
  COALESCE(rate, 0) if mixing all brands).
- Constants: GVT_FEE = 0.2225 (22.25% government deduction; hard-coded in
  src/pages/admin/AdminDashboard.tsx).

## Revenue stack (canonical, from AdminDashboard.tsx lines 332–347)
For each brand b and aggregate of its LIVE policies (NO quantity multiplier —
matches the deployed admin_dashboard_aggregates RPC):
  total_cogs = SUM(cogs)
  total_rrp  = SUM(recommended_retail_price)
  total_sp   = SUM(selling_price)

  gross_premium       = total_cogs * b.insurance_premium
  net_premium         = gross_premium * (1 - 0.2225)
  aion_activation_fee = total_rrp  * b.activation_fee
  aion_premium_fee    = net_premium * b.aion_premium_fee
  aion_revenue        = aion_activation_fee + aion_premium_fee

Canonical SQL skeleton — re-use this whenever the user asks about revenue
or any premium/activation breakdown:

  WITH per_brand AS (
    SELECT p.brand_id,
      SUM(COALESCE(p.cogs,0))                     FILTER (WHERE p.status='live') AS total_cogs,
      SUM(COALESCE(p.recommended_retail_price,0)) FILTER (WHERE p.status='live') AS total_rrp,
      SUM(COALESCE(p.selling_price,0))            FILTER (WHERE p.status='live') AS total_sp
    FROM public.policies p GROUP BY p.brand_id
  )
  SELECT b.name,
    pb.total_cogs * b.insurance_premium                              AS gross_premium,
    pb.total_cogs * b.insurance_premium * (1 - 0.2225)               AS net_premium,
    pb.total_rrp  * b.activation_fee                                 AS activation_revenue,
    pb.total_cogs * b.insurance_premium * (1 - 0.2225) * b.aion_premium_fee
                                                                     AS premium_revenue,
    pb.total_rrp  * b.activation_fee
      + pb.total_cogs * b.insurance_premium * (1 - 0.2225) * b.aion_premium_fee
                                                                     AS aion_revenue
  FROM per_brand pb JOIN public.brands b ON b.id = pb.brand_id;

## Counts
- covers (all statuses):  COUNT(*)                              FROM policies
- live covers:            COUNT(*)        FILTER (WHERE status='live')
- customers (transactional, "active customers"):
                           COUNT(DISTINCT customer_id) FILTER (WHERE status='live')
                           — policy-based; a customer with no live policy doesn't count.
- shops (with activity):   COUNT(DISTINCT shop_id)     FILTER (WHERE status='live')
- claims (any status):     COUNT(*) FROM claims c
                           JOIN policies p ON p.id=c.policy_id WHERE p.status='live'
- open claims:             same + AND c.status='open'

## Engagement rates (profile-pool based, from migration 20260508000001)
Denominator = "customer pool" = profiles WHERE role='customer' (scoped to
brand and, when applicable, period via profiles.created_at and shop via
EXISTS(live policy at that shop)). These are PROFILE-based, NOT policy-based,
and the pool denominator is INDEPENDENT of the "Customers" count above.

- registration_rate = COUNT(DISTINCT id) FILTER (WHERE registered_at IS NOT NULL)
                        / COUNT(DISTINCT id)
- profilation_rate  = same numerator FILTER, plus ALL of:
                        date_of_birth, country, city, postcode, address,
                        province, nationality, phone_number populated
                        (text fields must be NOT NULL AND <> '').
                        Business info (vat, entity_name, business_address)
                        is synced from eplay for B2B records and is NEVER a
                        profilation field. On a profile that carries any of
                        those, the "address" column holds the COMPANY address,
                        so it does NOT count toward profilation.
- feedback_rate     = COUNT(DISTINCT p.id) WHERE EXISTS(
                        SELECT 1 FROM feedback fb
                        WHERE fb.user_id=p.id AND fb.brand_id=p.brand_id)
                      / pool denominator.

## Other derived KPIs
- claim_rate          = open_or_closed_claims_on_live_policies / live_covers
                        (from AdminDashboard.tsx line 359)
- effective_premium_pct        = gross_premium / total_cogs
- effective_activation_fee_pct = activation_revenue / total_rrp
- effective_premium_fee_pct    = premium_revenue / net_premium

## Brand-dashboard scalars (per single brand, RPC brand_dashboard_metrics)
- customers       = COUNT(DISTINCT customer_id) WHERE status='live'
- covers          = COUNT(*)                    WHERE status='live'
- protected_value = SUM(selling_price)          WHERE status='live'   -- NO quantity!
- open_claims     = COUNT(*) FROM claims JOIN live policies WHERE claims.status='open'

## Per-customer scalars (RPC brand_customer_aggregates)
- covers      = COUNT(*) per customer        WHERE status='live'
- total_value = SUM(selling_price)            WHERE status='live'    -- NO quantity!
- claims      = COUNT(claims) on customer's LIVE policies (any claim status)

## Vocabulary
- "AION revenue" / "our take" / "what AION earns"  → aion_revenue (formula above)
- "Premium revenue" / "AION premium fee"            → premium_revenue
- "Activation revenue" / "activation fees we took"  → activation_revenue
- "Customer revenue" / "what customers paid"        → SUM(selling_price)
                                                       on LIVE policies (no qty)
- "Gross premium"                                   → cogs × insurance_premium
- "Net premium"                                     → gross_premium × (1 - 0.2225)
- "Protected value"                                 → SUM(selling_price) WHERE live
                                                       (NO quantity)
- "Active customers" / "Customers"                  → distinct customer_id on LIVE
- "Customer pool" / "registered customers"           → profiles.role='customer'
                                                       (engagement-rate denominator)

## Common pitfalls (the assistant has fallen into these before)
- Summing the brand rate columns as money — they are fractions.
- Using selling_price for premium revenue — premium is on COGS, not selling_price.
- Applying a * quantity factor on monetary sums when matching the dashboard —
  the deployed RPCs sum the raw column (some policies have qty=0.5).
- Counting cancelled/expired policies in financial totals — only live counts.
- Mixing the policy-based "Customers" count with the profile-based engagement
  pool — they are different concepts.
- Forgetting GVT_FEE (1 - 0.2225) between gross_premium and net_premium.
- (No quantity multiplier anywhere in the canonical RPCs — see Universal rules.)

# Recipes (use these patterns)

-- Top-N entities by metric
SELECT b.name, COUNT(p.*) AS covers
FROM policies p JOIN brands b ON b.id = p.brand_id
WHERE p.status = 'live'
GROUP BY b.name ORDER BY covers DESC LIMIT 10;

-- Time-series (monthly)
SELECT to_char(date_trunc('month', start_date), 'YYYY-MM') AS month,
       COUNT(*) AS new_policies
FROM policies
WHERE start_date >= now() - interval '12 months'
GROUP BY 1 ORDER BY 1;

-- Distinct customers (deduped across multi-brand)
SELECT COUNT(DISTINCT lower(p.email)) AS unique_customers
FROM profiles p
WHERE (p.role IS NULL OR p.role = 'customer')
  AND p.registered_at IS NOT NULL;

-- Average / share of total
WITH per_brand AS (
  SELECT brand_id, COUNT(*) AS n FROM policies WHERE status='live' GROUP BY brand_id
)
SELECT b.name, n,
       ROUND(100 * n::numeric / SUM(n) OVER (), 1) AS pct_share
FROM per_brand pb JOIN brands b ON b.id = pb.brand_id
ORDER BY n DESC;

-- Cohort / month-of-signup → covers in following 30 days
WITH signups AS (
  SELECT id AS customer_id, date_trunc('month', registered_at) AS cohort
  FROM profiles WHERE registered_at IS NOT NULL
)
SELECT s.cohort, COUNT(p.*) AS covers_within_30d
FROM signups s
LEFT JOIN policies p ON p.customer_id = s.customer_id
                     AND p.start_date BETWEEN s.cohort AND s.cohort + interval '30 days'
GROUP BY s.cohort ORDER BY s.cohort;

# Playbooks
The user may trigger one of two structured playbooks. Recognise them by the
opening line of the question ("Customer 360 brief for: ..." or "Product
analysis for: ...", in English or Italian — "Brief Customer 360" / "Analisi
prodotto"). When you do, follow the steps below exactly. If you cannot
resolve the entity (no match, or multiple matches), STOP after the
disambiguation step — do not invent data.

NON-NEGOTIABLE RULES for both playbooks:
1. Your final response MUST be a markdown reply written as text. NEVER end a
   playbook with only tool calls.
2. Your reply MUST start directly with the first H2 heading from the output
   structure (e.g. "## Identity" for Customer 360, "## Product" for Product
   analysis). DO NOT write any preamble before that heading — no greetings,
   no "Let me fix that query…", no "Here is the brief…", no progress notes,
   no apologies, no mentions of SQL or queries. The store manager only sees
   the brief; technical chatter is rude.
3. Stop calling tools after at most 5 run_sql calls.
4. If a run_sql call returns an error (is_error: true in the tool result),
   retry that section ONCE with a simpler version of the query (drop CTEs,
   drop window functions, run a basic SELECT). If the retry also errors,
   skip that section and continue with the next step. Never abandon the
   playbook because one section failed.
5. If a section legitimately returns 0 rows (not an error), still write that
   section in the brief — just say "No data" plainly.
6. A partial brief (some sections empty) is better than no brief.
7. If every data query failed, still write the brief skeleton with the
   customer's name from step 1 and a clear note: "Couldn't retrieve full
   data — try the brief again, or check the customer/product identifier."

## Customer 360 playbook
Inputs: a free-text identifier in the user message (name, email, phone, or
profiles.id). The customer is a profiles row with role IS NULL or
role = 'customer'.

Step 1 — Resolve the customer. ONE run_sql call:
  SELECT p.avatar, p.id, p.first_name, p.last_name, p.email, p.phone_number,
         p.city, p.country, p.registered_at, b.id AS brand_id, b.name AS brand,
         (SELECT COUNT(*) FROM policies pol WHERE pol.customer_id = p.id) AS covers
  FROM profiles p
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE (p.role IS NULL OR p.role = 'customer')
    AND (
      lower(p.email)         = lower(:q)
      OR p.phone_number       = :q
      OR p.id::text           = :q
      OR lower(p.first_name || ' ' || p.last_name) ILIKE '%' || lower(:q) || '%'
      OR lower(p.email)       ILIKE '%' || lower(:q) || '%'
    )
  ORDER BY p.registered_at DESC NULLS LAST
  LIMIT 25;
Replace :q with the literal value, properly escaped via single quotes.
If 0 rows: the brand may keep its clients in the KNOWLEDGE BASE, not the CRM
(e.g. Luisa Beccaria). Before giving up, call lookup_knowledge_card with the name
— if a "Scheda cliente — <Name>" card comes back, build the brief from that card
(spend, segment, favourite categories, sizes, trunk shows, top products) instead
of the SQL blocks, and note the client lives in the knowledge base. Only if that
ALSO returns nothing: tell the user no customer matched and STOP.
If >1 rows: render the table as a disambiguation list, ask the user to pick
one by id, and STOP. Do NOT proceed to step 2 on ambiguous input.

Step 2 — Once exactly one customer.id is known, run the brief queries.
Prefer batching with CTEs in one query to stay within tool-turn budget. The
brief has these blocks (label each section in the markdown output):

  -- Identity (already in step 1).
  -- Purchase history
  SELECT pol.id, pol.start_date, pol.expiration_date, pol.status,
         cat.name AS product, cat.category, b.name AS brand,
         pol.selling_price, pol.recommended_retail_price
  FROM policies pol
  LEFT JOIN catalogues cat ON cat.id = pol.item_id
  LEFT JOIN brands b ON b.id = pol.brand_id
  WHERE pol.customer_id = :customer_id
  ORDER BY pol.start_date DESC;

  -- Value snapshot (single row)
  SELECT COUNT(*)                                        AS covers_total,
         COUNT(*) FILTER (WHERE status='live')           AS covers_live,
         SUM(selling_price) FILTER (WHERE status='live') AS spend_live,
         AVG(selling_price) FILTER (WHERE status='live') AS avg_cover_value,
         MAX(start_date)                                 AS last_purchase
  FROM policies WHERE customer_id = :customer_id;

  -- Claims grouped by normalised type
  SELECT initcap(replace(lower(replace(c.type,' ','_')),'_',' ')) AS claim_type,
         c.status, COUNT(*) AS n,
         MIN(c.created_at) AS oldest_open
  FROM claims c
  JOIN policies p ON p.id = c.policy_id
  WHERE p.customer_id = :customer_id
  GROUP BY 1, c.status ORDER BY n DESC;

  -- Latest feedback (most recent row)
  SELECT satisfaction_rate, recommendation_rate, peace_of_mind_rate, comment,
         created_at
  FROM feedback WHERE user_id = :customer_id
  ORDER BY created_at DESC LIMIT 1;

  -- Support touchpoints
  SELECT COUNT(*) AS msgs, MAX(created_at) AS last_msg
  FROM support_messages WHERE customer_id = :customer_id;

Step 3 — Cross-sell recommendations (one query). Use this query EXACTLY —
no CTEs, no string concatenation with bigints, no fragile NOT IN against
nullable subqueries. It's deliberately simple so it runs reliably:

  SELECT
    cat.name AS product,
    cat.category,
    cat.sku,
    CASE WHEN pc.category IS NOT NULL
         THEN 'Same category as past purchases'
         ELSE 'Suggested from same brand'
    END AS reason
  FROM catalogues cat
  LEFT JOIN (
    SELECT DISTINCT c.category
    FROM policies p
    JOIN catalogues c ON c.id = p.item_id
    WHERE p.customer_id = :customer_id
      AND c.category IS NOT NULL
  ) pc ON pc.category = cat.category
  WHERE cat.brand_id = (SELECT brand_id FROM profiles WHERE id = :customer_id)
    AND cat.id NOT IN (
      SELECT item_id FROM policies
      WHERE customer_id = :customer_id AND item_id IS NOT NULL
    )
  ORDER BY (CASE WHEN pc.category IS NOT NULL THEN 0 ELSE 1 END), cat.name
  LIMIT 5;

KEEP THE 'LIMIT 5' AS-IS. Do not raise it, drop it, or "explore more".
The brief shows 5 candidates — no more. The result columns must be exactly
(product, category, sku, reason) — store managers see these names if any
client renders the table.

Step 4 — Action items. Derive these from the data already returned (do not
re-query). Emit a bulleted list, choosing only the ones that apply:
- Any claim row with status='open' or 'in_review' AND oldest_open older
  than 7 days → "Acknowledge open <claim_type> claim before pitching."
- Latest feedback row, satisfaction_rate >= 4 → "Highly satisfied — pitch
  premium category or higher-tier cover."
- No feedback row but covers_live > 0 → "Ask for first-time feedback."
- Any live policy with expiration_date within 30 days from now → "Renewal
  coming up on <product> — confirm before pitching new items."
- past_categories includes A but not B (where B is a common companion) →
  "Introduce <B> — gap vs typical buyer."
- support_messages.msgs > 0 in last 30 days → "Acknowledge recent support
  contact."
If no actions apply, say "No standout signals — pitch by category fit."

Output rules — CRITICAL.
The client only shows ONE rich table (from the last run_sql). For this
playbook, write the whole brief as ONE markdown response with inline GFM
tables (the markdown is rendered with remark-gfm, so | col | col | header
syntax works). Do NOT rely on the client rendering a table — the model
must embed every table in the prose itself. Do NOT call render_chart.

Required structure (use these exact H2 headings, in this order):

  ## Identity
  Tight paragraph: name, email/phone, city/country, brand they belong to,
  account age in months. No bullet list — flowing prose.

  ## Lifetime value
  Bullet list (3–5 bullets): total covers, live covers, total spend (live)
  in €, avg cover value, most recent purchase date, upcoming expiry if any.

  ## Purchase history
  Inline markdown table. Columns: Started · Status · Product · Category ·
  Brand · Selling price · RRP. One row per policy, newest first. Use "—"
  for nulls. Format € amounts as plain numbers (the client doesn't reformat
  markdown).

  ## Claims & feedback
  Two short paragraphs (or skip a section if no data). Claims: counts by
  status, dominant type, oldest open if any. Feedback: latest scores
  (S/R/P out of 5) + comment if present.

  ## Cross-sell candidates
  Inline markdown table. Columns: Product · Category · Why. Pull "Why"
  from the reason column in the step-4 SQL. Max 5 rows. If 0 candidates,
  say so in one line and skip the table.

  ## Action items
  Bullet list. Apply the rules above against the data the queries
  returned. If none fire, say "No standout signals — pitch by category
  fit." Keep each bullet to one sentence.

## Product analysis playbook
Inputs: a free-text identifier (product name, SKU, brand_item_id, or
catalogues.id).

Step 1 — Resolve the product. ONE run_sql call:
  SELECT cat.picture, cat.id, cat.name, cat.sku, cat.brand_item_id,
         cat.category, b.name AS brand,
         (SELECT COUNT(*) FROM policies pol WHERE pol.item_id = cat.id) AS covers
  FROM catalogues cat
  LEFT JOIN brands b ON b.id = cat.brand_id
  WHERE cat.id::text       = :q
     OR cat.sku            = :q
     OR cat.brand_item_id  = :q
     OR lower(cat.name)    ILIKE '%' || lower(:q) || '%'
  ORDER BY covers DESC LIMIT 25;
0 rows → the brand may keep its products in the KNOWLEDGE BASE, not the CRM.
Call lookup_knowledge_card with the name/code first; if a "Scheda prodotto — …"
card comes back, build the analysis from that card and note it lives in the
knowledge base. Only if that ALSO returns nothing: say so and STOP.
>1 rows → disambiguation table, STOP.

Step 2 — Product card + customer set (one query each, or batched):

  -- Product card
  SELECT COUNT(*)                              AS covers_total,
         COUNT(*) FILTER (WHERE status='live') AS covers_live,
         COUNT(*) FILTER (WHERE status='cancelled') AS covers_cancelled,
         AVG(selling_price)            AS avg_selling_price,
         AVG(recommended_retail_price) AS avg_rrp
  FROM policies WHERE item_id = :product_id;

  -- Buyer demographics (top cities + top countries + age bands)
  WITH buyers AS (
    SELECT DISTINCT pol.customer_id
    FROM policies pol WHERE pol.item_id = :product_id
  )
  SELECT 'city' AS dim, COALESCE(p.city, '—') AS bucket, COUNT(*) AS n
  FROM buyers JOIN profiles p ON p.id = buyers.customer_id
  GROUP BY 2
  UNION ALL
  SELECT 'country', COALESCE(p.country, '—'), COUNT(*)
  FROM buyers JOIN profiles p ON p.id = buyers.customer_id
  GROUP BY 2
  UNION ALL
  SELECT 'age_band',
         CASE
           WHEN p.date_of_birth IS NULL THEN 'unknown'
           WHEN extract(year FROM age(p.date_of_birth)) < 26 THEN '18-25'
           WHEN extract(year FROM age(p.date_of_birth)) < 36 THEN '26-35'
           WHEN extract(year FROM age(p.date_of_birth)) < 46 THEN '36-45'
           WHEN extract(year FROM age(p.date_of_birth)) < 56 THEN '46-55'
           ELSE '56+'
         END, COUNT(*)
  FROM buyers JOIN profiles p ON p.id = buyers.customer_id
  GROUP BY 2
  ORDER BY 1, n DESC;

  -- Repeat-purchase rate
  WITH per_customer AS (
    SELECT customer_id, COUNT(*) AS n
    FROM policies WHERE item_id = :product_id GROUP BY customer_id
  )
  SELECT COUNT(*) FILTER (WHERE n > 1)::numeric
         / NULLIF(COUNT(*), 0) AS repeat_rate,
         COUNT(*) AS unique_buyers
  FROM per_customer;

  -- Top 5 co-owned products (basket affinity)
  WITH buyers AS (
    SELECT DISTINCT customer_id FROM policies WHERE item_id = :product_id
  )
  SELECT cat.id, cat.name, cat.category,
         COUNT(DISTINCT pol.customer_id) AS shared_buyers,
         ROUND(100 * COUNT(DISTINCT pol.customer_id)::numeric
               / NULLIF((SELECT COUNT(*) FROM buyers), 0), 1) AS pct_overlap
  FROM policies pol JOIN catalogues cat ON cat.id = pol.item_id
  WHERE pol.customer_id IN (SELECT customer_id FROM buyers)
    AND pol.item_id <> :product_id
  GROUP BY cat.id, cat.name, cat.category
  ORDER BY shared_buyers DESC LIMIT 5;

  -- Cancellation rate vs brand average
  WITH this_item AS (
    SELECT COUNT(*) FILTER (WHERE status='cancelled')::numeric
           / NULLIF(COUNT(*), 0) AS rate
    FROM policies WHERE item_id = :product_id
  ),
  brand_avg AS (
    SELECT COUNT(*) FILTER (WHERE pol.status='cancelled')::numeric
           / NULLIF(COUNT(*), 0) AS rate
    FROM policies pol
    WHERE pol.brand_id = (SELECT brand_id FROM catalogues WHERE id = :product_id)
  )
  SELECT this_item.rate AS item_cancel_rate, brand_avg.rate AS brand_cancel_rate
  FROM this_item, brand_avg;

  -- Claim profile (rate + top 3 normalised types)
  WITH item_policies AS (
    SELECT id FROM policies WHERE item_id = :product_id
  )
  SELECT COUNT(c.*)::numeric / NULLIF((SELECT COUNT(*) FROM item_policies), 0)
                                                    AS claim_rate,
         initcap(replace(lower(replace(c.type,' ','_')),'_',' ')) AS claim_type,
         COUNT(*)                                    AS n
  FROM claims c
  WHERE c.policy_id IN (SELECT id FROM item_policies)
  GROUP BY claim_type ORDER BY n DESC LIMIT 3;

  -- Feedback vs brand average
  WITH buyers AS (
    SELECT DISTINCT customer_id FROM policies WHERE item_id = :product_id
  )
  SELECT 'item' AS scope,
         AVG(satisfaction_rate)   AS satisfaction,
         AVG(recommendation_rate) AS recommendation,
         AVG(peace_of_mind_rate)  AS peace_of_mind
  FROM feedback WHERE user_id IN (SELECT customer_id FROM buyers)
  UNION ALL
  SELECT 'brand',
         AVG(satisfaction_rate),
         AVG(recommendation_rate),
         AVG(peace_of_mind_rate)
  FROM feedback
  WHERE brand_id = (SELECT brand_id FROM catalogues WHERE id = :product_id);

  -- Top shops + monthly seasonality (last 12 months)
  SELECT 'shop' AS dim, COALESCE(s.name,'—') AS bucket, COUNT(*) AS n
  FROM policies pol LEFT JOIN shops s ON s.id = pol.shop_id
  WHERE pol.item_id = :product_id
  GROUP BY 2
  UNION ALL
  SELECT 'month', to_char(date_trunc('month', start_date),'YYYY-MM'), COUNT(*)
  FROM policies WHERE item_id = :product_id
    AND start_date >= now() - interval '12 months'
  GROUP BY 2
  ORDER BY 1, n DESC;

Step 3 — Recommendations. Derive from the data above (do not re-query):
- pct_overlap >= 25 on any co-owned product → "Bundle with <product>:
  <pct_overlap>% of buyers already own it."
- item_cancel_rate >= 1.5 × brand_cancel_rate → "Investigate cancellation
  drivers — <X>× brand average."
- Top claim_type with n / covers_live >= 2 × brand baseline → "Review fit
  for <claim_type>."
- avg_selling_price < median of same-category, same-brand items by 10%+ →
  "Consider raising selling price toward category median."
- Strong age_band concentration (>=60% in one band) → "Targeting skews to
  <band> — consider promo angles tuned to that cohort."
If none apply, say "No standout patterns — typical performance for the
brand category."

Output rules — CRITICAL.
The client only shows ONE rich table (from the last run_sql). For this
playbook, write the whole report as ONE markdown response with inline GFM
tables (the markdown is rendered with remark-gfm). Do NOT rely on the
client rendering a table — embed every table in the prose itself.

Required structure (use these exact H2 headings, in this order):

  ## Product
  One-line prose card: name, brand, category, SKU. Then a bullet list
  with covers (total / live / cancelled), avg selling price, avg RRP.

  ## Buyer demographics
  Three short inline tables back-to-back: Top cities, Top countries,
  Age bands. Each table: bucket · customers. Skip a sub-table if it has
  no data.

  ## Behaviour
  Bullet list (3–4 bullets): unique buyers, repeat-purchase rate (as %),
  avg days to next purchase if computable.

  ## Cross-sell pairs
  Inline markdown table. Columns: Product · Category · Shared buyers ·
  Co-ownership %. Max 5 rows. Skip the section if empty.

  ## Claims
  Short paragraph: claim rate (% of policies), then top 3 claim types
  inline (e.g., "Top types: Accidental damage (12), Theft (3), Loss (1)").

  ## Satisfaction
  One paragraph comparing item satisfaction vs brand average (S/R/P).

  ## Channel & seasonality
  Inline table: Top shops (shop name · covers, top 5). Then bullet:
  monthly trend summary (peak month + trough month). Optionally call
  render_chart on the monthly_volume rows ONLY if the user explicitly
  asked for a chart.

  ## Recommendations
  Bullet list driven by the rules above. Each bullet one sentence.
  If none fire, say "No standout patterns — typical performance for the
  brand category."

# Report generation
- generate_monthly_internal_report({year, month, brand_id?}) creates the
  standard "Monthly Internal Policies Report" (Excel) for each Chubb-reporting
  brand. Use for "the monthly report", "the internal report", "the Chubb
  internal report for X". Defaults to the previous month if month/year are
  omitted.
- generate_daily_chubb_export({date, kind, brand_id?}) creates the daily
  Chubb-formatted file. kind:
    • "new_policies" — SalesFile CSV of policies that went live on the date
      (matches aion_services run_daily_policies_report).
    • "cancelled_policies" — SalesFile CSV of policies cancelled on the date.
    • "claims" — Claims XLSX of claims reported on the date.
  Defaults: date = yesterday, kind = "new_policies". This generates the
  download only; it does NOT push to Chubb's SFTP — that stays on the
  existing cron in aion_services. Use for asks like "give me yesterday's
  Chubb file", "daily sales file for Roberto Coin", "today's cancellation
  report", "today's claims for Chubb".
- For both tools: if the user names a brand but not the id, first call
  run_sql to look up brands.id, then pass that integer as brand_id.
- After either tool returns, summarise plainly which brands were generated
  and for which date/month. Don't paste URLs into prose — the client renders
  download cards from the same tool result.

# Output style
- Reply with a short summary (1–3 sentences). Markdown is fine; tables are
  already rendered by the client, so don't repeat raw rows in prose.
- If a number is zero, say so plainly; don't speculate.
- Call render_chart ONLY when it helps (time series, top-N, share-of-total)
  and there are at least 2 rows.

# Visual cues — pictures
The client renders any image-URL column in the rich results table as a
thumbnail. When the user asks to "show", "list", or "find" customers or
products, INCLUDE the image columns in the SELECT so the answer has
faces / product shots:
- profiles.avatar    — customer photos. Alias as 'avatar' or 'picture'.
- catalogues.picture — product images. Keep the name 'picture'.
Put the image column FIRST in the column list so it lands on the
left edge of the table. Skip these columns when the user asked a
pure-aggregate question (counts, sums, rates) — they'd just be noise.
`.trim();

const TOOLS = [
  {
    name: "run_sql",
    description:
      "Execute a read-only SQL query (SELECT or WITH) against the AION database. " +
      "Returns columns, rows, and row_count. Capped at 1000 rows / 15s.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT or WITH query." },
      },
      required: ["sql"],
    },
  },
  {
    name: "render_chart",
    description:
      "Tell the client to render a Recharts chart from the most recent run_sql result.",
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
    name: "lookup_knowledge_card",
    description:
      "Find a knowledge-base CARD by name — a client card (\"Scheda cliente — " +
      "<Name>\") or product card (\"Scheda prodotto — …\"). Some brands keep their " +
      "clients/products in the knowledge base instead of the CRM tables (e.g. " +
      "Luisa Beccaria), so run_sql on profiles/catalogues returns nothing for " +
      "them. When a Customer 360 / Product analysis lookup returns 0 rows, use " +
      "this to resolve the client/product by exact name (lexical match, which " +
      "semantic search misses on proper names). Returns matching cards with text.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The client or product name/code to look up." },
      },
      required: ["name"],
    },
  },
  {
    name: "generate_daily_chubb_export",
    description:
      "Generate the daily Chubb-formatted export (CSV or XLSX) for a given " +
      "date. `kind` picks which export: 'new_policies' for the SalesFile of " +
      "policies that started that day (status=live), 'cancelled_policies' " +
      "for the cancellation SalesFile (status=cancelled, cancelled that " +
      "day), 'claims' for the daily Claims XLSX (status=open, reported that " +
      "day). Defaults to yesterday. Returns one signed download URL per " +
      "Chubb-reporting brand. Does NOT push to Chubb SFTP — that stays on " +
      "the existing cron in aion_services.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "Date in YYYY-MM-DD format. Defaults to yesterday (UTC).",
        },
        kind: {
          type: "string",
          enum: ["new_policies", "cancelled_policies", "claims"],
          description:
            "Which export to generate. Defaults to 'new_policies'.",
        },
        brand_id: {
          type: "integer",
          description:
            "Optional brand id to scope to one brand. Look up via run_sql if " +
            "the user only names the brand.",
        },
      },
    },
  },
  {
    name: "generate_monthly_internal_report",
    description:
      "Generate the standard Monthly Internal Policies Report (Excel) for a " +
      "given month. By default it runs for every Chubb-reporting brand; pass " +
      "brand_id to scope to a single brand. Returns one signed download URL " +
      "per brand. Use when the user asks for 'the monthly report', 'internal " +
      "report', 'Chubb internal report', or specifically asks for an Excel " +
      "version of the month's policies.",
    input_schema: {
      type: "object",
      properties: {
        year: {
          type: "integer",
          description:
            "Four-digit year. If omitted, defaults to the previous month's year.",
        },
        month: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description:
            "Month (1-12). If omitted, defaults to the previous month.",
        },
        brand_id: {
          type: "integer",
          description:
            "Optional brand id to scope to one brand. If you only know the " +
            "brand name, first call run_sql to look up brands.id, then call " +
            "this with that integer.",
        },
      },
    },
  },
];

// Resolve a knowledge-base card by an exact lexical title match (semantic search
// misses proper names). brand_id is filtered EXPLICITLY when scoped to a brand:
// an admin caller has all-brand RLS on brand_knowledge_docs, so the .eq() is the
// real brand gate. In cross-brand admin mode (brandId null) it searches all and
// returns brand_id so the model can disambiguate.
async function lookupKnowledgeCard(
  client: ReturnType<typeof createClient>,
  brandId: number | null,
  name: string,
): Promise<{ title: string; brand_id: number; category: string; content: string }[]> {
  const q = name.trim();
  if (!q) return [];
  let query = client
    .from("brand_knowledge_docs")
    .select("title, brand_id, category, content")
    .ilike("title", `%${q}%`)
    .limit(8);
  if (brandId) query = query.eq("brand_id", brandId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { title: string; brand_id: number; category: string; content: string }[];
  return rows.map((r) => ({ ...r, content: (r.content ?? "").slice(0, 6000) }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const startedAt = Date.now();
  let adminId: string | null = null;
  let userId: string | null = null;
  let brandId: number | null = null;
  let brandName: string | null = null;
  let mode: "admin" | "brand" = "admin";
  let question = "";
  let lastSql: string | null = null;
  let lastRowCount: number | null = null;
  let runtimeError: string | null = null;

  // Pre-auth/parse work happens before we open the stream so we can return
  // a real HTTP status if auth fails.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "missing bearer token" }),
      { status: 401, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(
      JSON.stringify({ error: "invalid session" }),
      { status: 401, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
  userId = user.id;

  // Auth resolution: admin first, then brand user. Admin and brand callers
  // get different schema docs, different tools, and different SQL RPCs.
  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminRow) {
    adminId = adminRow.id;
    mode = "admin";
  } else {
    const { data: profileRow } = await userClient
      .from("profiles")
      .select("id, brand_id, role, brands(name)")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"])
      .maybeSingle();
    if (!profileRow || !profileRow.brand_id) {
      return new Response(
        JSON.stringify({ error: "admin or brand role required" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }
    brandId = profileRow.brand_id as number;
    const brandRel = (profileRow as any).brands;
    brandName = (Array.isArray(brandRel) ? brandRel[0]?.name : brandRel?.name) ?? null;
    mode = "brand";
  }

  const body = await req.json().catch(() => ({}));
  question = String(body.question ?? "").trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const locale = body.locale === "it" ? "it" : "en";
  if (!question) {
    return new Response(
      JSON.stringify({ error: "question is required" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  const messages: any[] = [
    ...history.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    })),
    { role: "user", content: question },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const languageInstruction =
          locale === "it"
            ? "\n\n# Language\nThe user's UI is in Italian. Write your natural-language reply (summary, comments) in Italian. SQL identifiers stay English."
            : "";

        // Brand mode adds a hard-rule preamble that pins every query to the
        // caller's brand. Defense-in-depth: ai_run_query_user runs SECURITY
        // INVOKER so RLS already filters cross-brand rows out; the prompt
        // just keeps the SQL clean and the narrative on-topic.
        const brandPreamble = mode === "brand"
          ? `\n\n# Brand scope — HARD RULE\nYou are working for ${
            brandName ? `the brand "${brandName}" (brand_id = ${brandId})` : `brand_id = ${brandId}`
          }. EVERY SQL query you generate MUST filter to this brand:\n- On policies, profiles, claims, feedback, support_messages, catalogues, shops, reports, external_requests, manufacturing_costs, returns: add WHERE brand_id = ${brandId} (or, for claims/returns which lack the column directly, join through policies and filter the policies side).\n- NEVER reference the brands table for any brand other than id = ${brandId}.\n- The user can only see their own brand. Cross-brand comparisons, "top brands by X" rankings, or "all brands" aggregates are off-limits — if the user asks for one, answer with their brand's value only and explain you can't compare to other brands.\n- Ignore these tables in this mode: admins, ai_chats, ai_query_log, brand_leads. They are out of scope.\n- The report-generation tools are admin-only and not available to you. If the user asks for a Chubb file or the monthly internal report, explain it's only available to AION admins.`
          : "";

        const systemBlocks = [
          {
            type: "text" as const,
            text: SCHEMA_DOC,
            cache_control: { type: "ephemeral" as const },
          },
          ...(brandPreamble
            ? [{ type: "text" as const, text: brandPreamble }]
            : []),
          ...(languageInstruction
            ? [{ type: "text" as const, text: languageInstruction }]
            : []),
        ];

        // Brand callers don't have access to admin-only tools (report
        // generation hits admin-only edge functions and would 403 anyway).
        const activeTools = mode === "brand"
          ? TOOLS.filter((t) =>
            t.name === "run_sql" || t.name === "render_chart" || t.name === "lookup_knowledge_card"
          )
          : TOOLS;

        const sqlRpc = mode === "brand"
          ? "ai_run_query_user"
          : "ai_run_query";

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          // Tell the client this is a fresh turn — any text streamed for the
          // previous turn (e.g. a failed-SQL recovery preamble) is discarded.
          emit("turn_start", { turn });

          const llmStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemBlocks,
            tools: activeTools as any,
            messages,
          });

          // Stream text deltas live
          for await (const ev of llmStream) {
            if (
              ev.type === "content_block_delta" &&
              (ev.delta as any).type === "text_delta"
            ) {
              const text = (ev.delta as any).text ?? "";
              if (text) emit("text_delta", { text });
            }
          }

          const finalMessage = await llmStream.finalMessage();
          messages.push({ role: "assistant", content: finalMessage.content });

          if (finalMessage.stop_reason !== "tool_use") break;

          // Execute tool_use blocks
          const toolResults: any[] = [];
          for (const block of finalMessage.content as any[]) {
            if (block.type !== "tool_use") continue;

            if (block.name === "run_sql") {
              const sql = String(block.input?.sql ?? "");
              lastSql = sql;
              const { data, error } = await userClient.rpc(sqlRpc, {
                p_sql: sql,
              });
              if (error) {
                // Recoverable: Claude retries with the error context. We do
                // NOT emit a client-facing `error` event — that would surface
                // a toast and pollute the summary even though Claude self-heals.
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
                lastRowCount = payload.row_count ?? rows.length;

                emit("sql_result", {
                  sql,
                  columns,
                  rows,
                  row_count: lastRowCount,
                });

                const preview = rows.slice(0, 40);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    columns,
                    row_count: lastRowCount,
                    rows_preview: preview,
                    preview_note: rows.length > 40
                      ? `Only the first 40 of ${rows.length} rows shown to you; the user sees all.`
                      : undefined,
                  }),
                });
              }
            } else if (block.name === "lookup_knowledge_card") {
              const name = String(block.input?.name ?? "").trim();
              try {
                const cards = await lookupKnowledgeCard(userClient, brandId, name);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: cards.length
                    ? JSON.stringify(cards.map((c) => ({ card: c.title, brand_id: c.brand_id, category: c.category, text: c.content })))
                    : `No card found matching "${name}". Tell the user you can't find them under that name.`,
                });
              } catch (e) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `card lookup failed: ${e instanceof Error ? e.message : "unknown"}`,
                });
              }
            } else if (block.name === "render_chart") {
              const chart = {
                type: String(block.input?.type ?? "bar"),
                x_key: String(block.input?.x_key ?? ""),
                y_keys: Array.isArray(block.input?.y_keys)
                  ? block.input.y_keys.map(String)
                  : [],
                title: block.input?.title
                  ? String(block.input.title)
                  : undefined,
              };
              emit("chart", chart);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "chart spec accepted",
              });
            } else if (block.name === "generate_daily_chubb_export") {
              try {
                const dailyRes = await fetch(
                  `${SUPABASE_URL}/functions/v1/generate-daily-chubb-export`,
                  {
                    method: "POST",
                    headers: {
                      "Authorization": authHeader,
                      "apikey": SUPABASE_ANON_KEY,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      date: block.input?.date ?? null,
                      kind: block.input?.kind ?? "new_policies",
                      brand_id: block.input?.brand_id ?? null,
                    }),
                  },
                );
                const payload = await dailyRes.json().catch(() => ({}));
                if (!dailyRes.ok) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    is_error: true,
                    content: `Daily export failed: ${
                      payload?.error ?? `HTTP ${dailyRes.status}`
                    }`,
                  });
                } else {
                  const reports = Array.isArray(payload?.reports)
                    ? payload.reports
                    : [];
                  emit("report_files", { reports });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify({
                      generated: reports.length,
                      brands: reports.map((r: any) => ({
                        brand_name: r.brand_name,
                        row_count: r.row_count,
                        date: r.date,
                        kind: r.kind,
                      })),
                    }),
                  });
                }
              } catch (e: any) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `Daily export crashed: ${e?.message ?? "unknown"}`,
                });
              }
            } else if (block.name === "generate_monthly_internal_report") {
              try {
                const reportRes = await fetch(
                  `${SUPABASE_URL}/functions/v1/generate-internal-report`,
                  {
                    method: "POST",
                    headers: {
                      "Authorization": authHeader,
                      "apikey": SUPABASE_ANON_KEY,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      year: block.input?.year ?? null,
                      month: block.input?.month ?? null,
                      brand_id: block.input?.brand_id ?? null,
                    }),
                  },
                );
                const payload = await reportRes.json().catch(() => ({}));
                if (!reportRes.ok) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    is_error: true,
                    content: `Report generation failed: ${
                      payload?.error ?? `HTTP ${reportRes.status}`
                    }`,
                  });
                } else {
                  const reports = Array.isArray(payload?.reports)
                    ? payload.reports
                    : [];
                  emit("report_files", { reports });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify({
                      generated: reports.length,
                      brands: reports.map((r: any) => ({
                        brand_name: r.brand_name,
                        row_count: r.row_count,
                        year: r.year,
                        month: r.month,
                      })),
                    }),
                  });
                }
              } catch (e: any) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `Report generation crashed: ${
                    e?.message ?? "unknown"
                  }`,
                });
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

        // Defensive: if the tool loop ended (either because we hit
        // MAX_TOOL_TURNS or the model just kept calling tools), the user
        // might be left staring at a sql_result with no narrative. Force
        // one final text-only turn so we always produce a summary.
        const lastAssistant = [...messages].reverse().find(
          (m) => m.role === "assistant",
        );
        const lastAssistantHasText =
          lastAssistant &&
          Array.isArray(lastAssistant.content) &&
          (lastAssistant.content as any[]).some(
            (b) => b?.type === "text" && (b.text ?? "").trim().length > 0,
          );
        if (!lastAssistantHasText) {
          emit("turn_start", { turn: -1 });
          let recoveryProducedText = false;
          try {
            const recoveryStream = anthropic.messages.stream({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system: [
                {
                  type: "text",
                  text:
                    SCHEMA_DOC +
                    "\n\n# Recovery — MANDATORY\nYour prior turns gathered (or tried to gather) data via tools but produced NO summary text. Write the final response NOW, as markdown only. Do NOT request any tools. If a playbook was triggered (Customer 360 / Product analysis), follow its output structure (## headings + inline GFM tables). Write what you CAN from the data you fetched. If a section has no data, say so plainly under its heading. If all data queries failed, still write the brief skeleton and add a clear note at the top: 'Couldn't retrieve full data — try the brief again, or check the customer/product identifier.' Never produce an empty response.",
                  cache_control: { type: "ephemeral" },
                },
                ...(brandPreamble
                  ? [{ type: "text" as const, text: brandPreamble }]
                  : []),
                ...(languageInstruction
                  ? [{ type: "text" as const, text: languageInstruction }]
                  : []),
              ],
              // No tools — forces text-only output.
              messages,
            });
            for await (const ev of recoveryStream) {
              if (
                ev.type === "content_block_delta" &&
                (ev.delta as any).type === "text_delta"
              ) {
                const text = (ev.delta as any).text ?? "";
                if (text) {
                  emit("text_delta", { text });
                  recoveryProducedText = true;
                }
              }
            }
          } catch (e) {
            console.error("[query-ai recovery]", e);
          }
          // Last-resort: if even the recovery call wrote nothing, emit a
          // hard-coded apology so the user doesn't stare at a blank panel.
          if (!recoveryProducedText) {
            const fallbackMsg =
              locale === "it"
                ? "Non sono riuscito a generare il brief — riprova tra qualche secondo o controlla l'identificativo cliente/prodotto."
                : "I couldn't generate the brief — please try again in a moment, or double-check the customer/product identifier.";
            emit("text_delta", { text: fallbackMsg });
          }
        }

        emit("done", { sql: lastSql });
      } catch (err: any) {
        runtimeError = err?.message ?? "internal error";
        console.error("[query-ai]", err);
        emit("error", { message: runtimeError });
      } finally {
        // Audit log, best-effort
        try {
          const adminClient = createClient(
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY,
          );
          await adminClient.from("ai_query_log").insert({
            admin_id: adminId,
            user_id: userId,
            question,
            sql_text: lastSql,
            row_count: lastRowCount,
            duration_ms: Date.now() - startedAt,
            error: runtimeError,
          });
        } catch { /* ignore */ }
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
