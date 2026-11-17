// The weekly luxury-CX digest's way out: a claude.ai cloud routine researches the week's
// news, writes the email, and POSTs it here; this sends it from automations@aioncover.com
// through the same Resend account the platform already uses.
//
// The routine runs outside anything we host, so its credential is a shared secret
// (DIGEST_MAIL_SECRET) carried in its configuration. Everything here assumes that secret can
// leak, and limits what a leak buys:
//   - recipients are fixed in this file, never taken from the request
//   - one real digest per 20 hours, a handful of test sends per day
//   - a size cap on what goes into the body
// so the worst a stolen secret can do is send Giulio one odd email a day.
//
//   POST { action: "collector" }                        → the news-collector script the routine runs
//   POST { action: "previous" }                         → the last digests' subjects + URLs
//   POST { action: "send", subject, html, text?, test? } → sends to Giulio, cc Luca; test goes to Luca only
//
// Every send is kept in public.market_digests — that is how next week's run knows which
// articles it already covered.

import { Resend } from "npm:resend@4";
import { createClient } from "npm:@supabase/supabase-js@2";
import { COLLECTOR_PY } from "./collector.ts";

const SECRET = Deno.env.get("DIGEST_MAIL_SECRET") ?? "";
const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const FROM = "AION Automations <automations@aioncover.com>";
const REPLY_TO = "team@aioncover.com";
const RECIPIENTS = ["giulio@aioncover.com"];
const CC = ["luca@aioncover.com"];
const TEST_RECIPIENTS = ["luca@aioncover.com"];

const REAL_GAP_HOURS = 20;
const TESTS_PER_DAY = 10;
const MAX_HTML = 300_000;
const MAX_SUBJECT = 200;
const MIN_REAL_URLS = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// The article links, so "previous" can hand them back without re-parsing old HTML.
export function linksIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1].replace(/&amp;/g, "&").trim();
    if (/^https?:\/\//i.test(u)) out.add(u);
  }
  return [...out];
}

function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ( $1 )")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sentSince(hours: number, isTest: boolean): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { count, error } = await db
    .from("market_digests")
    .select("id", { count: "exact", head: true })
    .eq("is_test", isTest)
    .gte("sent_at", since);
  if (error) throw new Error(`market_digests count: ${error.message}`);
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // An unset secret must not turn into "every caller matches the empty string".
  if (!SECRET || !safeEqual(req.headers.get("x-digest-secret") ?? "", SECRET)) {
    return json({ error: "unauthorised" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  try {
    if (body.action === "collector") {
      return json({ script: COLLECTOR_PY });
    }

    if (body.action === "previous") {
      const { data, error } = await db
        .from("market_digests")
        .select("sent_at, subject, urls")
        .eq("is_test", false)
        .order("sent_at", { ascending: false })
        .limit(4);
      if (error) throw new Error(error.message);
      return json({ digests: data ?? [] });
    }

    if (body.action !== "send") return json({ error: 'action must be "collector", "previous" or "send"' }, 400);

    const isTest = body.test === true;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const html = typeof body.html === "string" ? body.html : "";
    if (!subject || subject.length > MAX_SUBJECT) return json({ error: `subject required, at most ${MAX_SUBJECT} characters` }, 400);
    if (!html || html.length > MAX_HTML) return json({ error: `html required, at most ${MAX_HTML} characters` }, 400);
    const text = typeof body.text === "string" && body.text.trim() ? body.text : htmlToText(html);

    const urls = linksIn(html);
    if (isTest) {
      if (await sentSince(24, true) >= TESTS_PER_DAY) return json({ error: `test limit: ${TESTS_PER_DAY} per 24 hours` }, 429);
    } else {
      // A run that could not verify anything (a blocked network, a dead week) must not reach
      // Giulio as an empty digest. The routine is told to fall back to a test send instead.
      if (urls.length < MIN_REAL_URLS) {
        return json({ error: `only ${urls.length} article links; a real digest needs at least ${MIN_REAL_URLS}. Send it with "test": true instead.` }, 422);
      }
      if (await sentSince(REAL_GAP_HOURS, false) > 0) {
        return json({ error: `a digest already went out in the last ${REAL_GAP_HOURS} hours; not sending another` }, 409);
      }
    }

    const to = isTest ? TEST_RECIPIENTS : RECIPIENTS;
    const cc = isTest ? [] : CC;
    const finalSubject = isTest ? `[TEST] ${subject}` : subject;
    const { data, error } = await resend.emails.send({
      from: FROM, to, ...(cc.length ? { cc } : {}), replyTo: REPLY_TO, subject: finalSubject, html, text,
    });
    if (error) return json({ error: `resend: ${error.message}` }, 502);

    const { error: insErr } = await db.from("market_digests").insert({
      subject: finalSubject, recipients: [...to, ...cc], urls, html, is_test: isTest, resend_id: data?.id ?? null,
    });
    // The mail is out either way; say so rather than inviting a retry that would send twice.
    return json({ sent: true, to, cc, resend_id: data?.id ?? null, urls: urls.length, stored: !insErr, store_error: insErr?.message });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
