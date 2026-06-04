// feedback-themes: AI-summarised themes from public.feedback.comment for a
// single brand. Brand callers are pinned to their own brand; admins can pass
// `brand_id`. Returns a small JSON payload designed to render as an Insights
// tile. Cached for 6h in public.feedback_themes_cache; `force_refresh: true`
// bypasses the cache.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500;
const CACHE_TTL_HOURS = 6;
const MAX_COMMENTS = 400;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
You analyse customer feedback comments for a single luxury brand and extract
3–6 recurring themes. Read the comments and return STRICT JSON with this
exact shape (no markdown fence, no preamble):

{
  "themes": [
    {
      "label": "Short noun-phrase title (≤ 50 chars)",
      "summary": "1 sentence on what customers are saying.",
      "sentiment": "positive" | "negative" | "mixed",
      "count": <integer — approximate number of comments touching this theme>,
      "sample": "One representative verbatim quote (≤ 140 chars), exactly as written"
    }
  ],
  "overall_sentiment": "positive" | "negative" | "mixed",
  "comment_count": <integer — total comments analysed>
}

Rules:
- Group near-duplicates into the same theme. Pick the most representative
  phrasing for the label.
- Order themes by count, descending.
- The sample MUST be a verbatim excerpt from the input, not paraphrased.
- If a comment is just praise with no specific theme, lump it under
  "General praise"; same for vague complaints → "General complaints".
- Do NOT invent themes that aren't supported by the comments.
- If there are fewer than 5 comments total, return at most 3 themes.
`.trim();

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

  // Resolve mode + brand scope. Admins can pass brand_id; brand users are
  // pinned to their own brand regardless of what they send.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requestedBrandId = Number(body.brand_id ?? 0) || null;
  const windowDays = clampInt(body.window_days, 30, 7, 365);
  const forceRefresh = Boolean(body.force_refresh);
  const locale = body.locale === "it" ? "it" : "en";

  let brandId: number | null = null;
  let isAdmin = false;

  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminRow) {
    isAdmin = true;
    brandId = requestedBrandId;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: profileRow } = await userClient
      .from("profiles")
      .select("brand_id, role")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"])
      .maybeSingle();
    if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
    brandId = profileRow.brand_id as number;
  }

  // Cache lookup — bypass when force_refresh is set.
  if (!forceRefresh) {
    const { data: cached } = await userClient
      .from("feedback_themes_cache")
      .select("payload, generated_at")
      .eq("brand_id", brandId)
      .eq("window_days", windowDays)
      .eq("locale", locale)
      .maybeSingle();
    if (cached?.generated_at) {
      const ageHours =
        (Date.now() - new Date(cached.generated_at as string).getTime()) / 36e5;
      if (ageHours < CACHE_TTL_HOURS) {
        return jsonOk({
          ...((cached.payload as Record<string, unknown>) ?? {}),
          cached: true,
          generated_at: cached.generated_at,
        });
      }
    }
  }

  // Pull comments. We use the user client so RLS still applies as a
  // defence in depth, but the brand RLS on feedback already allows
  // brand_user/brand_admin to read their brand's rows.
  const sinceIso = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: rows, error: rowsErr } = await userClient
    .from("feedback")
    .select("comment, satisfaction_rate, created_at")
    .eq("brand_id", brandId)
    .gte("created_at", sinceIso)
    .not("comment", "is", null)
    .is("impersonated_by", null)
    .order("created_at", { ascending: false })
    .limit(MAX_COMMENTS);

  if (rowsErr) return jsonError(`fetch failed: ${rowsErr.message}`, 500);

  const comments = (rows ?? [])
    .map((r) => String(r.comment ?? "").trim())
    .filter((s) => s.length > 0);

  if (comments.length === 0) {
    const payload = {
      themes: [],
      overall_sentiment: "mixed" as const,
      comment_count: 0,
    };
    await writeCache(brandId, windowDays, locale, payload);
    return jsonOk({ ...payload, cached: false, generated_at: new Date().toISOString() });
  }

  // Build the analysis prompt. The full comment list goes in the user turn
  // (numbered); the schema-rules go in the system turn with caching so a
  // repeat call inside the cache window is cheap.
  const localeNote = locale === "it"
    ? "\n\nThe brand's UI is in Italian. Write `label`, `summary`, and overall labels in Italian. The `sample` field MUST stay as the verbatim original quote."
    : "";

  const userMessage = comments
    .slice(0, MAX_COMMENTS)
    .map((c, i) => `${i + 1}. ${c.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let payload: unknown;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM + localeNote,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Comments (${comments.length}):\n${userMessage}\n\nReturn the JSON object now.`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    payload = JSON.parse(stripJsonFence(text));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    return jsonError(`analysis failed: ${message}`, 500);
  }

  await writeCache(brandId, windowDays, locale, payload);

  return jsonOk({
    ...(payload as Record<string, unknown>),
    cached: false,
    generated_at: new Date().toISOString(),
  });

  // ── helpers
  async function writeCache(b: number, w: number, loc: string, p: unknown) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await admin
        .from("feedback_themes_cache")
        .upsert(
          { brand_id: b, window_days: w, locale: loc, payload: p, generated_at: new Date().toISOString() },
          { onConflict: "brand_id,window_days,locale" },
        );
    } catch (e) {
      console.error("[feedback-themes cache write]", e);
    }
  }
});

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
function stripJsonFence(s: string) {
  return s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
