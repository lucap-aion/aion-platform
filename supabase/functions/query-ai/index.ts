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
const MAX_TOOL_TURNS = 6;
const MAX_TOKENS = 3000;

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
         first_name, last_name, email, role, status, is_master bool, is_visible bool,
         date_of_birth date, nationality, address, city, province, postcode, country,
         phone_number, registered_at, email_confirmed_at, created_at)
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

# Business glossary — AION revenue (CRITICAL — do NOT improvise)
The fields brands.activation_fee, brands.insurance_premium, brands.aion_premium_fee
are RATES (fractions), NOT euro amounts. NEVER SUM them. NEVER report them as
revenue. "0.3" means 30%, not €0.30.

GVT_FEE is a fixed 22.25% government deduction off the gross premium (this is
hard-coded in src/pages/admin/AdminDashboard.tsx).

Canonical revenue formula (mirrored from AdminDashboard.tsx):

  WITH per_brand AS (
    SELECT
      p.brand_id,
      SUM(COALESCE(p.cogs, 0)                     * COALESCE(p.quantity, 1))
        FILTER (WHERE p.status = 'live') AS total_cogs,
      SUM(COALESCE(p.recommended_retail_price, 0) * COALESCE(p.quantity, 1))
        FILTER (WHERE p.status = 'live') AS total_rrp
    FROM public.policies p
    GROUP BY p.brand_id
  )
  SELECT
    b.id, b.name,
    pb.total_cogs * b.insurance_premium                            AS gross_premium,
    pb.total_cogs * b.insurance_premium * (1 - 0.2225)             AS net_premium,
    pb.total_rrp  * b.activation_fee                               AS aion_activation_fee,
    pb.total_cogs * b.insurance_premium * (1 - 0.2225) * b.aion_premium_fee
                                                                   AS aion_premium_fee,
    pb.total_rrp  * b.activation_fee
      + pb.total_cogs * b.insurance_premium * (1 - 0.2225) * b.aion_premium_fee
                                                                   AS aion_revenue
  FROM per_brand pb
  JOIN public.brands b ON b.id = pb.brand_id;

Always:
- Count only LIVE policies (use FILTER WHERE status='live' on every SUM).
- Multiply by COALESCE(quantity, 1).
- Compute per brand first (rates differ per brand), then SUM across brands.
- Premium revenue is COGS × insurance_premium (NOT selling_price). Activation
  is on RRP.
- When explaining, render rates as percentages
  (e.g. "Roberto Coin: 30% premium fee, 6% insurance premium, 0.15% activation").
- Brands with NULL rates contribute nothing to that bucket — COALESCE rates to 0
  if you want a total across all brands.

Vocabulary:
- "AION revenue" / "what AION earns" / "our take" → aion_revenue above.
- "Customer revenue" / "what customers paid" → SUM(selling_price * quantity).
- "Gross premium" → cogs × insurance_premium (before GVT).
- "Net premium" → gross_premium × (1 - 0.2225).

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const startedAt = Date.now();
  let adminId: string | null = null;
  let userId: string | null = null;
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

  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow) {
    return new Response(
      JSON.stringify({ error: "admin role required" }),
      { status: 403, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
  adminId = adminRow.id;

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

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          // Tell the client this is a fresh turn — any text streamed for the
          // previous turn (e.g. a failed-SQL recovery preamble) is discarded.
          emit("turn_start", { turn });

          const llmStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: [
              {
                type: "text",
                text: SCHEMA_DOC,
                cache_control: { type: "ephemeral" },
              },
              ...(languageInstruction
                ? [{ type: "text" as const, text: languageInstruction }]
                : []),
            ],
            tools: TOOLS as any,
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
              const { data, error } = await userClient.rpc("ai_run_query", {
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
