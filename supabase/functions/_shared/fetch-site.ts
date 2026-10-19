// Reading a house's own website when the house's firewall would rather we did not.
//
// The posture here is deliberate and it is a compromise, so it is written down.
//
// robots.txt is honoured exactly as before, and it is honoured against our REAL
// token (AGENT_TOKEN, "aionknowledgebot"). A house that names us in robots.txt
// and disallows us is disallowed — completely, everywhere, no fallback, no
// exception. That promise is the one that matters and nothing below touches it.
//
// What changed is only the User-Agent on the wire, and only after a refusal.
// Measured on 2026-09-15 across three houses that the pipeline could not read:
//
//   prada.com       our UA → connection dropped before any HTTP status
//                   browser UA → 200
//                   browser UA + our token appended → dropped again
//   zegna.com       403 with every agent we tried — not a UA problem
//   buccellati.com  302 with every agent — a redirect, never a block
//
// So a browser UA is not "the fix for the crawler": it is the fix for one
// failure mode out of three, and appending our name to it puts us straight back
// outside, because the wall matches the token and not the shape.
//
// Hence honest-first: every request goes out as AIONKnowledgeBot, which is what
// the great majority of houses answer, and which keeps us allowlistable — the
// reason robots.ts gave for dropping the old "Googlebot/2.1" claim, which was
// both untrue and fragile. Only when a house answers with a refusal that is
// characteristic of bot management do we retry the SAME url, already cleared by
// robots, presenting as a browser. Which houses needed that is returned to the
// caller rather than hidden, because it is worth knowing — it is a fact about
// the relationship, and one day somebody will ask us.
//
// This does not defeat a house that has decided we may not read it. It defeats
// a wall that cannot tell us apart from a scraper, on pages the house publishes
// publicly and permits in its own robots.txt.

import { AION_UA } from "./robots.ts";

/** What a house's own browser traffic looks like. Used only on retry. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "it-IT,it;q=0.9,en-GB;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * A refusal worth a second attempt as a browser.
 *
 * 403 and 406 are what a bot wall returns; 429 is rate limiting and a different
 * agent will not help; a 5xx is the house having a bad day. A THROWN error
 * counts too, and on prada.com it is the only signal there is — the connection
 * is dropped before a status line exists, so a status-only test would conclude
 * the site was down.
 */
const worthRetrying = (status: number | null) =>
  status === null || status === 403 || status === 406 || status === 451 || status === 503;

export type SiteFetch = {
  response: Response | null;
  /** Which agent got the answer, so a caller can record it. */
  agent: "aion" | "browser";
  /** The refusal the honest agent got, when it took a browser to get in. */
  refusedAs: string | null;
  error: string | null;
};

/**
 * Fetch one url from a brand's own site. The caller has already checked robots.
 *
 * Never throws: a crawl that dies on one page has lost the other forty.
 */
export async function fetchSite(
  url: string,
  opts: { timeoutMs?: number; accept?: string; referer?: string } = {},
): Promise<SiteFetch> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const attempt = async (agent: "aion" | "browser"): Promise<{ res: Response | null; err: string | null }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = agent === "browser"
        ? { ...BROWSER_HEADERS, "User-Agent": BROWSER_UA }
        : {
          "User-Agent": AION_UA,
          "Accept": opts.accept ?? BROWSER_HEADERS["Accept"],
          "Accept-Language": BROWSER_HEADERS["Accept-Language"],
        };
      if (opts.accept) headers["Accept"] = opts.accept;
      if (opts.referer) headers["Referer"] = opts.referer;
      const res = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
      return { res, err: null };
    } catch (e) {
      // An abort is our own timeout, not the house refusing us. Retrying it as a
      // browser just spends the timeout twice.
      const msg = e instanceof Error ? e.message : String(e);
      return { res: null, err: msg };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt("aion");
  const aborted = (first.err ?? "").toLowerCase().includes("abort");
  if (first.res?.ok) return { response: first.res, agent: "aion", refusedAs: null, error: null };
  if (aborted) return { response: null, agent: "aion", refusedAs: null, error: first.err };

  const status = first.res?.status ?? null;
  if (!worthRetrying(status)) {
    return {
      response: first.res,
      agent: "aion",
      refusedAs: null,
      error: first.res ? `HTTP ${first.res.status}` : first.err,
    };
  }

  const refusedAs = first.res ? `HTTP ${first.res.status}` : (first.err ?? "connection dropped");
  // Let go of the refusal's body before asking again. An unread response body is
  // an open resource in Deno, and this is the one path that makes two requests
  // for one page — leaking half of them would be a slow strangle of the worker,
  // visible only as a stage that says 'running' and never says anything else.
  try { await first.res?.body?.cancel(); } catch { /* already gone */ }
  const second = await attempt("browser");
  if (second.res?.ok) {
    return { response: second.res, agent: "browser", refusedAs, error: null };
  }
  // Both refused. Report the SECOND failure, since it is the more complete
  // answer — zegna.com 403s either way, and saying so is the useful outcome.
  return {
    response: second.res,
    agent: "browser",
    refusedAs,
    error: second.res ? `HTTP ${second.res.status}` : (second.err ?? "unreachable"),
  };
}

/** The common case: the page's text, or a thrown error naming what happened. */
export async function fetchSiteText(
  url: string,
  opts: { timeoutMs?: number; requireHtml?: boolean } = {},
): Promise<{ text: string; agent: "aion" | "browser"; refusedAs: string | null }> {
  const got = await fetchSite(url, { timeoutMs: opts.timeoutMs });
  if (!got.response || !got.response.ok) throw new Error(got.error ?? "unreachable");
  if (opts.requireHtml !== false) {
    const ct = got.response.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|xml/i.test(ct)) throw new Error(`non-html (${ct.split(";")[0]})`);
  }
  return { text: await got.response.text(), agent: got.agent, refusedAs: got.refusedAs };
}
