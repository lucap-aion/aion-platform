// claim-photo-prefill — analyses one or more customer-supplied photos and
// returns a draft claim (type, description, severity, observations) that the
// NewClaim form prefills. The customer always reviews and edits before
// submit — this is a wizard assist, not an auto-file. Photos travel as
// base64 in the body so we never publish them; they don't leave Anthropic
// once analysed (the response carries no image, just the suggestion).

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;
// Hard caps to keep the request payload sane and the LLM input affordable.
// 4 photos is plenty for a damage claim; 4 MB each is generous for phone JPGs.
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `
You analyse photos a luxury-jewelry customer has attached to a claim and
draft a one-shot suggestion for the claim form. The customer reviews and
edits before they submit — you are an assistant, not a decision-maker.

# Allowed claim types
- "Accidental Damage": visible physical damage to a piece (broken clasp,
  cracked stone, bent band, water damage, scratched finish).
- "Robbery": evidence of a forceful taking (police report, damaged display
  case, statement).
- "Theft": evidence of a stolen piece (empty box, missing-piece statement,
  police report, surveillance still).

# Output — strict JSON, no markdown fence, no prose before/after

{
  "suggested_type": "Accidental Damage" | "Robbery" | "Theft" | null,
  "confidence": "high" | "medium" | "low",
  "severity": "minor" | "major" | "critical" | null,
  "description": "1–3 short sentences describing what's visible. Write in
                  the customer's voice (\\"My ring's center stone has come
                  loose\\"). Stay factual; do not infer the cause beyond
                  what the photo shows.",
  "observations": [
    "Short bullet points (≤ 80 chars each) listing specific things visible
     in the photo. 2–5 bullets max."
  ]
}

# Rules
- If the photo does not show a piece of jewelry or any claim-relevant
  evidence (e.g. it's a selfie, a screenshot of unrelated content, blank
  paper), set suggested_type=null, confidence="low", severity=null,
  description="The photo doesn't clearly show what happened — could you
  retake it with the affected piece in good light?", observations=[].
- Default to "Accidental Damage" when in doubt — it's the most common
  category and the customer can switch if they meant theft/robbery.
- Never identify the customer or other people in the photo.
- Never speculate on monetary value.
- Keep the description neutral. Don't write inflammatory language
  ("destroyed", "ruined"); use measured terms ("damaged", "broken",
  "scratched").
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

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const locale = body.locale === "it" ? "it" : "en";
  const photos = Array.isArray(body.photos) ? body.photos : [];
  const productHint = typeof body.product_hint === "string" ? body.product_hint.slice(0, 200) : "";

  if (photos.length === 0) return jsonError("at least one photo required", 400);
  if (photos.length > MAX_PHOTOS) return jsonError(`max ${MAX_PHOTOS} photos`, 400);

  // Decode each photo from a data URL ("data:image/jpeg;base64,...") into
  // the Anthropic image content block shape.
  const imageBlocks: Array<{
    type: "image";
    source: { type: "base64"; media_type: string; data: string };
  }> = [];
  for (const raw of photos) {
    if (typeof raw !== "string") return jsonError("photo must be a data URL", 400);
    const match = /^data:([^;]+);base64,(.+)$/.exec(raw);
    if (!match) return jsonError("photo must be a data URL", 400);
    const mediaType = match[1].toLowerCase();
    const base64 = match[2];
    if (!ALLOWED_MEDIA.has(mediaType)) return jsonError(`unsupported media type: ${mediaType}`, 400);
    // base64 expands by 4/3 → byte length ≈ base64.length * 3/4.
    const approxBytes = (base64.length * 3) / 4;
    if (approxBytes > MAX_PHOTO_BYTES) return jsonError("photo too large (max 4MB)", 413);
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    });
  }

  const langNote = locale === "it"
    ? "\n\n# Language\nWrite `description` and `observations` in Italian. Keep the JSON keys and enum values English."
    : "";

  const productLine = productHint
    ? `\n\nContext: the customer says the affected piece is "${productHint}". Use this when describing what's damaged.`
    : "";

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  let payload: unknown;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM + langNote,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text:
                `Analyse the attached photo${imageBlocks.length === 1 ? "" : "s"} and return the JSON object now.${productLine}`,
            },
          ],
        },
      ],
    });
    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    payload = JSON.parse(stripJsonFence(text));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[claim-photo-prefill]", message);
    return jsonError(`analysis failed: ${message}`, 500);
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
