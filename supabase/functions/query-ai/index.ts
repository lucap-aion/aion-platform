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
