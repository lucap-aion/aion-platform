// visit-note: a store manager's spoken note about a client who just left,
// turned into a row in public.store_visits.
//
// The manager talks for twenty seconds in the language they actually speak.
// This function does three things with that transcript and nothing else:
//   1. structures it — outcome, what was tried on, why it didn't close, when to
//      follow up;
//   2. tries to attach it to a client the brand already knows, and says how
//      sure it is instead of deciding for them;
//   3. maps what they mentioned onto the real catalogue, so "the quilted one in
//      black" lands on a SKU rather than on a string.
//
// It writes a DRAFT. The manager confirms or corrects it in the UI, and the
// confirmation is what makes the row true — see the migration's header.
//
// Transcription is NOT done here. The browser does it (Web Speech), or a future
// provider does it before this call; either way this function's input is text.
// That split is deliberate: it keeps the demo working with no STT key, and the
// structuring — the part worth having — is identical whoever heard the words.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { originAllowed, originRefused } from "../_shared/origin.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// The same chunker and the same embedding model the knowledge base uses, so a
// visit is retrieved beside the house's own documents rather than in a lane of
// its own.
import { chunkText, embedDocuments } from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY") ?? "";

// One short extraction per visit — a few hundred tokens. Override per env.
const MODEL = Deno.env.get("VISIT_MODEL") ?? "claude-opus-5";
const MAX_TOKENS = 2000;
// Enough of the catalogue to recognise what was mentioned, not so much that the
// prompt stops being cheap.
const MAX_CATALOGUE = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
You turn a luxury store manager's spoken note into one structured visit record.
The note was dictated in the minute after a client walked out of the boutique.

Return STRICT JSON, no markdown fence, no preamble:

{
  "customer_said": "the client's name exactly as the manager said it, or null",
  "outcome": "purchased" | "not_purchased" | "undecided",
  "summary": "one sentence, the way a colleague would recap it to the next shift",
  "items": [
    {
      "product": "what was shown or tried, in the manager's words",
      "sku": "the catalogue SKU if you are confident it is that product, else null",
      "size": "as said, else null",
      "colour": "as said, else null",
      "reaction": "what the client actually said or did about THIS item, else null"
    }
  ],
  "objection": "why it did not close, in the manager's own terms, or null",
  "occasion": "gift | wedding | anniversary | self | travel | ... or null",
  "sentiment": "positive" | "neutral" | "negative",
  "follow_up": "the next action the manager said they'd take, or null",
  "follow_up_due": "YYYY-MM-DD, or null",
  "tags": ["short lowercase tags, 0-5, e.g. vip, first-visit, tourist, price-sensitive"],
  "language": "ISO code of the language the note was spoken in",
  "needs_review": true | false
}

Rules that matter more than completeness:
- NEVER invent. If the manager did not say it, the value is null. An empty card
  from a vague note is correct; a plausible card is not.
- "undecided" is for a client still thinking. "not_purchased" is for a visit
  that ended without a sale — a walk-out, a no. Do not use "purchased" unless
  the manager clearly says something was bought or paid for.
- The objection is the single most valuable field here. Keep the manager's own
  reason, verbatim in meaning: "too heavy for her", "waiting for her husband to
  see it" and "price" are three different objections, and flattening them to
  "price" destroys the point of the record.
- Only set a SKU when the manager's description plus the catalogue leave no real
  doubt. A wrong SKU is worse than a null one.
- Resolve relative dates ("next week", "after the holidays", "Saturday")
  against the date given in the user message. If the manager gave no timing but
  did promise an action, leave follow_up_due null.
- Set needs_review true when you had to guess something that changes what
  someone would DO with this row: an unclear outcome, a half-heard name, a
  follow-up with no date that sounded urgent.
- Write summary, objection and follow_up in the language the note was spoken in.
  Keep tags in English so they aggregate across markets.
`.trim();

type Structured = {
  customer_said?: string | null;
  outcome?: string | null;
  summary?: string | null;
  items?: unknown;
  objection?: string | null;
  occasion?: string | null;
  sentiment?: string | null;
  follow_up?: string | null;
  follow_up_due?: string | null;
  tags?: unknown;
  language?: string | null;
  needs_review?: boolean | null;
};

const jsonOk = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const jsonError = (message: string, status = 400) =>
  jsonOk({ error: message }, status);

function stripJsonFence(s: string) {
  return s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

const ONE_OF = (v: unknown, allowed: string[]): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return allowed.includes(s) ? s : null;
};

const text = (v: unknown, max = 2000): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

// An ISO date the database will accept, or nothing. A model that answers
// "next Tuesday" in prose must not become a 500 three layers down.
const isoDate = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * A visit, written the way a colleague would recount it.
 *
 * Deliberately prose and not a field dump: this text is what gets embedded, and
 * "outcome: not_purchased" retrieves nothing, while "she did not buy — it was
 * too heavy for the travelling she does" answers a question somebody will
 * actually ask. The objection is quoted, never paraphrased, for the same reason
 * it is free text in the table.
 */
function visitAsProse(v: Record<string, unknown>, shopName: string | null): string {
  const when = String(v.visited_at ?? "").slice(0, 10);
  const who = v.customer_said ? String(v.customer_said) : "A client with no name on record";
  const outcome = v.outcome === "purchased"
    ? "bought"
    : v.outcome === "undecided"
    ? "left undecided"
    : "left without buying";

  const items = Array.isArray(v.items) ? v.items as Record<string, unknown>[] : [];
  const tried = items
    .map((it) => [it.product, it.size ? `size ${it.size}` : null, it.colour, it.reaction]
      .filter(Boolean).join(", "))
    .filter(Boolean);

  const lines = [
    `Boutique visit on ${when}${shopName ? ` at ${shopName}` : ""}. ${who} ${outcome}.`,
    v.summary ? String(v.summary) : "",
    tried.length ? `What was shown or tried on: ${tried.join("; ")}.` : "",
    v.objection ? `Why it did not close, in the manager's words: "${String(v.objection)}".` : "",
    v.occasion ? `The occasion was ${String(v.occasion)}.` : "",
    v.follow_up ? `What was promised: ${String(v.follow_up)}${v.follow_up_due ? ` by ${String(v.follow_up_due)}` : ""}.` : "",
    Array.isArray(v.tags) && v.tags.length ? `Tags: ${(v.tags as string[]).join(", ")}.` : "",
    v.transcript ? `\nThe manager's own account: ${String(v.transcript)}` : "",
  ].filter(Boolean);

  return lines.join("\n\n");
}

/**
 * Put a confirmed visit into the knowledge base, replacing the one it had.
 *
 * Best effort on purpose: the visit is already saved and confirmed by the time
 * this runs, and an embedding provider having a bad minute must not turn a
 * manager's confirmation into an error they have to understand.
 */
async function indexVisitAsKnowledge(
  service: ReturnType<typeof createClient>,
  visit: Record<string, unknown>,
): Promise<{ indexed: boolean; reason?: string }> {
  if (!VOYAGE_API_KEY) return { indexed: false, reason: "no embedding key" };
  const visitId = String(visit.id);
  const brandId = Number(visit.brand_id);

  let shopName: string | null = null;
  if (visit.shop_id != null) {
    const { data: shop } = await service
      .from("shops").select("name").eq("id", visit.shop_id).maybeSingle();
    shopName = (shop as { name?: string } | null)?.name ?? null;
  }

  const content = visitAsProse(visit, shopName);
  if (content.trim().length < 40) return { indexed: false, reason: "too little to index" };

  const title = `Visit — ${visit.customer_said ?? "walk-in"} — ${String(visit.visited_at ?? "").slice(0, 10)}`;

  // Replace rather than accumulate: a corrected card must not leave its earlier
  // reading in the index to be retrieved later as if it were true.
  await service.from("brand_knowledge_docs").delete().eq("visit_id", visitId);

  const { data: doc, error: docErr } = await service
    .from("brand_knowledge_docs")
    .insert({
      brand_id: brandId,
      visit_id: visitId,
      title: title.slice(0, 200),
      // Its own category: this is neither policy nor storytelling, and a head of
      // CRM filtering the knowledge page deserves to see where it came from.
      category: "floor",
      source_type: "visit",
      content,
      char_count: content.length,
      status: "processing",
      created_by: (visit.recorded_by as string | null) ?? null,
    })
    .select("id")
    .single();
  if (docErr || !doc) return { indexed: false, reason: docErr?.message ?? "doc insert failed" };

  const docId = (doc as { id: string }).id;
  try {
    const chunks = chunkText(content);
    if (!chunks.length) throw new Error("no chunkable content");
    const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);
    const rows = chunks.map((c, i) => ({
      doc_id: docId, brand_id: brandId, chunk_index: i,
      content: c, token_count: Math.round(c.length / 4), embedding: embeddings[i],
    }));
    const { error: insErr } = await service.from("brand_knowledge_chunks").insert(rows);
    if (insErr) throw new Error(insErr.message);
    await service.from("brand_knowledge_docs")
      .update({ status: "ready", chunk_count: chunks.length, error: null })
      .eq("id", docId);
    return { indexed: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    await service.from("brand_knowledge_docs")
      .update({ status: "error", error: reason.slice(0, 500) })
      .eq("id", docId);
    return { indexed: false, reason };
  }
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return originRefused();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("POST only", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("unauthorised", 401);

  // The caller's own client: RLS decides what they may read, and the insert at
  // the end goes through it too, so a store manager cannot file a visit for a
  // brand that is not theirs even if they ask for one.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return jsonError("unauthorised", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid JSON body");
  }

  // ── Confirming a card ──────────────────────────────────────────────────────
  // The manager has read what we made of their note and is saying it is right.
  // That is the moment the visit becomes true, and therefore the moment it is
  // worth remembering: the row goes to 'confirmed' and the same account is
  // written into the knowledge base, where the assistant retrieves it beside
  // the house's own documents. A draft is never indexed.
  if (body.action === "confirm") {
    const visitId = text(body.visit_id, 60);
    if (!visitId) return jsonError("visit_id is required");

    const patch: Record<string, unknown> = {
      status: "confirmed",
      needs_review: false,
      confirmed_at: new Date().toISOString(),
    };
    // Only the fields a manager can actually correct on the card.
    for (const f of ["outcome", "summary", "objection", "follow_up", "customer_id"]) {
      if (f in body) patch[f] = body[f] === "" ? null : body[f];
    }
    if ("follow_up_due" in body) patch.follow_up_due = isoDate(body.follow_up_due);

    // Through the caller's client: RLS decides whether this visit is theirs.
    const { data: saved, error } = await userClient
      .from("store_visits")
      .update(patch)
      .eq("id", visitId)
      .select()
      .maybeSingle();
    if (error) return jsonError(`could not confirm: ${error.message}`, 500);
    if (!saved) return jsonError("no such visit", 404);

    // Best effort, deliberately: the visit is confirmed and saved by now, and a
    // bad minute at the embedding provider must not turn a manager's
    // confirmation into an error they are asked to understand.
    const indexed = await indexVisitAsKnowledge(
      serviceClient,
      saved as unknown as Record<string, unknown>,
    ).catch((e) => ({ indexed: false, reason: e instanceof Error ? e.message : "unknown" }));
    if (!indexed.indexed) console.warn("[visit-note index]", indexed.reason);

    return jsonOk({ visit: saved, knowledge: indexed });
  }

  const transcript = text(body.transcript, 8000);
  if (!transcript) return jsonError("transcript is required");

  // Who is filing this. Admins may pass brand_id; a brand caller is pinned to
  // their own, whatever they send.
  //
  // Admins are NOT profiles — they live in their own table, and every piece of
  // code that assumed "no profile row means admin" has been wrong about a
  // deleted or half-provisioned user at least once. Ask the admins table.
  const { data: profile } = await userClient
    .from("profiles")
    .select("id, brand_id, role, shop_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const { data: adminRow } = await serviceClient
    .from("admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const isAdmin = !!adminRow;

  // A brand's CLIENTS are profiles of that brand too, and they must never file
  // a visit. Tested as an ALLOWLIST, not as "not a customer": the demo
  // generator inserts clients with role NULL, so a not-a-customer test lets
  // every one of them through (see 20260915000003).
  const STAFF_ROLES = ["brand", "brand_admin", "brand_user"];
  if (!isAdmin) {
    if (!profile) return jsonError("admin or brand role required", 403);
    if (!STAFF_ROLES.includes(String((profile as { role: string | null }).role ?? ""))) {
      return jsonError("admin or brand role required", 403);
    }
  }

  const brandId = isAdmin && body.brand_id != null
    ? Number(body.brand_id)
    : Number((profile as { brand_id: number } | null)?.brand_id);
  if (!brandId || Number.isNaN(brandId)) return jsonError("brand_id is required");

  const shopId = body.shop_id != null
    ? Number(body.shop_id)
    : (profile as { shop_id: number | null } | null)?.shop_id ?? null;

  // ── The catalogue the manager is actually standing in ──────────────────────
  let catalogue = "";
  try {
    const { data: products } = await serviceClient
      .from("storefront_products")
      .select("sku, name, category, collection")
      .eq("brand_id", brandId)
      .limit(MAX_CATALOGUE);
    catalogue = (products ?? [])
      .filter((p: Record<string, unknown>) => p.sku && p.name)
      .map((p: Record<string, unknown>) =>
        `${p.sku} — ${p.name}${p.category ? ` (${p.category})` : ""}${
          p.collection ? ` [${p.collection}]` : ""
        }`
      )
      .join("\n");
  } catch (e) {
    // A brand with no catalogue yet is a normal state, not a failure: the note
    // is still worth structuring, it just won't carry SKUs.
    console.warn("[visit-note catalogue]", e instanceof Error ? e.message : e);
  }

  // ── Structure it ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let parsed: Structured;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Cached: the instructions are identical for every visit, so a busy
      // Saturday afternoon pays for them once.
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            `Today is ${today}.`,
            catalogue
              ? `\nCatalogue (SKU — name):\n${catalogue}`
              : "\n(No catalogue available for this brand — leave every sku null.)",
            `\nThe manager's note:\n"""${transcript}"""`,
            `\nReturn the JSON object now.`,
          ].join("\n"),
        },
      ],
    });
    const out = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    parsed = JSON.parse(stripJsonFence(out)) as Structured;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[visit-note structure]", message);
    // The transcript is the irreplaceable part — it exists only in the manager's
    // memory otherwise. Keep it even when the structuring failed, so nothing a
    // person actually said is lost to an API hiccup.
    const { data: failed } = await userClient
      .from("store_visits")
      .insert({
        brand_id: brandId,
        shop_id: shopId,
        recorded_by: (profile as { id: string } | null)?.id ?? null,
        source: (body.source === "typed" ? "typed" : "voice"),
        audio_path: text(body.audio_path, 400),
        transcript,
        status: "failed",
        needs_review: true,
        error: message.slice(0, 500),
      })
      .select()
      .maybeSingle();
    return jsonOk({ error: `structuring failed: ${message}`, visit: failed }, 502);
  }

  // ── Who was it ─────────────────────────────────────────────────────────────
  // Name matching stays in code, not in the model: it is a lookup, and the
  // model has no business seeing the brand's client list to do it.
  const said = text(parsed.customer_said, 120);
  let customerId: string | null = null;
  let matchConfidence: "exact" | "likely" | "none" = "none";
  if (said) {
    // Commas break PostgREST's filter grammar and the failure is silent — the
    // search just returns nothing. Strip them rather than lose the match.
    const cleaned = said.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
    const parts = cleaned.split(" ").filter((p) => p.length > 1);
    const first = parts[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1] : "";

    // Clients are role 'customer' OR role NULL — the generated ones carry no
    // role at all, and filtering on 'customer' alone silently matches nobody
    // in exactly the accounts a demo runs in.
    const { data: candidates } = await userClient
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("brand_id", brandId)
      .or("role.is.null,role.eq.customer")
      .ilike("last_name", last ? `%${last}%` : `%${first}%`)
      .limit(10);

    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    const rows = candidates ?? [];
    const full = (r: Record<string, unknown>) =>
      `${norm(r.first_name)} ${norm(r.last_name)}`.trim();

    const exact = rows.find((r) => full(r) === norm(cleaned));
    if (exact) {
      customerId = exact.id as string;
      matchConfidence = "exact";
    } else if (rows.length === 1 && last) {
      // One person of that surname in the whole brand: likely, not certain.
      // The UI asks; it does not assume.
      customerId = rows[0].id as string;
      matchConfidence = "likely";
    }
  }

  // ── File it ────────────────────────────────────────────────────────────────
  const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : [];
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5)
    : [];

  const row = {
    brand_id: brandId,
    shop_id: shopId,
    recorded_by: (profile as { id: string } | null)?.id ?? null,
    customer_id: customerId,
    customer_said: said,
    match_confidence: matchConfidence,
    visited_at: text(body.visited_at, 40) ?? new Date().toISOString(),
    source: body.source === "typed" ? "typed" : "voice",
    audio_path: text(body.audio_path, 400),
    transcript,
    language: text(parsed.language, 12),
    outcome: ONE_OF(parsed.outcome, ["purchased", "not_purchased", "undecided"]),
    summary: text(parsed.summary, 1000),
    items,
    objection: text(parsed.objection, 1000),
    occasion: text(parsed.occasion, 120),
    sentiment: ONE_OF(parsed.sentiment, ["positive", "neutral", "negative"]),
    follow_up: text(parsed.follow_up, 1000),
    follow_up_due: isoDate(parsed.follow_up_due),
    tags,
    status: "draft",
    // A match we are only "likely" about is exactly the kind of guess a human
    // should look at before this becomes someone's client history.
    needs_review: parsed.needs_review === true || matchConfidence === "likely",
  };

  const { data: visit, error } = await userClient
    .from("store_visits")
    .insert(row)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[visit-note insert]", error.message);
    return jsonError(`could not save the visit: ${error.message}`, 500);
  }

  return jsonOk({ visit });
});
