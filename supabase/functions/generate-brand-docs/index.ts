// generate-brand-docs: the onboarding paperwork, written in the brand's voice.
//
// A new brand needs the same five documents every brand needs — a customer FAQ,
// a one-pager for the sales floor, a plain summary of what the cover does, the
// activation email, and a commercial proposal. Roberto Coin's were written by
// hand over weeks; this drafts them from what the crawler already indexed about
// the house (its story, its tone, its care and returns policy) plus the
// commercial terms on the brand record.
//
// Everything is a DRAFT. Nothing reaches a customer until someone approves it —
// the FAQ only lands on brands.faq_en / faq_it via approve_brand_faq. Each doc
// stores the passages it was written from, so any claim can be traced back.
//
// Auth: AION admin, or batch (service role / x-batch-secret) from onboard-brand.
// Body: { brand_id, kinds?: string[], locales?: ("en"|"it")[], force?: boolean }

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const MODEL = Deno.env.get("DOCS_MODEL") ?? "claude-sonnet-4-6";
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const EMBED_MODEL = "voyage-3.5";
const EMBED_DIMS = 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Kind = "faq" | "associate_onepager" | "cover_summary" | "welcome_email" | "partnership_proposal";
const ALL_KINDS: Kind[] = ["faq", "associate_onepager", "cover_summary", "welcome_email", "partnership_proposal"];

// What each document is for, who reads it, and what it must not do. The house
// voice comes from the retrieved passages, not from here.
const TEMPLATES: Record<Kind, { title: string; audience: string; brief: string; json?: boolean }> = {
  faq: {
    title: "Customer FAQ",
    audience: "a client of the house who has just been offered the protection service in boutique",
    json: true,
    brief: `12–16 questions a real client actually asks, in the order they'd ask them:
what the service is, what it costs them, what is and isn't covered, how long it
lasts, what happens if the piece is stolen or damaged, how to make a claim, what
they receive (a replacement of equal value via voucher), whether it transfers if
the piece is a gift, what happens if they move country, and who to contact.
Answer each in 2–5 sentences, warm and plain — never legalese, never a wall of
text. If the commercial terms below don't tell you a figure, say how the client
finds it out instead of inventing one.`,
  },
  associate_onepager: {
    title: "Sales associate one-pager",
    audience: "a sales associate on the floor of this house, who has 30 seconds between serving clients",
    brief: `A single page they can hold. Sections, in this order:
what this service is in one sentence they can say out loud; the three reasons a
client says yes (in the client's language, not ours); exactly when to raise it in
the sale (after the piece is chosen, before payment); the words to use — two or
three short scripts, one for a first-time client, one for a returning client, one
for "I already have insurance"; the two objections they'll actually hear and the
honest answer to each; what happens after the client says yes; and who to ask
internally when they're unsure. No marketing adjectives — this is a working card.`,
  },
  cover_summary: {
    title: "What the cover does — client summary",
    audience: "a client deciding whether to activate, and the associate explaining it to them",
    brief: `A plain-language summary of the protection: what triggers it, what the
client gets, what it excludes, how long it runs, and what the client must do (and
by when) if something happens. Use the house's own product vocabulary — a house
that sells gowns should not read like a jewellery policy. Be specific about the
exclusions; a summary that hides them is worse than none. Close with the one
sentence an associate can say when a client asks "so what does it actually do?".`,
  },
  welcome_email: {
    title: "Client activation email",
    audience: "a client who has just bought a piece and is being invited to activate their cover",
    brief: `A short email in the house's voice: subject line, preheader, and a body
of at most 150 words. Lead with the piece they just chose, not with us. One clear
action (activate), one line on what it gives them, one line on how long it takes.
No exclamation marks, no stock phrases like "we are excited". Sign off the way
this house would.`,
  },
  partnership_proposal: {
    title: "Partnership proposal",
    audience: "the brand's own commercial and client-experience leadership — not their customers",
    brief: `A one-page proposal to the house. What the service gives their client,
what it gives the house (attach rate, client data at the point of sale, a reason
for the associate to follow up, a renewal moment), how it works operationally in
boutique, what it asks of them, and the commercial terms as stated below. Ground
the "why this house" paragraph in what the indexed material actually says about
them — their clientele, their craft, their service culture. If the terms below
are blank, write the placeholder as [to be agreed] rather than inventing a number.`,
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const isBatch =
    (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) ||
    token === SUPABASE_SERVICE_ROLE_KEY || jwtRole(token) === "service_role";
  if (!isBatch) {
    if (!token) return json({ error: "missing bearer token" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid session" }, 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return json({ error: "AION admin only" }, 403);
  }

  const brandId = Number(body.brand_id ?? 0);
  if (!brandId) return json({ error: "brand_id required" }, 400);

  const { data: brand } = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  if (String(body.action ?? "") === "approve_faq") {
    const { data, error } = await admin.rpc("approve_brand_faq", { p_brand_id: brandId });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  const kinds = (Array.isArray(body.kinds) && body.kinds.length
    ? (body.kinds as string[]).filter((k) => (ALL_KINDS as string[]).includes(k))
    : ALL_KINDS) as Kind[];
  const locales = (Array.isArray(body.locales) && body.locales.length
    ? (body.locales as string[]).filter((l) => l === "en" || l === "it")
    : ["en"]) as ("en" | "it")[];

  // The house's own material is the whole point — without it these would be
  // generic templates with a name swapped in.
  const context = await brandContext(admin, brandId);
  if (!context.passages.length) {
    return json({ ok: false, reason: "nothing indexed for this brand yet — run the crawl first, or the documents would just be a template with the name changed" });
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const written: Record<string, unknown> = {};

  for (const kind of kinds) {
    for (const locale of locales) {
      // The FAQ is bilingual by design; the rest default to English only unless asked.
      try {
        const existing = await admin.from("brand_documents")
          .select("id, status").eq("brand_id", brandId).eq("kind", kind).eq("locale", locale).maybeSingle();
        if (existing.data && existing.data.status !== "draft" && body.force !== true) {
          written[`${kind}.${locale}`] = { skipped: "already approved — pass force to overwrite" };
          continue;
        }

        const doc = await writeDocument(anthropic, brand, context, kind, locale);
        const { error } = await admin.from("brand_documents").upsert({
          brand_id: brandId, kind, locale,
          title: doc.title, body_md: doc.body_md, body_json: doc.body_json ?? null,
          status: "draft", model: MODEL, sources: context.sources,
          generated_at: new Date().toISOString(), approved_at: null,
        }, { onConflict: "brand_id,kind,locale" });
        if (error) throw new Error(error.message);

        written[`${kind}.${locale}`] = {
          ok: true, title: doc.title, words: doc.body_md.split(/\s+/).length,
          entries: Array.isArray(doc.body_json) ? doc.body_json.length : undefined,
        };
      } catch (e) {
        written[`${kind}.${locale}`] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return json({
    ok: true, brand_id: brandId, documents: written,
    grounded_in: context.sources.length,
    retrieval: (context as { diagnostics?: unknown }).diagnostics,
  });
});

// ── The house's own material ─────────────────────────────────────────────────
// Retrieved by MEANING, not by length. Taking the longest documents per category
// sounds reasonable and isn't: for Luisa Beccaria it returned cookie-consent
// pages and wine-glass spec sheets, and the drafts came out grounded in
// tableware for a couture house. These queries ask for the things a document
// writer actually needs — who they are, how they speak, how they treat a client.
const CONTEXT_QUERIES = [
  "the brand story, its founding and its heritage",
  "the values and philosophy of the house",
  "how the brand describes itself — tone of voice, the world it evokes",
  "craftsmanship, materials and how the pieces are made",
  "the clients of the house and how they are looked after in boutique",
  "returns, exchanges, repairs, product care and after-sales policy",
];

async function brandContext(admin: ReturnType<typeof createClient>, brandId: number) {
  const seen = new Map<string, { title: string; url: string | null; category: string; content: string }>();
  const retrievalErrors: string[] = [];
  let semanticHits = 0;

  for (const q of CONTEXT_QUERIES) {
    try {
      const embedding = await embedQuery(q);
      // Check the error. Destructuring only `data` meant an RPC failure arrived
      // as null, the loop ran zero times, and the whole thing reported "no
      // matches" — indistinguishable from an empty knowledge base.
      const { data, error: rpcErr } = await admin.rpc("match_brand_knowledge", {
        p_brand_id: brandId,
        p_query_embedding: embedding,
        // Ask for a wide window, not a narrow one. Product pages dominate a
        // luxury corpus — Pasquale Bruni is 256 products out of 412 documents —
        // so the top six for "craftsmanship and materials" are ALL products,
        // every one of them gets excluded from the voice context, and the search
        // returns nothing usable. Widening past the product wall is what lets
        // the editorial and the press coverage through.
        p_match_count: 24,
        p_min_similarity: 0.15,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      for (const m of (data ?? []) as { doc_title: string; source_url: string | null; category: string; content: string }[]) {
        // Boilerplate the crawler couldn't strip is worse than nothing here: it
        // teaches the model the wrong voice.
        if (isBoilerplate(m.doc_title, m.content)) continue;
        // Product pages are spec sheets. They out-number editorial 13 to 1 and
        // win every "materials and craftsmanship" search, which is how a couture
        // house ended up with an activation email about a candle vase. The range
        // is supplied separately as facts (below); voice comes from editorial.
        if (m.category === "product") continue;
        semanticHits++;
        if (!seen.has(m.doc_title)) {
          seen.set(m.doc_title, { title: m.doc_title, url: m.source_url, category: m.category, content: m.content });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      retrievalErrors.push(`${q}: ${msg}`);
      console.warn("[generate-brand-docs] retrieval", q, msg);
    }
  }

  // Fall back to the longest storytelling documents if the search is unavailable
  // — better a rough context than none, and the caller reports how many it got.
  if (seen.size === 0) {
    const { data: docs } = await admin.from("brand_knowledge_docs")
      .select("title, category, source_url, content")
      .eq("brand_id", brandId).in("category", ["storytelling", "policy"])
      .order("char_count", { ascending: false }).limit(8);
    for (const d of docs ?? []) {
      if (isBoilerplate(d.title, String(d.content ?? ""))) continue;
      seen.set(d.title, { title: d.title, url: d.source_url, category: d.category, content: String(d.content ?? "") });
    }
  }

  const usedFallback = seen.size === 0;
  const picked = [...seen.values()].slice(0, 24);
  const range = await catalogueSummary(admin, brandId);

  return {
    passages: [
      ...(range ? [`## What this house sells\n${range}`] : []),
      ...picked.map((d) => `## ${d.title}\n${d.content.slice(0, 3000)}`),
    ],
    sources: picked.map((d) => ({ title: d.title, url: d.url, category: d.category })),
    diagnostics: { semantic_hits: semanticHits, used_fallback: usedFallback, retrieval_errors: retrievalErrors.slice(0, 6) },
  };
}

// What the house actually sells, as facts rather than prose — so a document can
// say "gowns" instead of guessing from whichever product page ranked highest.
async function catalogueSummary(admin: ReturnType<typeof createClient>, brandId: number): Promise<string | null> {
  const { data } = await admin.from("storefront_products")
    .select("category, collection, price").eq("brand_id", brandId).limit(2000);
  if (data?.length) {
    const byCat = new Map<string, { n: number; lo: number; hi: number }>();
    for (const r of data as { category: string | null; price: number | null }[]) {
      const k = r.category ?? "other";
      const cur = byCat.get(k) ?? { n: 0, lo: Infinity, hi: 0 };
      cur.n++;
      if (r.price != null) { cur.lo = Math.min(cur.lo, r.price); cur.hi = Math.max(cur.hi, r.price); }
      byCat.set(k, cur);
    }
    const lines = [...byCat.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10)
      .map(([k, v]) => `- ${k.toLowerCase()}: ${v.n} pieces${Number.isFinite(v.lo) && v.hi ? `, EUR ${Math.round(v.lo)}–${Math.round(v.hi)}` : ""}`);
    return `The live catalogue, by type:\n${lines.join("\n")}`;
  }

  // No feed — use the indexed product page TITLES (names only, never their body
  // text, which is what dragged the voice off course).
  const { data: docs } = await admin.from("brand_knowledge_docs")
    .select("title").eq("brand_id", brandId).eq("category", "product").limit(60);
  if (!docs?.length) return null;
  return `Examples of pieces this house sells (names only):\n${docs.map((d) => `- ${d.title}`).join("\n")}`;
}

// Cookie banners, consent text and shipping tables are indexed like everything
// else and read as "the brand's writing" if you let them.
function isBoilerplate(title: string, content: string): boolean {
  const t = `${title} ${content.slice(0, 400)}`.toLowerCase();
  return /cookie|consent|privacy polic|newsletter|sign up to our|change your browsing country|total items in cart/.test(t)
    && !/founded|heritage|craftsman|atelier|our story|values/.test(t);
}

async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: [query], model: EMBED_MODEL, input_type: "query", output_dimension: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}`);
  return (await res.json())?.data?.[0]?.embedding ?? [];
}

async function writeDocument(
  anthropic: Anthropic,
  brand: Record<string, unknown>,
  context: { passages: string[]; sources: unknown[] },
  kind: Kind,
  locale: "en" | "it",
) {
  const t = TEMPLATES[kind];
  const name = String(brand.name ?? "the brand");

  const terms = [
    brand.activation_fee != null ? `activation fee: ${pct(brand.activation_fee)} of the piece's price` : null,
    brand.insurance_premium != null ? `insurance premium: ${pct(brand.insurance_premium)} of cost of goods` : null,
    brand.aion_premium_fee != null ? `AION share of premium: ${pct(brand.aion_premium_fee)}` : null,
  ].filter(Boolean).join("\n") || "(no commercial terms recorded on the brand yet)";

  const system = `You write onboarding documents for AION Cover, which provides a
two-year worldwide protection service that luxury houses offer their clients on
the pieces they buy (theft, robbery, irreparable accidental damage → a
replacement of equal value via a digital voucher).

You are writing for ${name}. Everything you say about the house — its story, its
clientele, its products, its service culture, its tone — must come from the
passages supplied. Do not use anything you may know about this house from
elsewhere; it may be wrong or out of date. If the passages don't support a
claim, leave it out rather than filling the gap.

Match the house's register: read the passages and write the way they write. A
romantic ready-to-wear house and a jewellery maison do not sound alike, and
neither should sound like an insurer.

Write in ${locale === "it" ? "Italian" : "English"}.

Never invent: prices, percentages, claim deadlines, phone numbers, email
addresses, legal entities or coverage limits. Where a specific figure is needed
and not supplied, write it as a clearly marked placeholder in square brackets.

This is a draft for a human at AION to review. Accuracy beats polish.`;

  const user = `# Document to write
${t.title} — for ${t.audience}.

${t.brief}

# Commercial terms on record for ${name}
${terms}

# What we have indexed about ${name}
${context.passages.join("\n\n---\n\n").slice(0, 60000)}

# Output
${t.json
  ? `Return ONLY a JSON array, no prose around it. Each element:
{"title": "the question", "content": {"type": "blocks", "blocks": [{"type": "p", "text": "..."}]}}
Use {"type":"ul","items":["...","..."]} for a block that is genuinely a list.`
  : `Return the document as markdown. Start with a single "# " title line. No preamble, no closing commentary.`}`;

  // A 16-question FAQ with structured blocks is long; too small a budget and the
  // JSON is cut mid-array and parses as nothing.
  const maxTokens = t.json ? 16000 : 8000;
  const ask = async (extra?: string) => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
    });
    return {
      text: res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim(),
      truncated: res.stop_reason === "max_tokens",
    };
  };

  let { text, truncated } = await ask();

  if (t.json) {
    let parsed = extractJsonArray(text);
    if (!parsed) {
      // One retry, told exactly what went wrong. Models sometimes wrap the array
      // in a preamble, or aim too long and get cut off.
      const retry = await ask(truncated
        ? "Your previous answer was cut off before the array closed. Write FEWER questions (10 is fine) and keep every answer to 2-3 sentences, so the JSON array is COMPLETE and closes with ]."
        : "Your previous answer was not parseable. Output the JSON array and NOTHING else — no preamble, no explanation, no markdown fence.");
      text = retry.text;
      truncated = retry.truncated;
      parsed = extractJsonArray(text);
    }
    if (!parsed) {
      throw new Error(truncated
        ? "the FAQ came back truncated twice — lower the question count"
        : "the model did not return a usable FAQ array");
    }
    const withOrder = parsed.map((q, i) => ({ ...q, sort_order: i + 1 }));
    return {
      title: `${t.title} — ${name}`,
      body_md: withOrder.map((q) => `### ${q.title}\n${blocksToText(q.content)}`).join("\n\n"),
      body_json: withOrder,
    };
  }

  return {
    title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() || `${t.title} — ${name}`,
    body_md: text,
    body_json: null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function extractJsonArray(text: string): { title: string; content: { type: string; blocks: unknown[] } }[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter((q) => q?.title && q?.content?.blocks);
  } catch { return null; }
}

function blocksToText(content: { blocks?: unknown[] }): string {
  return (content?.blocks ?? []).map((b) => {
    const blk = b as { type?: string; text?: string; items?: string[] };
    if (blk.type === "ul") return (blk.items ?? []).map((i) => `- ${i}`).join("\n");
    return blk.text ?? "";
  }).join("\n\n");
}

function pct(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2).replace(/\.?0+$/, "")}%` : String(v);
}

function jwtRole(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const pad = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

function json(payload: unknown, code = 200) {
  return new Response(JSON.stringify(payload), {
    status: code, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
