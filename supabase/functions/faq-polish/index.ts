// faq-polish — rewrites a single FAQ entry (question + answer) in the brand's
// voice, tightening grammar and tone. Brand team clicks "Polish with AI" on
// a row in BrandFaq; this function returns a refined pair they can accept
// or discard. Voice consistency comes from passing sibling Q&As as a sample.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
You polish a single FAQ entry for a luxury jewelry brand. The brand's
existing FAQ entries (provided as a voice sample) tell you the right
tone, formality, and vocabulary. Return STRICT JSON:

{
  "question": "Cleaner question — preserves meaning, fixes grammar, matches the brand's question style.",
  "answer":   "Refined answer — same length range, brand voice, accurate to the original. No invented policies or numbers."
}

# Rules
- Stay faithful to the meaning of the input. Do not introduce new facts,
  dates, prices, or coverage rules.
- Match the brand's tone and sentence rhythm from the voice sample.
- Keep the same language as the input (English or Italian).
- Output strict JSON only, no markdown fence, no preamble.
- If the input is already polished, return it essentially unchanged
  (a one-word fix is fine).
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

  // Brand or admin only.
  const { data: callerProfile } = await userClient
    .from("profiles")
    .select("role, brand_id, brands(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: adminRow } = await userClient
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow && (!callerProfile || !["brand", "brand_admin", "brand_user"].includes(callerProfile.role ?? ""))) {
    return jsonError("brand or admin role required", 403);
  }

  const brandRel = (callerProfile as any)?.brands;
  const brandName = (Array.isArray(brandRel) ? brandRel[0]?.name : brandRel?.name) ?? null;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const question = String(body.question ?? "").trim();
  const answer = String(body.answer ?? "").trim();
  const locale = body.locale === "it" ? "it" : "en";
  const voiceSample = typeof body.voice_sample === "string"
    ? body.voice_sample.slice(0, 6000)
    : "";

  if (!question && !answer) return jsonError("question or answer required", 400);

  const userMessage = [
    `Brand: ${brandName ?? "(unspecified)"}`,
    `Language: ${locale === "it" ? "Italian" : "English"}`,
    "",
    voiceSample
      ? "## Brand voice sample (other Q&A from this same FAQ)\n" + voiceSample
      : "## Brand voice sample\n(none provided — use a polished, calm luxury tone)",
    "",
    "## Entry to polish",
    `Q: ${question || "(no question provided — generate from the answer)"}`,
    `A: ${answer || "(no answer provided — generate from the question)"}`,
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
    console.error("[faq-polish]", message);
    return jsonError(`polish failed: ${message}`, 500);
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
