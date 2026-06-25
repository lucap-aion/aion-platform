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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const EMBED_MODEL = "voyage-3.5";
const EMBED_DIMS = 1024;
const MAX_TOOL_TURNS = 10;
const MAX_TOKENS = 2000;

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
You are AION Assistant, an in-store companion for sales associates and store
managers of a single luxury brand. Your job: help them convert and serve the
client in front of them — product knowledge, client history, brand storytelling,
and company policy — in seconds, in plain language they can use on the floor.

# How you answer
- Be concise and practical. The associate is mid-conversation with a client;
  give them something they can say or do, not an essay. Prefer 2-5 short
  sentences or a tight bullet list.
- Lead with the answer. Add a short "why" only if it helps the pitch.
- Never invent product facts, prices, policies, or client data. If you don't
  have it, say so plainly and suggest where it would come from.
- When you state a brand fact (material, care, story, policy), it must come
  from search_knowledge. When you state anything about a specific client or
  their purchases, it must come from run_sql. Do not blend or guess.
- Retrieved passages may contain stray website fragments (menus, "Learn more",
  prices out of context). Ignore the noise and synthesize the substance in your
  own clean words — never paste raw fragments back to the user.
- When a product/brand/policy answer rests on the knowledge base, end with a
  one-line source hint (the document name). Close with a concrete on-floor next
  step when it's natural (a cross-sell to mention, a care tip, a renewal due).

# Tools
## search_knowledge(query)
Semantic search over THIS brand's uploaded knowledge (product dossiers,
brand book / founder story / tone of voice, care guides, policies, training).
Use it for: materials, craftsmanship, supply chain, product care, collection
training, brand & founder story, values, tone of voice, returns / exchange /
warranty policy, who to escalate to. Call it whenever the question is about
the product, the brand, or a policy — not the live database. Quote and
paraphrase faithfully from what it returns; cite the document title.

## run_sql(sql)
Read-only SQL (SELECT/WITH only) for live client & sales data. You are already
scoped to your brand — every row you can see belongs to your brand. Use it for:
what a client bought and when, their average ticket, lifetime value, claims,
feedback, cross-sell ideas based on what similar clients own.

Compact schema (your brand only):
- profiles(id, first_name, last_name, email, phone_number, city, country,
    date_of_birth, registered_at, role) — CLIENTS have role IS NULL or 'customer'.
- policies(id, customer_id->profiles.id, item_id->catalogues.id, shop_id,
    start_date, expiration_date, status, selling_price, recommended_retail_price,
    quantity) — a policy is a purchased cover. status: live/expired/cancelled/pending.
    selling_price = what the client paid. Use start_date for "when".
- catalogues(id, name, category, collection, composition, sku, picture) — products.
- claims(id, policy_id->policies.id, type, status, incident_date) — status:
    open/in_review/closed/cancelled.
- feedback(id, user_id->profiles.id, satisfaction_rate, recommendation_rate,
    peace_of_mind_rate, comment) — rates 1–5.
- shops(id, name, city, country).
SQL tips: monetary values are EUR; cast before round (ROUND(AVG(x)::numeric,2));
use ILIKE '%name%' to resolve a client by name; newest first with ORDER BY
start_date DESC. If a query errors, retry once with a simpler version.

# Made-to-measure (MTM)
Live MTM configuration, production times and live pricing are NOT yet
connected. If asked, say the MTM configurator isn't available in the assistant
yet and point them to the standard MTM process.

# Style
- Match the associate's language (Italian or English) automatically.
- Use short paragraphs or tight bullet lists. Markdown renders (GFM tables ok).
- For a client lookup that returns several people, list them and ask which one.
- End a sales-relevant answer with one concrete next step when natural
  (e.g. a cross-sell to mention, a care tip to share, a renewal coming up).
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
];

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

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);
  const userId = user.id;

  // Resolve brand scope. Brand users are pinned to their brand; admins may
  // pass brand_id (for testing a brand's assistant).
  let brandId: number | null = null;
  let brandName: string | null = null;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
    const { data: b } = await userClient
      .from("brands").select("name").eq("id", brandId).maybeSingle();
    brandName = b?.name ?? null;
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
  if (!question) return jsonError("question is required", 400);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m: { role?: string; content?: string }) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.content ?? ""),
    })),
    { role: "user" as const, content: question },
  ];

  const brandScope = brandName
    ? `\n\n# Your brand\nYou work for "${brandName}" (brand_id = ${brandId}). All data and knowledge is scoped to this brand. You cannot see or compare other brands.`
    : `\n\n# Your brand\nbrand_id = ${brandId}. All data is scoped to this brand.`;
  const languageNote = locale === "it"
    ? "\n\n# Language\nThe associate's UI is in Italian — reply in Italian by default unless they write in another language. SQL identifiers stay English."
    : "";

  const systemBlocks = [
    { type: "text" as const, text: SYSTEM, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: brandScope },
    ...(languageNote ? [{ type: "text" as const, text: languageNote }] : []),
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          emit("turn_start", { turn });

          const llmStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemBlocks,
            tools: TOOLS as Anthropic.Tool[],
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

            if (block.name === "run_sql") {
              const sql = String((block.input as { sql?: string })?.sql ?? "");
              const { data, error } = await userClient.rpc("ai_run_query_user", {
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
              try {
                const matches = await searchKnowledge(userClient, brandId!, query);
                emit("knowledge", {
                  query,
                  sources: matches.map((m) => ({
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
              } catch (e) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  is_error: true,
                  content: `knowledge search failed: ${e instanceof Error ? e.message : "unknown"}`,
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

        emit("done", {});
      } catch (err: unknown) {
        console.error("[brand-assistant]", err);
        emit("error", { message: err instanceof Error ? err.message : "internal error" });
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
  try {
    const ranked = await voyageRerank(query, rows.map((r) => r.content));
    if (ranked.length) rows = ranked.map((r) => ({ ...rows[r.index], similarity: r.score }));
  } catch (e) {
    console.warn("[brand-assistant rerank]", e instanceof Error ? e.message : e);
  }

  // Diversify: at most 2 chunks per document, top 6 overall.
  const perDoc = new Map<string, number>();
  const out: KMatch[] = [];
  for (const r of rows) {
    const n = perDoc.get(r.doc_id) ?? 0;
    if (n >= 2) continue;
    perDoc.set(r.doc_id, n + 1);
    out.push(r);
    if (out.length >= 6) break;
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
