import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
// The shipped module — auth-email-hook imports this exact file.
import { verifyWebhookSignature, safeRedirect } from "../../supabase/functions/_shared/auth-hook";

const SECRET_B64 = Buffer.from("a-test-signing-key-32-bytes-long").toString("base64");
const SECRET = `v1,whsec_${SECRET_B64}`;
const SUPABASE_URL = "https://tlmdlskiubfdhywmzgzb.supabase.co";

// Sign the way Supabase does, from the exact bytes.
function sign(id: string, ts: string, body: string, secret = SECRET_B64): string {
  const mac = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${mac}`;
}

const NOW = 1789132169000;
const TS = String(Math.floor(NOW / 1000));
const BODY = JSON.stringify({ user: { email: "someone@example.com" }, email_data: { email_action_type: "recovery" } });

describe("proving an auth webhook came from Supabase", () => {
  it("accepts a correctly signed call", async () => {
    const ok = await verifyWebhookSignature({
      body: BODY, id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, BODY), secret: SECRET, nowMs: NOW,
    });
    expect(ok).toBe(true);
  });

  it("refuses a body that changed by one byte after signing", async () => {
    // The exact failure this is here to catch: a trailing newline is part of the
    // bytes, and signing a trimmed copy produces a signature that silently fails.
    const signature = sign("msg_1", TS, BODY);
    const ok = await verifyWebhookSignature({
      body: BODY + "\n", id: "msg_1", timestamp: TS, signature, secret: SECRET, nowMs: NOW,
    });
    expect(ok).toBe(false);
  });

  it("refuses a signature made with someone else's key", async () => {
    const other = Buffer.from("a-different-key-of-32-bytes-long").toString("base64");
    const ok = await verifyWebhookSignature({
      body: BODY, id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, BODY, other), secret: SECRET, nowMs: NOW,
    });
    expect(ok).toBe(false);
  });

  it("refuses a captured call replayed later", async () => {
    const signature = sign("msg_1", TS, BODY);
    const anHourOn = NOW + 60 * 60 * 1000;
    expect(await verifyWebhookSignature({
      body: BODY, id: "msg_1", timestamp: TS, signature, secret: SECRET, nowMs: anHourOn,
    })).toBe(false);
  });

  it("refuses when the headers are missing, and when we hold no secret", async () => {
    const signature = sign("msg_1", TS, BODY);
    expect(await verifyWebhookSignature({ body: BODY, id: null, timestamp: TS, signature, secret: SECRET, nowMs: NOW })).toBe(false);
    expect(await verifyWebhookSignature({ body: BODY, id: "msg_1", timestamp: null, signature, secret: SECRET, nowMs: NOW })).toBe(false);
    expect(await verifyWebhookSignature({ body: BODY, id: "msg_1", timestamp: TS, signature: null, secret: SECRET, nowMs: NOW })).toBe(false);
    // Fails closed: no secret configured must never mean "trust the caller".
    expect(await verifyWebhookSignature({ body: BODY, id: "msg_1", timestamp: TS, signature, secret: "", nowMs: NOW })).toBe(false);
  });

  it("takes the signature whichever position it holds in the header", async () => {
    const good = sign("msg_1", TS, BODY);
    const ok = await verifyWebhookSignature({
      body: BODY, id: "msg_1", timestamp: TS, signature: `v1,AAAA ${good}`, secret: SECRET, nowMs: NOW,
    });
    expect(ok).toBe(true);
  });
});

describe("where a verification link may point", () => {
  it("keeps our own hosts", () => {
    for (const url of ["https://app.aioncover.com/rc/login", "https://dev.app.aioncover.com/x", `${SUPABASE_URL}/auth/v1/callback`]) {
      expect(safeRedirect(url, SUPABASE_URL)).toBe(url);
    }
  });

  it("sends an unknown destination back to us instead", () => {
    // An AION-branded email landing on someone else's site is a phishing mail
    // we sent ourselves.
    expect(safeRedirect("https://evil.example.com/harvest", SUPABASE_URL)).toBe(SUPABASE_URL);
    expect(safeRedirect("https://aioncover.com.evil.example.com/x", SUPABASE_URL)).toBe(SUPABASE_URL);
    expect(safeRedirect("http://app.aioncover.com/x", SUPABASE_URL)).toBe(SUPABASE_URL);
    expect(safeRedirect("not-a-url", SUPABASE_URL)).toBe(SUPABASE_URL);
  });

  it("allows localhost only off production", () => {
    expect(safeRedirect("http://localhost:5173/x", SUPABASE_URL, true)).toBe("http://localhost:5173/x");
    expect(safeRedirect("http://localhost:5173/x", SUPABASE_URL, false)).toBe(SUPABASE_URL);
  });
});
