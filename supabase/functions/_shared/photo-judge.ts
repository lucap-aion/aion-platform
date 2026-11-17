// What a picture shows, from one look at it.
//
// The deck's photograph finder chose by URL words and pixel count, and Giulio's verdict on
// the result was that the generated deck "does not select relevant images": the boutique slot
// on Shaft's deck was a campaign graphic with a headline across it, the largest picture on
// the store-locator page; Prada's lifestyle tiles were two thumbnails from the site's menu.
// Nothing about a URL says "this has a headline printed on it". One look does, and the answer
// is three fields the finder can sort and filter on (brand-photos.ts, judged()).

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import type { PhotoKind, PhotoVerdict } from "./brand-photos.ts";

const MAX_BYTES = 4_500_000; // the API takes 5 MB per image
const KINDS: PhotoKind[] = ["store", "portrait", "worn", "packshot", "graphic", "other"];

type ImageSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: string; data: string };

/**
 * By URL: the API fetches the picture itself, so the function holds no image and does no
 * encoding. Fifteen downloads and their base64 copies beside the 18MB teaser were what ran
 * brand-deck out of compute (WORKER_RESOURCE_LIMIT) — the URL form costs it nothing.
 * A site whose bot wall turns the API's fetcher away answers with an error; the caller then
 * tries `judgePhotoBytes` with a download of its own.
 */
export function judgePhotoUrl(url: string, opts: JudgeOpts): Promise<PhotoVerdict | null> {
  if (!opts.apiKey || !/^https?:\/\//i.test(url)) return Promise.resolve(null);
  return ask({ type: "url", url: url.replace(/^http:\/\//i, "https://") }, opts);
}

/** Null when there is no key, the picture is one the API will not take, or the answer is not one. */
export function judgePhotoBytes(bytes: Uint8Array, mediaType: string, opts: JudgeOpts): Promise<PhotoVerdict | null> {
  if (!opts.apiKey || !bytes.length || bytes.length > MAX_BYTES) return Promise.resolve(null);
  const type = mediaType.split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return Promise.resolve(null);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return ask({ type: "base64", media_type: type, data: btoa(binary) }, opts);
}

type JudgeOpts = { apiKey: string; model: string; timeoutMs?: number };

async function ask(source: ImageSource, opts: JudgeOpts): Promise<PhotoVerdict | null> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const out = await anthropic.messages.create({
    model: opts.model,
    max_tokens: 80,
    system: "You sort a luxury house's website pictures for a sales deck. You answer with JSON and nothing else.",
    messages: [{
      role: "user",
      content: [
        // The URL source postdates this SDK's types; the API takes it as written.
        { type: "image", source: source as never },
        {
          type: "text",
          text:
            "Classify this picture. kind is exactly one of:\n" +
            '- "store": a boutique — its interior, its shop window or its facade\n' +
            '- "portrait": a person is the subject — a campaign portrait, an ambassador, a model\n' +
            '- "worn": the product being worn, held or used — hands, wrist, neck, a bag on an arm, a detail shot on a person\n' +
            '- "packshot": a product alone on a plain or studio background\n' +
            '- "graphic": a banner, a collage, an illustration, a map, a screenshot, a menu tile\n' +
            '- "other": anything else (landscape, building, food, texture, event crowd)\n' +
            "text is true when typeset words are laid over the picture (a headline, a slogan, a price, a button, a " +
            "logo stamped on top). A shop sign photographed on a building, or a brand name engraved on the product, " +
            "is NOT text.\n" +
            "quality is 1-5: how well it would read as a full editorial photograph on a luxury slide " +
            "(5 = sharp, well lit, magazine standard; 1 = blurry, cluttered or amateur).\n" +
            'Answer only {"kind": "...", "text": true|false, "quality": n}.',
        },
      ],
    }],
  }, { timeout: opts.timeoutMs ?? 25_000 });

  const raw = out.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const m = /\{[^}]*\}/.exec(raw);
  if (!m) return null;
  let parsed: { kind?: unknown; text?: unknown; quality?: unknown };
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  const kind = String(parsed.kind ?? "").toLowerCase() as PhotoKind;
  if (!KINDS.includes(kind)) return null;
  const quality = typeof parsed.quality === "number" && Number.isFinite(parsed.quality) ? parsed.quality : 3;
  return { kind, text: parsed.text === true, quality };
}
