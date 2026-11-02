// watch-demo: the public side of a per-recipient demo-film link.
//
// /watch/<token> in the app calls this twice: "open" when the page loads, which checks the
// token, signs a short-lived URL for the brand's film and records that the link was opened;
// then "progress" as the film plays, which moves the furthest-second mark on that opening.
// Nobody is signed in on that page, so the function is deployed without JWT verification
// and the token itself is the credential: an unknown or revoked token gets nothing.
//
// Body: { action: "open", token }
//       { action: "progress", token, view_id, position_s, duration_s?, completed? }
// Progress may arrive as text/plain (navigator.sendBeacon on page hide), hence req.text().

import { createClient } from "npm:@supabase/supabase-js@2";
import { originAllowed, originRefused } from "../_shared/origin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "decks";
// Long enough to watch a two-minute film with a bad connection, short enough that the
// signed URL is not itself a shareable copy of the link.
const SIGNED_URL_SECONDS = 60 * 60 * 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return originRefused();
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await req.text()); } catch { return json({ error: "invalid body" }, 400); }
  const token = String(body.token ?? "").trim();
  if (!/^[a-f0-9]{12,64}$/i.test(token)) return json({ error: "unknown link" }, 404);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: link } = await admin.from("demo_video_links")
    .select("id, brand_id, recipient_name, revoked_at")
    .eq("token", token).maybeSingle();
  if (!link || link.revoked_at) return json({ error: "unknown link" }, 404);

  try {
    if (body.action === "progress") return json(await progress(admin, link.id as string, body));
    return json(await open(admin, req, link as { id: string; brand_id: number; recipient_name: string }));
  } catch (e) {
    console.error("[watch-demo]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function open(admin: ReturnType<typeof createClient>, req: Request, link: { id: string; brand_id: number; recipient_name: string }) {
  const [{ data: brand }, { data: film }] = await Promise.all([
    admin.from("brands").select("name, slug, logo_big, logo_small").eq("id", link.brand_id).maybeSingle(),
    admin.from("brand_deck_outputs").select("storage_path, generated_at")
      .eq("brand_id", link.brand_id).eq("template_key", "demo_video")
      .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!brand) return { error: "unknown link" };
  if (!film?.storage_path) return { error: "no film", brand: { name: brand.name } };

  const { data: signed, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(film.storage_path as string, SIGNED_URL_SECONDS);
  if (error || !signed?.signedUrl) throw new Error(error?.message ?? "could not sign the film");

  // Who opened it, as far as a request can say. The IP is the first hop of
  // x-forwarded-for; the country header is there when the edge sets it and null when not.
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const country = req.headers.get("cf-ipcountry") ?? req.headers.get("x-country") ?? req.headers.get("x-vercel-ip-country") ?? null;
  const { data: view } = await admin.from("demo_video_views").insert({
    link_id: link.id,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
    ip, country,
    referrer: (req.headers.get("referer") ?? "").slice(0, 500) || null,
  }).select("id").single();

  return {
    ok: true,
    view_id: view?.id ?? null,
    video_url: signed.signedUrl,
    recorded_at: film.generated_at,
    recipient_name: link.recipient_name,
    brand: { name: brand.name, slug: brand.slug, logo: brand.logo_big ?? brand.logo_small ?? null },
  };
}

async function progress(admin: ReturnType<typeof createClient>, linkId: string, body: Record<string, unknown>) {
  const viewId = String(body.view_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(viewId)) return { ok: false };
  const position = Math.max(0, Number(body.position_s) || 0);
  const duration = Number(body.duration_s) > 0 ? Number(body.duration_s) : null;
  const { data: cur } = await admin.from("demo_video_views").select("max_position_s, completed")
    .eq("id", viewId).eq("link_id", linkId).maybeSingle();
  if (!cur) return { ok: false };
  const maxPos = Math.max(Number(cur.max_position_s) || 0, position);
  // Ninety-five per cent counts as watched: the last seconds are the cream ending card,
  // and a player that stops on the final frame reports a position just short of the end.
  const completed = Boolean(cur.completed) || body.completed === true || (duration !== null && maxPos >= duration * 0.95);
  await admin.from("demo_video_views").update({
    last_seen_at: new Date().toISOString(),
    max_position_s: maxPos,
    ...(duration !== null ? { duration_s: duration } : {}),
    completed,
  }).eq("id", viewId);
  return { ok: true, max_position_s: maxPos, completed };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
