// Who is allowed to call these functions from a browser.
//
// Every function here answers `Access-Control-Allow-Origin: *`, which means any
// site on the internet can script a call to them and read what comes back. The
// bearer token still has to be valid, so this is not an open door — but it
// leaves the browser as the only thing deciding who may talk to us, and "*"
// tells the browser not to decide at all.
//
// This checks the Origin header server-side instead, which is the stronger
// half: a refused request never reaches the handler, whatever the browser
// thinks. The CORS headers are left as they are — they matter only to callers
// this function has already agreed to answer.
//
// No Origin header means it is not a browser: pg_cron, another edge function,
// a server, curl. Those are authorised by their bearer token or batch secret,
// so they pass through here untouched.
//
// Any https host under aioncover.com is ours — app, dev.app, chat, rc, and
// whatever subdomain comes next — so this needs no list to maintain. localhost
// stays allowed because that is where the app is developed against these very
// functions; the token still decides what the caller can actually do.

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin") ?? req.headers.get("origin");
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && /(^|\.)aioncover\.com$/.test(u.hostname)) return true;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** The refusal, shaped like the other errors these functions return. */
export function originRefused(): Response {
  return new Response(JSON.stringify({ error: "origin not allowed" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
