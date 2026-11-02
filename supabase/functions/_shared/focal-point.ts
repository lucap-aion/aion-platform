// Where the subject of a photograph is.
//
// A frame that is not the picture's shape has to crop it, and a crop taken from the centre
// cuts whatever is not in the centre: the couple with their trolleys on the right of My Style
// Bags' airport photograph lost the trolleys behind the sign-in form, and the deck's slides
// centre-cropped a third off the long edge of pictures nobody had looked at. No rule about
// shapes knows where the subject is. One look by the model does, and the answer is two
// numbers that every crop can be taken around.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

/** Fractions of the picture's width and height, from the top-left corner. */
export type Focus = { x: number; y: number };

const MAX_BYTES = 4_500_000; // the API takes 5 MB per image

/**
 * The centre of what a crop must keep, or null — no key, a picture the API will not take,
 * an answer that is not a point. The caller keeps its centre crop on null, which is what it
 * always did. `frame` says what the picture is for, so the model keeps the right thing.
 */
export async function findFocalPoint(
  bytes: Uint8Array,
  mediaType: string,
  opts: { apiKey: string; model: string; frame?: string; timeoutMs?: number },
): Promise<Focus | null> {
  if (!opts.apiKey || !bytes.length || bytes.length > MAX_BYTES) return null;
  const type = mediaType.split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const out = await anthropic.messages.create({
    model: opts.model,
    max_tokens: 60,
    system: "You locate the subject of a photograph. You answer with JSON and nothing else.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: type as "image/jpeg", data: btoa(binary) } },
        {
          type: "text",
          text: `This photograph will be shown ${opts.frame ?? "in a frame of a different shape"}, cropped to fit. ` +
            "Find the subject the crop must keep: the product (bag, jewel, watch, shoes, eyewear, piece of clothing) " +
            "if one is shown, otherwise the person's face. Answer only with JSON " +
            '{"x": <percent from the left edge>, "y": <percent from the top edge>} for the centre of that subject.',
        },
      ],
    }],
  }, { timeout: opts.timeoutMs ?? 25_000 });
  const text = out.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const m = /\{[^}]*\}/.exec(text);
  if (!m) return null;
  const parsed = JSON.parse(m[0]) as { x?: unknown; y?: unknown };
  const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : null);
  const x = pct(parsed.x), y = pct(parsed.y);
  return x == null || y == null ? null : { x, y };
}

/** A focus as CSS object-position, "62% 55%". */
export function focusAsPosition(f: Focus): string {
  return `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%`;
}
