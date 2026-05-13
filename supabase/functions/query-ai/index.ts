// AI database query assistant.
// Admins ask a natural-language question; Claude translates it into a single
// read-only SQL query against ai_run_query, then summarises the results.
// Optionally Claude proposes a chart spec which the client renders.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_TURNS = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// ─── Schema doc (cached in the Claude system prompt) ─────────────────────────
const SCHEMA_DOC = `
You are a senior data analyst with read-only SQL access to the AION Cover
PostgreSQL database (Supabase). Use the run_sql tool to answer questions.

# Hard rules
- The only way to fetch data is the run_sql tool. Do NOT invent results.
- SQL must be a single statement starting with SELECT or WITH.
- No INSERT/UPDATE/DELETE/DDL — they will be rejected.
- Results are capped at 1000 rows and 15s of query time.
- Always quote identifiers only if they collide with reserved words.
- Prefer explicit JOINs over implicit ones; alias tables with short names.
- When showing money, the underlying values are EUR.
- Dates are timestamps with timezone; cast with ::date for day grouping.
- When the user is vague ("how many customers"), make a reasonable
  assumption and state it briefly in your summary.

# Schema (public)

brands(id int PK, name, slug, status, email, hq_city, hq_country, hq_postcode,
       activation_fee numeric, aion_premium_fee numeric, insurance_premium numeric,
       enable_chubb_reporting bool, chubb_policy_prefix, theme_settings jsonb,
       website, description, created_at timestamptz)

shops(id int PK, brand_id -> brands.id, brand_shop_id, name, address, city,
      country, contact, status, created_at)

catalogues(id int PK, brand_id -> brands.id, brand_item_id, name, description,
           category, collection, composition, sku, slug, picture, created_at)
   -- "catalogues" rows ARE products / items.

profiles(id uuid PK, user_id uuid, brand_id -> brands.id, shop_id -> shops.id,
         first_name, last_name, email, role, status, is_master bool, is_visible bool,
         date_of_birth date, nationality, address, city, province, postcode, country,
         phone_number, registered_at, email_confirmed_at, created_at)
   -- profiles holds BOTH customers (role='customer' or null) AND brand-side users
   --   (role in 'brand','brand_admin','brand_user').
   -- is_master=true on a brand_user means they can write.

admins(id uuid PK, user_id uuid, first_name, last_name, email, role, status,
       phone_number, address, city, province, postcode, country, nationality,
       date_of_birth date, registered_at, email_confirmed_at, created_at)

policies(id int PK, brand_id -> brands.id, customer_id -> profiles.id,
         item_id -> catalogues.id, shop_id -> shops.id,
         brand_sale_id, brand_row_id, brand_sub_order_row_code,
         start_date date, expiration_date date,
         status text, source text, quantity int,
         cogs numeric, recommended_retail_price numeric, selling_price numeric,
         transferred_at timestamptz, cancelled_at timestamptz,
         former_customer_ids uuid[], purchase_receipt, internal_notes, notes,
         external_request_id -> external_requests.id, return_id -> returns.id,
         created_at, updated_at)
   -- a "policy" is a cover; a "cover" is the same thing in user-facing language.
   -- selling_price is what the customer paid; recommended_retail_price is RRP;
   -- cogs is cost of goods sold.

claims(id int PK, policy_id -> policies.id, type text, status text,
       description, incident_date date, incident_city, incident_country,
       media text[], cancelled_at, closed_at, created_at, updated_at)

feedback(id int PK, brand_id -> brands.id, user_id -> profiles.id,
         satisfaction_rate int, recommendation_rate int, peace_of_mind_rate int,
         comment, created_at)

support_messages(id int PK, brand_id -> brands.id, customer_id -> profiles.id,
                 message, created_at)

reports(id int PK, brand_id -> brands.id, created_by -> profiles.id,
        name, url, type, direction, source, start_date, end_date,
        uploaded_to_chubb bool, uploaded_to_chubb_at, uploaded_to_chubb_by,
        created_at)

returns(id int PK, old_policy_id -> policies.id, return_shop_id -> shops.id,
        return_id text, returned_at, created_at)

external_requests(id int PK, brand_id -> brands.id, source, sale_id,
                  return_id, row_id, request jsonb, created_at)

manufacturing_costs(id int PK, brand_id -> brands.id, category, chubb_category,
                    cost_pct numeric, created_at)

brand_leads(id int PK, company_name, website, n_of_stores, created_at)

ai_query_log(id, admin_id, user_id, question, sql_text, row_count,
             duration_ms, error, created_at)

# Common joins
- A claim's customer = claims.policy_id -> policies.customer_id -> profiles.id
- A policy's product name = policies.item_id -> catalogues.name
- A customer's brand = profiles.brand_id -> brands.id
  (yes, customers belong to a brand; multi-brand customers have multiple rows)

# Status hints
- policies.status common values: 'live', 'expired', 'cancelled', 'pending'
- claims.status common values: 'open', 'in_review', 'closed', 'cancelled'
- profiles.status: 'active' or 'pending'

# Output style
- After you have the data, reply with a short natural-language summary
  (1–3 sentences). Don't paste the raw rows; the client already shows the table.
- Call render_chart only when a chart genuinely helps (time series, top-N
  comparison, share-of-total). Don't chart < 2 rows.
`.trim();

// ─── Tools ───────────────────────────────────────────────────────────────────
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
      "Tell the client to render a Recharts chart from the most recent run_sql " +
      "result. Use only when a chart materially helps the user understand the answer.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "line", "pie"] },
        x_key: {
          type: "string",
          description: "Column name to use as the x axis / category.",
        },
        y_keys: {
          type: "array",
          items: { type: "string" },
          description: "One or more numeric columns to plot.",
        },
        title: { type: "string" },
      },
      required: ["type", "x_key", "y_keys"],
    },
  },
];

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const startedAt = Date.now();
  let adminId: string | null = null;
  let userId: string | null = null;
  let question = "";
  let lastSql: string | null = null;
  let lastRowCount: number | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "missing bearer token" });
    }

    // Per-request client carrying the user's JWT, so RPC calls run as that user.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: "invalid session" });
    userId = user.id;

    // Admin gate (anyone in the admins table)
    const { data: adminRow } = await userClient
      .from("admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return json(403, { error: "admin role required" });
    adminId = adminRow.id;

    const body = await req.json().catch(() => ({}));
    question = String(body.question ?? "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!question) return json(400, { error: "question is required" });

    // Build the conversation. `history` contains prior user/assistant turns
    // as simple { role, content } strings for natural-language context only;
    // tool use is scoped to the current turn.
    const messages: any[] = [
      ...history.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
      { role: "user", content: question },
    ];

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    let summary = "";
    let columns: string[] = [];
    let rows: Record<string, unknown>[] = [];
    let chart: {
      type: string;
      x_key: string;
      y_keys: string[];
      title?: string;
    } | null = null;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [
          {
            type: "text",
            text: SCHEMA_DOC,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: TOOLS as any,
        messages,
      });

      // Append the assistant message (must be added verbatim before tool_result)
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        // Final answer turn — concatenate text blocks
        summary = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim();
        break;
      }

      // Execute each tool_use block and stage tool_result blocks
      const toolResults: any[] = [];
      for (const block of response.content as any[]) {
        if (block.type !== "tool_use") continue;

        if (block.name === "run_sql") {
          const sql = String(block.input?.sql ?? "");
          lastSql = sql;
          const { data, error } = await userClient.rpc("ai_run_query", {
            p_sql: sql,
          });
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
            columns = payload.columns ?? [];
            rows = payload.rows ?? [];
            lastRowCount = payload.row_count ?? rows.length;
            // Trim to 50 rows for the model — full set still goes to the client
            const preview = rows.slice(0, 50);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({
                columns,
                row_count: lastRowCount,
                rows_preview: preview,
                preview_note:
                  rows.length > 50
                    ? `Only the first 50 of ${rows.length} rows shown to you; the user sees all.`
                    : undefined,
              }),
            });
          }
        } else if (block.name === "render_chart") {
          chart = {
            type: String(block.input?.type ?? "bar"),
            x_key: String(block.input?.x_key ?? ""),
            y_keys: Array.isArray(block.input?.y_keys)
              ? block.input.y_keys.map(String)
              : [],
            title: block.input?.title ? String(block.input.title) : undefined,
          };
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

    // Audit log (best-effort, service role bypasses RLS)
    try {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await adminClient.from("ai_query_log").insert({
        admin_id: adminId,
        user_id: userId,
        question,
        sql_text: lastSql,
        row_count: lastRowCount,
        duration_ms: Date.now() - startedAt,
        error: null,
      });
    } catch {
      // swallow — audit failures must not break the response
    }

    return json(200, { summary, sql: lastSql, columns, rows, chart });
  } catch (err: any) {
    const message = err?.message ?? "internal error";
    try {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await adminClient.from("ai_query_log").insert({
        admin_id: adminId,
        user_id: userId,
        question,
        sql_text: lastSql,
        row_count: lastRowCount,
        duration_ms: Date.now() - startedAt,
        error: message,
      });
    } catch { /* ignore */ }
    console.error("[query-ai]", err);
    return json(500, { error: message });
  }
});
