// customer-outreach-draft — generates a personalised outreach email draft
// for a brand clienteling team. Pulls the customer's purchase history,
// segment flags, brand FAQ, and a chosen intent (cross_sell / renewal /
// win_back / check_in), and returns a subject + body the brand reviews
// before sending via mailto: or their CRM.
//
// Auth: brand user (brand / brand_admin / brand_user). RLS on the user
// client guarantees the customer belongs to the caller's brand — the
// fetch will return 0 rows otherwise.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INTENT_BRIEFS: Record<string, { goal: string; cta: string; tone: string }> = {
  cross_sell: {
    goal: "Suggest one or two specific pieces from the brand's catalogue that complement what the customer already owns. Reference what they own briefly to make it feel personal, not pushy.",
    cta: "Invite the customer to visit the boutique or reply to discuss.",
    tone: "warm, concierge-like, never sales-y",
  },
  renewal_nudge: {
    goal: "Remind the customer their cover is approaching expiry. Note the specific piece(s) and the date. Frame as a value reminder — ongoing peace of mind — not a renewal sale.",
    cta: "Invite them to confirm renewal or visit the boutique.",
    tone: "calm, reassuring, never alarming",
  },
  win_back: {
    goal: "Reconnect with a customer who hasn't purchased in 12+ months. Reference their past piece(s) fondly. Mention something new from the brand that might align with what they own.",
    cta: "Invite them to drop by the boutique or reply.",
    tone: "personal, nostalgic, not desperate",
  },
  check_in: {
    goal: "Brief, warm check-in. Hope they are well, ask how they've been enjoying their piece. No sales angle.",
    cta: "Optional: invite them to share thoughts or visit when convenient.",
    tone: "personal, light, never pushy",
  },
};

const SYSTEM = `
You draft personalised outreach emails for a luxury jewelry brand's
clienteling team. You write in the brand's voice and the customer's
language. Output STRICT JSON with this exact shape:

{
  "subject": "Short subject line (≤ 70 chars) — warm, specific to the customer.",
  "body": "Email body in markdown. 4–7 short sentences split into 2–3 paragraphs. Sign off with the brand name (no individual name — the boutique team adds theirs).",
  "suggested_followup_days": <integer 7–30 — how many days later to circle back>
}

# Rules
- Use the customer's first name when greeting. If not provided, use a
  warm but generic greeting in their language. For bulk-template mode
  (when the context says "{first_name} placeholder"), write the greeting
  with literally "{first_name}" so the brand can mail-merge per recipient.
- Reference one or two specific pieces from their purchase history when
  it helps the email feel personal — never invent a piece they don't own.
- Never invent product names that aren't in the catalogue context.
- Never invent monetary values or dates beyond what's in the context.
- Match the requested tone. Keep it tight; remove fluff.
- No emojis, no "Dear esteemed customer", no over-claiming superlatives.
- Sign off with the brand name only — let the human add their own name.
- If you don't have enough context to write a meaningful email, return
  subject: "", body: "", and an empty follow-up. Don't fake it.
`.trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);

  // Caller must be a brand user; admins fall through too (treated as brand
  // mode for this tool — they can use it to demo or QA).
  const { data: callerProfile } = await userClient
    .from("profiles")
    .select("brand_id, role, brands(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const callerBrandId = callerProfile?.brand_id as number | null;
  const callerBrandName = (() => {
    const rel = (callerProfile as any)?.brands;
    return (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null;
  })();
  if (!adminRow && (!callerProfile || !callerBrandId)) {
    return jsonError("brand or admin role required", 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const customerId = String(body.customer_id ?? "").trim();
  const intent = String(body.intent ?? "check_in") as keyof typeof INTENT_BRIEFS;
  const brandFaq = typeof body.brand_faq === "string" ? body.brand_faq.slice(0, 8000) : "";
  const bulkMode = Boolean(body.bulk) || !customerId;
  const segmentLabel = typeof body.segment_label === "string" ? body.segment_label.slice(0, 80) : "";
  const recipientCount = Number.isFinite(body.recipient_count as number) ? Number(body.recipient_count) : 0;
  if (!INTENT_BRIEFS[intent]) return jsonError("unknown intent", 400);
  if (!bulkMode && !customerId) return jsonError("customer_id required for per-customer drafts", 400);

  // RLS makes this safe — the brand user only sees their own customers; if
  // they pass another brand's customer_id, the fetch returns nothing.
  // In bulk mode, no per-customer fetch — the template uses placeholders.
  let customer: any = null;
  if (!bulkMode) {
    const { data, error: custErr } = await userClient
      .from("profiles")
      .select("id, first_name, last_name, email, country, city, brand_id")
      .eq("id", customerId)
      .maybeSingle();
    if (custErr) return jsonError(`customer lookup failed: ${custErr.message}`, 500);
    if (!data) return jsonError("customer not found", 404);
    customer = data;
  }

  // Locale guess: brand profile locale would be cleaner; for now infer from
  // body.locale (the brand UI passes their current locale).
  const locale = body.locale === "it" ? "it" : "en";

  // Pull recent purchase history + open claims for context. Each query is
  // RLS-scoped server-side. Skip the per-customer fetches in bulk mode.
  const policies = bulkMode
    ? []
    : (await userClient
        .from("policies")
        .select("id, start_date, expiration_date, status, selling_price, catalogues!insured_items_item_id_fkey(name, category)")
        .eq("customer_id", customerId)
        .order("start_date", { ascending: false })
        .limit(20)).data ?? [];

  const claims = bulkMode
    ? []
    : (await userClient
        .from("claims")
        .select("id, type, status, created_at")
        .in("policy_id", (policies ?? []).map((p: any) => p.id))
        .order("created_at", { ascending: false })
        .limit(10)).data ?? [];

  const segRow = bulkMode
    ? null
    : await userClient
        .rpc("brand_customer_segments", { p_brand_id: callerBrandId ?? customer.brand_id })
        .then((r) => (r.data as any[] | null)?.find((row) => row.customer_id === customerId) ?? null)
        .catch(() => null);

  const crossSell = bulkMode
    ? null
    : (await userClient
        .rpc("brand_customer_cross_sell", { p_customer_id: customerId })).data;

  const brief = INTENT_BRIEFS[intent];

  const customerCtx = bulkMode
    ? `(Bulk template for the "${segmentLabel || "selected"}" segment — ${recipientCount} recipients. Address with a {first_name} placeholder, no specific piece references.)`
    : [
        `Customer: ${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim(),
        customer.email ? `Email: ${customer.email}` : null,
        customer.city || customer.country
          ? `Location: ${[customer.city, customer.country].filter(Boolean).join(", ")}`
          : null,
        segRow
          ? `Segments: ${[
              segRow.is_vip ? "VIP" : null,
              segRow.is_lapsed ? "Lapsed (12+mo no live cover)" : null,
              segRow.is_incomplete ? "Profile incomplete" : null,
              segRow.is_high_nps_idle ? "High NPS but idle" : null,
            ]
              .filter(Boolean)
              .join(", ") || "(none)"}`
          : null,
        segRow
          ? `Lifetime spend: €${Number(segRow.ltv ?? 0).toLocaleString("en-GB")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

  const policiesCtx = (policies ?? [])
    .slice(0, 8)
    .map((p: any) => {
      const piece = p.catalogues?.name ?? "Unknown piece";
      const cat = p.catalogues?.category ?? "";
      return `- ${piece}${cat ? ` (${cat})` : ""} · ${p.status} · started ${p.start_date ?? "?"} · expires ${p.expiration_date ?? "?"}`;
    })
    .join("\n");

  const claimsCtx = (claims ?? [])
    .slice(0, 5)
    .map((c: any) => `- claim ${c.type ?? "—"} · ${c.status} · ${c.created_at?.slice(0, 10) ?? ""}`)
    .join("\n");

  const crossSellCtx = (crossSell as any[] | null ?? [])
    .slice(0, 5)
    .map((c) => `- ${c.product_name ?? "—"}${c.category ? ` (${c.category})` : ""}${c.sku ? ` · SKU ${c.sku}` : ""} — ${c.reason ?? ""}`)
    .join("\n");

  const userMessage = [
    `Brand: ${callerBrandName ?? "(unspecified)"}`,
    `Language: ${locale === "it" ? "Italian" : "English"} — write in this language.`,
    `Intent: ${intent}`,
    `Goal: ${brief.goal}`,
    `Call to action: ${brief.cta}`,
    `Tone: ${brief.tone}`,
    "",
    "## Customer",
    customerCtx || "(no personal context)",
    "",
    "## Purchase history",
    policiesCtx || "(no purchases yet)",
    "",
    claimsCtx ? "## Recent claims\n" + claimsCtx + "\n" : "",
    crossSellCtx ? "## Suggested pieces from the catalogue\n" + crossSellCtx + "\n" : "",
    brandFaq.trim() ? "## Brand FAQ (use this voice)\n" + brandFaq.trim() : "",
    "",
    "Return the JSON object now.",
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let payload: unknown;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    payload = JSON.parse(stripJsonFence(text));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[customer-outreach-draft]", message);
    return jsonError(`draft failed: ${message}`, 500);
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function stripJsonFence(s: string) {
  return s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
