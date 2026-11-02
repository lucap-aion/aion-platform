// A house's logo, cut into what the portal needs: the NAME for the open sidebar, the sign-in
// form and the decks, and the CREST for the collapsed sidebar.
//
// What a house publishes is often a lockup. brunellocucinelli.com's header logo is a crest over
// "SOLOMEI · AD MCCCXCI" over the name; Eberhard's is a shield over the name over a script
// tagline; Damiani, Messika and Oris put a line ("HANDMADE IN ITALY SINCE 1924", "PARIS",
// "HÖLSTEIN 1904") under the name. Stored whole, the open sidebar shrinks it to forty pixels and
// the name becomes a grey line under a smudge. Each of those was cut by hand on 2026-10-24, the
// same way every time: find the horizontal bands of ink, keep the name's band, and take a
// squarish band above it as the crest. This is that, done when the logo is copied in.
//
// A band is a run of rows with ink, separated from the next by blank rows. The NAME is the
// tallest of the bands that are nearly as wide as the widest — a wordmark spans the logo; a
// motto under a crest does not. It must be clearly the tallest (a two-line name, two bands of
// equal height, is not cut). The CREST is the tallest roughly square band above the name.
// A one-band logo — every one-line wordmark, Roberto Coin's included — is never touched.

import { decodePng, pngIsLight } from "./image-bytes.ts";

export type Band = { top: number; bottom: number; left: number; right: number };
export type LogoSplit = { name: Band; crest?: Band; bands: Band[] };

/** Choose the name (and crest) among the bands, or null when the logo should stay whole. */
export function chooseBands(bands: Band[], logoHeight: number): LogoSplit | null {
  if (bands.length < 2) return null;
  const width = (b: Band) => b.right - b.left;
  const height = (b: Band) => b.bottom - b.top;
  const widest = Math.max(...bands.map(width));
  const wide = bands.filter((b) => width(b) >= widest * 0.6);
  const name = wide.reduce((a, b) => (height(b) > height(a) ? b : a));
  // Clearly the name: taller than every other wide band by half again. Two equal lines are a
  // two-line name, and cutting one of them off is worse than leaving the logo whole.
  if (wide.some((b) => b !== name && height(b) * 1.5 > height(name))) return null;
  // Too thin to be a name on its own (a rule, an underline drawn as its own band).
  if (height(name) < logoHeight * 0.08) return null;
  // The lines UNDER the name that are at least half its height are the rest of the name:
  // MY STYLE over BAGS is one name on two lines of different widths, and cutting it to the
  // first line renames the house. A motto is small — HANDMADE IN ITALY SINCE 1924 under
  // Damiani, MILANO under BAGS — a third of the name's height, and is still dropped.
  const below = bands.filter((b) => b.top >= name.bottom).sort((a, b) => a.top - b.top);
  let whole: Band = { ...name };
  for (const b of below) {
    if (height(b) < height(name) * 0.5) break;
    whole = { top: whole.top, bottom: b.bottom, left: Math.min(whole.left, b.left), right: Math.max(whole.right, b.right) };
  }
  const crest = bands
    .filter((b) => b.bottom <= name.top && width(b) / Math.max(1, height(b)) <= 2 && width(b) / Math.max(1, height(b)) >= 0.5)
    .sort((a, b) => height(b) - height(a))[0];
  // Nothing to cut: the name is every band there is.
  if (!crest && whole.top <= Math.min(...bands.map((b) => b.top)) && whole.bottom >= Math.max(...bands.map((b) => b.bottom))) return null;
  return { name: whole, crest, bands };
}

/** Merge per-row ink extents into bands, closing gaps shorter than `minGap` rows. */
export function bandsFromRows(rows: ({ left: number; right: number } | null)[], minGap: number): Band[] {
  const bands: Band[] = [];
  let cur: Band | null = null;
  let gap = 0;
  rows.forEach((r, y) => {
    if (r) {
      if (cur && gap <= minGap) {
        cur.bottom = y + 1; cur.left = Math.min(cur.left, r.left); cur.right = Math.max(cur.right, r.right);
      } else {
        if (cur) bands.push(cur);
        cur = { top: y, bottom: y + 1, left: r.left, right: r.right };
      }
      gap = 0;
    } else gap++;
  });
  if (cur) bands.push(cur);
  return bands;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

/** Split a PNG lockup. Returns new PNG bytes for the name (and crest), or null to keep it whole. */
export async function splitPngLogo(bytes: Uint8Array): Promise<{ name: Uint8Array; crest?: Uint8Array } | null> {
  const px = await decodePng(bytes).catch(() => null);
  if (!px) return null;
  const { width, height, rgba } = px;
  // Ink: opaque pixels on a transparent logo; on an opaque one, pixels that differ from the
  // corner, which is the background.
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4 * 7) if (rgba[i] < 32) transparent++;
  const opaque = transparent < (rgba.length / (4 * 7)) * 0.05;
  const bg = [rgba[0], rgba[1], rgba[2]];
  const ink = (i: number) => opaque
    ? Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > 60
    : rgba[i + 3] >= 64;
  const rows = Array.from({ length: height }, (_, y) => {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (ink((y * width + x) * 4)) { if (left < 0) left = x; right = x + 1; }
    }
    return left < 0 ? null : { left, right };
  });
  const split = chooseBands(bandsFromRows(rows, Math.max(1, Math.round(height * 0.015))), height);
  if (!split) return null;
  const crop = async (b: Band, square: boolean) => {
    const pad = Math.max(2, Math.round((b.bottom - b.top) * 0.06));
    let x0 = Math.max(0, b.left - pad), x1 = Math.min(width, b.right + pad);
    let y0 = Math.max(0, b.top - pad), y1 = Math.min(height, b.bottom + pad);
    let w = x1 - x0, h = y1 - y0;
    let ox = 0, oy = 0;
    if (square) { const s = Math.max(w, h); ox = (s - w) >> 1; oy = (s - h) >> 1; w = h = s; }
    const out = new Uint8Array(w * h * 4); // transparent where the square pads it out
    for (let y = y0; y < y1; y++) {
      out.set(rgba.subarray((y * width + x0) * 4, (y * width + x1) * 4), ((y - y0 + oy) * w + ox) * 4);
    }
    return await encodePng(w, h, out);
  };
  return { name: await crop(split.name, false), crest: split.crest ? await crop(split.crest, true) : undefined };
}

/** RGBA → PNG (8-bit, filter 0). Small and dependency-free; the platform's zlib does the work. */
export async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const idat = new Uint8Array(await new Response(
    new Response(raw).body!.pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => { out.set(p, at); return at + p.length; }, 0);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── SVG ──────────────────────────────────────────────────────────────────────
//
// An SVG is cut without rendering it: every shape's bounding box is worked out from its own
// geometry (path data, rect, circle, polygon…) through the transforms of the groups it sits
// in, and the cut is a new viewBox — so the result is still vector. Control points count
// toward a path's box, which can only make a band a little taller, never split one.

type M = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export function parseTransform(t: string | undefined): M {
  let m: M = IDENTITY;
  for (const [, fn, args] of (t ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = IDENTITY;
    if (fn === "translate") n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "matrix" && a.length === 6) n = a as M;
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180, cx = a[1] ?? 0, cy = a[2] ?? 0;
      n = mul(mul([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
    m = mul(m, n);
  }
  return m;
}

/**
 * Points ON a path, absolute, one list per subpath: every endpoint, and each curve sampled
 * along its length.
 *
 * Not its control points. A script tagline (Eberhard's "Manufacture Suisse d'Horlogerie") pulls
 * its curves toward control points far outside the letters, and boxes built from those grew
 * into the name above and merged the two bands. Sampling stays on the ink.
 *
 * Per subpath, because one <path> can draw a whole lockup: brunellocucinelli.com's header logo
 * puts crest and name in the same path, so a single box for it spans both and nothing can be
 * told apart. Each "M" starts a shape of its own.
 *
 * Read character by character, because arc flags are single digits that need no separator:
 * "a5.08 5.08 0 01-.531-.05" is rx 5.08, ry 5.08, rotation 0, flags 0 and 1, then the point.
 */
export function pathSubpaths(d: string): [number, number][][] {
  const subs: [number, number][][] = [];
  let out: [number, number][] = [];
  let p = 0;
  const ws = () => { while (p < d.length && /[\s,]/.test(d[p])) p++; };
  const isNum = () => { ws(); return p < d.length && /[-+.\d]/.test(d[p]); };
  const num = () => {
    ws();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(p));
    if (!m) { p++; return NaN; }
    p += m[0].length;
    return Number(m[0]);
  };
  const flag = () => { ws(); const c = d[p]; p++; return c === "1" ? 1 : 0; };
  let cmd = "", x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, lastC = "";
  const STEPS = 8;
  const cubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS, u = 1 - t;
      out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
  };
  const quad = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS, u = 1 - t;
      out.push([u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]);
    }
  };
  while (p < d.length) {
    ws();
    if (p >= d.length) break;
    if (/[a-zA-Z]/.test(d[p])) cmd = d[p++];
    else if (!cmd) { p++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") { x = sx; y = sy; lastC = ""; continue; }
    if (!isNum()) { if (p < d.length && !/[a-zA-Z]/.test(d[p])) p++; continue; }
    const ax = () => num() + (rel ? x : 0), ay = () => num() + (rel ? y : 0);
    if (C === "M") {
      if (out.length) subs.push(out);
      out = [];
      x = ax(); y = ay(); sx = x; sy = y; out.push([x, y]); cmd = rel ? "l" : "L"; lastC = "";
    } else if (C === "L") { x = ax(); y = ay(); out.push([x, y]); lastC = ""; }
    else if (C === "H") { x = num() + (rel ? x : 0); out.push([x, y]); lastC = ""; }
    else if (C === "V") { y = num() + (rel ? y : 0); out.push([x, y]); lastC = ""; }
    else if (C === "C") {
      const x1 = ax(), y1 = ay(), x2 = ax(), y2 = ay(), x3 = ax(), y3 = ay();
      cubic(x, y, x1, y1, x2, y2, x3, y3); cx = x2; cy = y2; x = x3; y = y3; lastC = "C";
    } else if (C === "S") {
      const x1 = lastC === "C" ? 2 * x - cx : x, y1 = lastC === "C" ? 2 * y - cy : y;
      const x2 = ax(), y2 = ay(), x3 = ax(), y3 = ay();
      cubic(x, y, x1, y1, x2, y2, x3, y3); cx = x2; cy = y2; x = x3; y = y3; lastC = "C";
    } else if (C === "Q") {
      const x1 = ax(), y1 = ay(), x2 = ax(), y2 = ay();
      quad(x, y, x1, y1, x2, y2); cx = x1; cy = y1; x = x2; y = y2; lastC = "Q";
    } else if (C === "T") {
      const x1 = lastC === "Q" ? 2 * x - cx : x, y1 = lastC === "Q" ? 2 * y - cy : y;
      const x2 = ax(), y2 = ay();
      quad(x, y, x1, y1, x2, y2); cx = x1; cy = y1; x = x2; y = y2; lastC = "Q";
    } else if (C === "A") {
      num(); num(); num(); flag(); flag(); // rx ry rotation large-arc sweep
      const x2 = ax(), y2 = ay();
      // The chord, not the bulge: close enough to band by, and never far outside the ink.
      out.push([(x + x2) / 2, (y + y2) / 2], [x2, y2]); x = x2; y = y2; lastC = "";
    } else { p++; }
  }
  if (out.length) subs.push(out);
  return subs;
}

/** All of a path's points in one list (pathSubpaths, flattened). */
export function pathPoints(d: string): [number, number][] {
  return pathSubpaths(d).flat();
}

/** Bounding boxes of every drawn shape, in the root's user space. Defs, clip paths and masks
 *  are not drawn and are skipped. */
export function svgShapeBoxes(svg: string): { x0: number; y0: number; x1: number; y1: number }[] {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: M[] = [IDENTITY];
  let hidden = 0;
  const push = (pts: [number, number][], mm: M) => {
    const tp = pts.filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py))
      .map(([px, py]) => [mm[0] * px + mm[2] * py + mm[4], mm[1] * px + mm[3] * py + mm[5]]);
    if (!tp.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of tp) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    boxes.push({ x0, y0, x1, y1 });
  };
  const attr = (a: string, n: string) => new RegExp(`(?:^|\\s)${n}\\s*=\\s*["']([^"']*)["']`, "i").exec(a)?.[1];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    const t = tag.toLowerCase();
    if (/^(defs|clippath|mask|symbol|pattern|lineargradient|radialgradient|style|title|desc|metadata)$/.test(t)) {
      if (close) hidden = Math.max(0, hidden - 1); else if (!self) hidden++;
      continue;
    }
    if (t === "g" || t === "a" || t === "svg") {
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      const mm = mul(stack[stack.length - 1], t === "svg" ? IDENTITY : parseTransform(attr(attrs, "transform")));
      if (!self) stack.push(mm);
      continue;
    }
    if (close || hidden) continue;
    if (/(^|\s)(fill\s*=\s*["']none["'])/.test(attrs) && !/stroke\s*=\s*["'](?!none)/.test(attrs)) continue;
    const mm = mul(stack[stack.length - 1], parseTransform(attr(attrs, "transform")));
    let pts: [number, number][] = [];
    const n = (k: string) => Number(attr(attrs, k) ?? 0);
    if (t === "path") {
      for (const sub of pathSubpaths(attr(attrs, "d") ?? "")) push(sub, mm);
      continue;
    }
    else if (t === "rect") pts = [[n("x"), n("y")], [n("x") + n("width"), n("y") + n("height")]];
    else if (t === "circle") pts = [[n("cx") - n("r"), n("cy") - n("r")], [n("cx") + n("r"), n("cy") + n("r")]];
    else if (t === "ellipse") pts = [[n("cx") - n("rx"), n("cy") - n("ry")], [n("cx") + n("rx"), n("cy") + n("ry")]];
    else if (t === "line") pts = [[n("x1"), n("y1")], [n("x2"), n("y2")]];
    else if (t === "polygon" || t === "polyline") {
      const v = (attr(attrs, "points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    }
    push(pts, mm);
  }
  return boxes;
}

/** Split an SVG lockup by re-cropping its viewBox. Returns new SVG text, or null to keep it. */
export function splitSvgLogo(svg: string): { name: string; crest?: string } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  // No viewBox is common (brunellocucinelli.com's header logo has only width="199" height="62");
  // the user space is then 0 0 width height.
  const dim = (n: string) => Number(/^\s*([\d.]+)(px)?\s*$/.exec(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1] ?? "")?.[1] ?? NaN);
  const vb = (/viewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1] ?? `0 0 ${dim("width")} ${dim("height")}`)
    .trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return null;
  const [vx, vy, vw, vh] = vb;
  // Inside the logo's own frame only: a box spilling outside the viewBox is clipped anyway.
  const boxes = svgShapeBoxes(svg)
    .map((b) => ({ x0: Math.max(vx, b.x0), y0: Math.max(vy, b.y0), x1: Math.min(vx + vw, b.x1), y1: Math.min(vy + vh, b.y1) }))
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0 && !(b.x1 - b.x0 >= vw * 0.98 && b.y1 - b.y0 >= vh * 0.98)); // a background rect is not ink
  if (!boxes.length) return null;
  // Rasterise the boxes' vertical extents onto ~400 rows of the viewBox, then band as for a PNG.
  const ROWS = 400, sy = ROWS / vh;
  const rows: ({ left: number; right: number } | null)[] = Array.from({ length: ROWS }, () => null);
  for (const b of boxes) {
    for (let r = Math.max(0, Math.floor((b.y0 - vy) * sy)); r < Math.min(ROWS, Math.ceil((b.y1 - vy) * sy)); r++) {
      const cur = rows[r];
      // x on the same scale as the rows, or every band's shape (and the crest test) is skewed.
      const l = (b.x0 - vx) * sy, rr = (b.x1 - vx) * sy;
      rows[r] = cur ? { left: Math.min(cur.left, l), right: Math.max(cur.right, rr) } : { left: l, right: rr };
    }
  }
  const split = chooseBands(bandsFromRows(rows, Math.round(ROWS * 0.015)), ROWS);
  if (!split) return null;
  const view = (b: Band, square: boolean) => {
    const y0 = vy + b.top / sy, y1 = vy + b.bottom / sy;
    const pad = (y1 - y0) * 0.06;
    let x = vx + b.left / sy - pad, y = y0 - pad, w = (b.right - b.left) / sy + 2 * pad, h = y1 - y0 + 2 * pad;
    if (square) { const s = Math.max(w, h); x -= (s - w) / 2; y -= (s - h) / 2; w = h = s; }
    const r = (v: number) => Math.round(v * 100) / 100;
    const box = `viewBox="${r(x)} ${r(y)} ${r(w)} ${r(h)}"`;
    const bare = root.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");
    const newRoot = /viewBox\s*=/i.test(bare)
      ? bare.replace(/viewBox\s*=\s*["'][^"']+["']/i, box)
      : bare.replace(/^<svg\b/i, `<svg ${box}`);
    return svg.replace(root, newRoot);
  };
  return { name: view(split.name, false), crest: split.crest ? view(split.crest, true) : undefined };
}

// ── The initial ──────────────────────────────────────────────────────────────
//
// The monogram for a house whose site offers no icon worth the name. mystylebags.it declares a
// 32px favicon and nothing else; stored as logo_small it was a smudge in the collapsed sidebar
// and unusable on a slide. The wordmark's own first glyph is the house's initial in the house's
// own letterform — "M" from MY STYLE BAGS, "L" from L.G.R — and a crest set to the left of the
// name is a crest. The NAME band is found as for a lockup; within it, the first run of ink
// columns (gaps of 4% of the band's height separate glyphs) is the initial, if it has the
// proportions of one: not a dot, not a rule, not a connected script word.

type Box = { top: number; bottom: number; left: number; right: number };

/** The band the initial sits in: the FIRST LINE of a lockup's name (the name can run to two
 *  lines, and the initial is on the first), or the first of the wide bands. */
function nameBand(bands: Band[], logoHeight: number): Band | null {
  if (!bands.length) return null;
  const split = chooseBands(bands, logoHeight);
  if (split) return bands.find((b) => b.top === split.name.top) ?? split.name;
  const width = (b: Band) => b.right - b.left;
  const widest = Math.max(...bands.map(width));
  return bands.find((b) => width(b) >= widest * 0.6) ?? bands[0];
}

/** The first run of ink columns, closing gaps shorter than `minGap`. */
function firstRun(cols: boolean[], minGap: number): { left: number; right: number } | null {
  const left = cols.indexOf(true);
  if (left < 0) return null;
  let right = left + 1, gap = 0;
  for (let x = left + 1; x < cols.length; x++) {
    if (cols[x]) { right = x + 1; gap = 0; } else if (++gap >= minGap) break;
  }
  return { left, right };
}

/** Is this run a single glyph of the name? Judged by its proportions against the band's. */
function isGlyph(g: Box, name: Band): boolean {
  const w = g.right - g.left, h = g.bottom - g.top;
  const nameW = name.right - name.left, nameH = name.bottom - name.top;
  if (w <= 0 || h <= 0) return false;
  // A glyph: up to twice as wide as tall (an M or a W in a wide face — MY STYLE BAGS' M is
  // 1.77:1), no thinner than a quarter (an I), most of the band's height (not a dot or a
  // rule), and a fraction of its width (two letters that touch, or a script word, are not).
  const ratio = w / h;
  return ratio >= 0.25 && ratio <= 2.0 && h >= nameH * 0.5 && w <= nameW * 0.45;
}

/** The initial of a PNG wordmark as a square PNG, or null when there is no clean first glyph. */
export async function initialFromPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  const px = await decodePng(bytes).catch(() => null);
  if (!px) return null;
  const { width, height, rgba } = px;
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4 * 7) if (rgba[i] < 32) transparent++;
  const opaque = transparent < (rgba.length / (4 * 7)) * 0.05;
  const bg = [rgba[0], rgba[1], rgba[2]];
  const ink = (i: number) => opaque
    ? Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > 60
    : rgba[i + 3] >= 64;
  const rows = Array.from({ length: height }, (_, y) => {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (ink((y * width + x) * 4)) { if (left < 0) left = x; right = x + 1; }
    }
    return left < 0 ? null : { left, right };
  });
  const name = nameBand(bandsFromRows(rows, Math.max(1, Math.round(height * 0.015))), height);
  if (!name) return null;
  const nameH = name.bottom - name.top;
  const cols: boolean[] = [];
  for (let x = 0; x < width; x++) {
    let any = false;
    for (let y = name.top; y < name.bottom && !any; y++) any = ink((y * width + x) * 4);
    cols.push(any);
  }
  const run = firstRun(cols, Math.max(2, Math.round(nameH * 0.04)));
  if (!run) return null;
  let top = name.bottom, bottom = name.top;
  for (let y = name.top; y < name.bottom; y++) {
    for (let x = run.left; x < run.right; x++) {
      if (ink((y * width + x) * 4)) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); break; }
    }
  }
  const glyph: Box = { top, bottom, left: run.left, right: run.right };
  if (!isGlyph(glyph, name)) return null;

  const pad = Math.max(2, Math.round((glyph.bottom - glyph.top) * 0.12));
  const x0 = Math.max(0, glyph.left - pad), x1 = Math.min(width, glyph.right + pad);
  const y0 = Math.max(0, glyph.top - pad), y1 = Math.min(height, glyph.bottom + pad);
  const w = x1 - x0, h = y1 - y0, s = Math.max(w, h);
  const ox = (s - w) >> 1, oy = (s - h) >> 1;
  const out = new Uint8Array(s * s * 4);
  // An opaque logo keeps its own background in the padding; a cut-out stays transparent.
  if (opaque) for (let i = 0; i < out.length; i += 4) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255; }
  for (let y = y0; y < y1; y++) {
    out.set(rgba.subarray((y * width + x0) * 4, (y * width + x1) * 4), ((y - y0 + oy) * s + ox) * 4);
  }
  return await encodePng(s, s, out);
}

/** The initial of an SVG wordmark as an SVG re-framed on it, or null. Same rules as the PNG. */
export function initialFromSvg(svg: string): string | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const dim = (n: string) => Number(/^\s*([\d.]+)(px)?\s*$/.exec(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1] ?? "")?.[1] ?? NaN);
  const vb = (/viewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1] ?? `0 0 ${dim("width")} ${dim("height")}`)
    .trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return null;
  const [vx, vy, vw, vh] = vb;
  const boxes = svgShapeBoxes(svg)
    .map((b) => ({ x0: Math.max(vx, b.x0), y0: Math.max(vy, b.y0), x1: Math.min(vx + vw, b.x1), y1: Math.min(vy + vh, b.y1) }))
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0 && !(b.x1 - b.x0 >= vw * 0.98 && b.y1 - b.y0 >= vh * 0.98));
  if (!boxes.length) return null;
  // Bands as for a lockup, on ~400 rows of the frame.
  const ROWS = 400, sy = ROWS / vh;
  const rows: ({ left: number; right: number } | null)[] = Array.from({ length: ROWS }, () => null);
  for (const b of boxes) {
    for (let r = Math.max(0, Math.floor((b.y0 - vy) * sy)); r < Math.min(ROWS, Math.ceil((b.y1 - vy) * sy)); r++) {
      const cur = rows[r];
      const l = (b.x0 - vx) * sy, rr = (b.x1 - vx) * sy;
      rows[r] = cur ? { left: Math.min(cur.left, l), right: Math.max(cur.right, rr) } : { left: l, right: rr };
    }
  }
  const name = nameBand(bandsFromRows(rows, Math.round(ROWS * 0.015)), ROWS);
  if (!name) return null;
  // The shapes whose vertical centre falls in the name band, clustered along x: shapes that
  // overlap or sit closer than 4% of the band's height belong to one glyph (the dot of an i,
  // the bowl and the stem of a letter drawn as two paths).
  const y0 = vy + name.top / sy, y1 = vy + name.bottom / sy, nameH = y1 - y0;
  const inBand = boxes.filter((b) => { const c = (b.y0 + b.y1) / 2; return c >= y0 && c <= y1; })
    .sort((a, b) => a.x0 - b.x0);
  if (!inBand.length) return null;
  const gap = nameH * 0.04;
  const first = { ...inBand[0] };
  for (const b of inBand.slice(1)) {
    if (b.x0 > first.x1 + gap) break;
    first.x1 = Math.max(first.x1, b.x1); first.y0 = Math.min(first.y0, b.y0); first.y1 = Math.max(first.y1, b.y1);
  }
  const glyph: Box = { top: (first.y0 - vy) * sy, bottom: (first.y1 - vy) * sy, left: (first.x0 - vx) * sy, right: (first.x1 - vx) * sy };
  if (!isGlyph(glyph, name)) return null;

  const pad = (first.y1 - first.y0) * 0.12;
  let x = first.x0 - pad, y = first.y0 - pad, w = first.x1 - first.x0 + 2 * pad, h = first.y1 - first.y0 + 2 * pad;
  const s = Math.max(w, h);
  x -= (s - w) / 2; y -= (s - h) / 2; w = h = s;
  const r = (v: number) => Math.round(v * 100) / 100;
  const box = `viewBox="${r(x)} ${r(y)} ${r(w)} ${r(h)}"`;
  const bare = root.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");
  const newRoot = /viewBox\s*=/i.test(bare)
    ? bare.replace(/viewBox\s*=\s*["'][^"']+["']/i, box)
    : bare.replace(/^<svg\b/i, `<svg ${box}`);
  return svg.replace(root, newRoot);
}

/**
 * A white PNG cut-out, repainted dark: every pixel with ink keeps its alpha and takes a
 * near-black colour. Only for a cut-out (transparency around the ink) — an opaque picture
 * has nothing to repaint onto. Null when the PNG is not light, or not a PNG.
 */
export async function repaintPngDark(bytes: Uint8Array, ink: [number, number, number] = [17, 17, 17]): Promise<Uint8Array | null> {
  if (!(await pngIsLight(bytes))) return null;
  const px = await decodePng(bytes).catch(() => null);
  if (!px) return null;
  const { width, height, rgba } = px;
  const out = new Uint8Array(rgba);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] >= 8) { out[i] = ink[0]; out[i + 1] = ink[1]; out[i + 2] = ink[2]; }
  }
  return await encodePng(width, height, out);
}
