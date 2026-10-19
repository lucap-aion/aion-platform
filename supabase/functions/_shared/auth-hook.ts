// Verifying that an auth webhook really came from Supabase.
//
// Pulled out of auth-email-hook so it can be tested: this is HMAC over an exact
// byte string, and the failure mode is silent. Signing `${id}.${ts}.${body}`
// where `body` has been re-serialised, or trimmed of a trailing newline, gives a
// signature that is wrong in a way nothing reports — the call is simply refused,
// which for an auth hook means password-reset mail quietly stops arriving.

/** Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64. */
export async function verifyWebhookSignature(input: {
  /** The EXACT bytes of the request body, as text. Never a re-serialised object. */
  body: string;
  id: string | null;
  timestamp: string | null;
  /** The webhook-signature header: one or more space-separated "v1,<base64>". */
  signature: string | null;
  /** "v1,whsec_<base64>", "whsec_<base64>" or the bare base64. */
  secret: string;
  nowMs?: number;
  /** Replay window either side, in seconds. */
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { body, id, timestamp, signature, secret } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  const now = (input.nowMs ?? Date.now()) / 1000;
  const tolerance = input.toleranceSeconds ?? 300;
  const skew = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(skew) || skew > tolerance) return false;

  const raw = secret.replace(/^v1,\s*/, "").replace(/^whsec_/, "");
  let expected: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    );
    expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  } catch {
    return false;
  }

  return signature.split(" ").some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    return sameSignature(value, expected);
  });
}

/** Compare without letting the time taken say how much of a forgery was right. */
export function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Where a verification link may send someone.
 *
 * Supabase passes redirect_to through from whatever triggered the mail, so even
 * a genuinely signed call can carry a foreign destination. An "AION Cover"
 * email that lands on someone else's site is a phishing mail we sent ourselves,
 * so anything we don't recognise falls back to the project's own origin rather
 * than failing the email.
 */
export function safeRedirect(candidate: string, supabaseUrl: string, allowLocalhost = false): string {
  try {
    const u = new URL(candidate);
    const ours = u.protocol === "https:" && /(^|\.)aioncover\.com$/.test(u.hostname);
    const self = u.origin === new URL(supabaseUrl).origin;
    const local = allowLocalhost && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    return ours || self || local ? candidate : supabaseUrl;
  } catch {
    return supabaseUrl;
  }
}
