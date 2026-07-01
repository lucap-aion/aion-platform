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
several match, list them and ask which one before going deeper.

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
- claims(id, policy_id->policies.id, type, status, incident_date).
- feedback(id, user_id->profiles.id, satisfaction_rate, recommendation_rate,
    peace_of_mind_rate, comment) — rates 1-5.
- shops(id, name, city, country).
- brand_knowledge_docs(title, category, source_type, source_url, char_count) —
    INDEXED KNOWLEDGE crawled from the brand's site + news (product/storytelling/
    policy/news/other). Use for the brand STORY, care, policy, craftsmanship — not
    for the product list (storefront_products is the structured product source).
SQL tips: EUR money; cast before round (ROUND(AVG(x)::numeric,2)); ILIKE
'%name%' to find a client; ORDER BY start_date DESC for recency. When you list
products, SELECT image_url + price so photos and prices render; for clients
SELECT avatar. If a query errors, retry once, simpler.

IMPORTANT — run_sql results render to the user automatically as a rich table
with product/client photos. Don't blindly re-paste rows.
- When the value is in SEEING the pieces (products, a client's items, anyone
  with a photo), DON'T build a table — one short sentence of context — so the
  photo cards render below.
- Only build a small markdown table for a pure ranking / numbers where there's
  nothing to look at (e.g. top clients by spend); keep it tight and add the
  insight (the standout, what it means, the next step).
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
  Match generously (try the collection name, then keywords), keep to the ~12
  most relevant pieces.
- Then keep your prose SHORT — a sentence or two of context — and let the photo
  cards below carry the pieces. Don't re-list in a table what the cards show.
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
  // Optional photo for visual product search (data URL: "data:image/…;base64,…").
  const image = parseDataUrl(body.image);
  // A photo alone is a valid turn ("what piece is this?"); text is only required
  // when there's no image.
  if (!question && !image) return jsonError("question or image is required", 400);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  // The newest user turn carries the photo (as an image block) when present, so
  // the model can reason over it directly alongside the catalogue matches.
  const latestContent: Anthropic.ContentBlockParam[] | string = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: question || (locale === "it"
          ? "Che pezzo è questo? Identificalo dal nostro catalogo."
          : "What piece is this? Identify it from our catalogue.") },
      ] as Anthropic.ContentBlockParam[]
    : question;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m: { role?: string; content?: string }) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.content ?? ""),
    })),
    { role: "user" as const, content: latestContent },
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
        // Visual search: if a photo was attached, match it against the brand's
        // catalogue-image embeddings, show the pieces as cards, and hand the
        // model the ranked candidates so it can identify + confirm.
        if (image) {
          emit("tool_start", { tool: "search_by_image" });
          try {
            const embedding = await voyageEmbedImage(`data:${image.mediaType};base64,${image.data}`);
            const { data: matchData, error: matchErr } = await userClient.rpc(
              "match_storefront_images",
              { p_brand_id: brandId, p_query_embedding: embedding, p_match_count: 8, p_min_similarity: 0.2 },
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

            // Live activity for the UI ("Searching the knowledge base…" etc).
            emit("tool_start", {
              tool: block.name,
              query: block.name === "search_knowledge" ? String((block.input as { query?: string })?.query ?? "") : undefined,
            });

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
