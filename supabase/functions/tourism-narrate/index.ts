// Tourism × cover-activation insight narrator.
// Reads precomputed correlations from compute_tourism_correlations() and asks
// Claude Haiku to write a short, calibrated explanation. No tool use; one shot.
//
// Body: {
//   from?: "YYYY-MM-DD", to?: "YYYY-MM-DD",
//   lagMonths?: int, metric?: "arrivals"|"presences",
//   locale?: "it"|"en"
// }

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-haiku-4-5-20251001";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function describeCorr(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.7) return "strong";
  if (a >= 0.4) return "moderate";
  if (a >= 0.2) return "weak";
  return "negligible";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing bearer token" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: uerr } = await userClient.auth.getUser();
  if (uerr || !user) {
    return new Response(JSON.stringify({ error: "invalid session" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  const { data: adminRow } = await userClient
    .from("admins").select("id").eq("user_id", user.id).maybeSingle();
  if (!adminRow) {
    return new Response(JSON.stringify({ error: "admin role required" }), {
      status: 403, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const body = await req.json().catch(() => ({}));
  const lagMonths = Number.isFinite(Number(body.lagMonths)) ? Number(body.lagMonths) : 0;
  const metric = body.metric === "arrivals" ? "arrivals" : "presences";
  const locale = body.locale === "it" ? "it" : "en";
  const from = typeof body.from === "string" ? body.from : null;
  const to   = typeof body.to   === "string" ? body.to   : null;

  // Call the RPC with the user's JWT so RLS / admin guard applies.
  const { data: rows, error: rpcErr } = await userClient.rpc(
    "compute_tourism_correlations",
    { p_from: from, p_to: to, p_lag_months: lagMonths, p_metric: metric, p_min_periods: 6 },
  );
  if (rpcErr) {
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  const correlations = Array.isArray(rows) ? rows : [];

  if (correlations.length === 0) {
    const empty = locale === "it"
      ? "Nessuna correlazione calcolabile: servono almeno 6 mesi di sovrapposizione tra attivazioni e dati turistici per provincia."
      : "No correlation could be computed: at least 6 months of overlap between activations and tourism data per province are required.";
    return new Response(JSON.stringify({ narrative: empty, correlations }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // Compact payload for the LLM — drop the per-month series to save tokens;
  // top stats and totals are enough for narration.
  const compact = correlations.slice(0, 7).map((c: any) => ({
    province: c.province,
    n_periods: c.n_periods,
    pearson: c.pearson,
    spearman: c.spearman,
    strength: describeCorr(Number(c.pearson ?? 0)),
    sign: Number(c.pearson ?? 0) >= 0 ? "positive" : "negative",
    total_activations: c.total_activations,
    total_tourism: c.total_tourism,
  }));

  const system =
    `You are a data analyst writing one short paragraph (max 120 words) ` +
    `for the AION insurance admin dashboard. You are given per-province ` +
    `Pearson and Spearman correlations between monthly insurance cover ` +
    `activations and monthly Veneto tourism (${metric}). Lag is ${lagMonths} ` +
    `months (positive = tourism leads activations).\n\n` +
    `Rules:\n` +
    `- Be specific: name the top 2-3 provinces, cite the coefficient.\n` +
    `- Calibrate language to coefficient strength (negligible/weak/moderate/strong).\n` +
    `- If N < 12 for any cited province, add a brief caveat about sample size.\n` +
    `- Do NOT claim causation. Correlation can come from confounders ` +
    `(seasonality, shop density, marketing).\n` +
    `- ${locale === "it" ? "Reply in Italian." : "Reply in English."}\n` +
    `- No bullet points, no headings, plain prose.`;

  const userPrompt = JSON.stringify(compact);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const completion = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 350,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = completion.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  return new Response(JSON.stringify({
    narrative: text,
    correlations,
    meta: { lagMonths, metric, locale, n: correlations.length },
  }), { headers: { "Content-Type": "application/json", ...CORS } });
});
