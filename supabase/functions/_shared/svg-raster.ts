// An SVG logo as a PNG.
//
// Most storefronts draw their logo inline as SVG, and an SVG is the one format the rest of the
// pipeline cannot use: PowerPoint will not embed it without a raster, so the intro deck fell
// back to the favicon and reported "NO BRAND LOGO"; and a monogram cannot be cut out of it by
// pixels. resvg, as WASM, renders it here — in the edge runtime (the module is bundled with
// the function, the .wasm fetched once per isolate) and in the test suite (the same npm
// package on disk, reached through the alias in vitest.config.ts).
//
// Nothing here throws to the caller: a renderer that fails to load, or an SVG it cannot parse,
// is a null, and the caller keeps the SVG as it was — and `unavailable()` says why, so the
// branding stage can put the reason in its notes rather than silently storing an SVG.

import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

const VERSION = "2.6.2";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@${VERSION}/index_bg.wasm`;

let ready: Promise<boolean> | null = null;
let failure: string | null = null;

async function load(): Promise<boolean> {
  try {
    const inDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
    if (inDeno) {
      const res = await fetch(WASM_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`${WASM_URL} answered ${res.status}`);
      await initWasm(await res.arrayBuffer());
    } else {
      // Node (the tests): the package's .wasm is on disk.
      const nodeModule = "node:module";
      const nodeFs = "node:fs";
      const { createRequire } = (await import(nodeModule)) as { createRequire: (u: string) => { resolve: (s: string) => string } };
      const { readFileSync } = (await import(nodeFs)) as { readFileSync: (p: string) => Uint8Array };
      await initWasm(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")));
    }
    return true;
  } catch (e) {
    failure = (e as Error).message;
    console.error("[svg-raster] renderer unavailable:", failure);
    return false;
  }
}

/** Why the renderer could not be used, after a null from rasteriseSvg; null when it loaded. */
export function unavailable(): string | null {
  return failure;
}

/**
 * Render an SVG to a transparent PNG, `size` pixels along its longer side. Null when the
 * renderer is unavailable or the SVG has no usable frame (no viewBox and no width/height).
 */
export async function rasteriseSvg(svg: string, size = 1600): Promise<Uint8Array | null> {
  ready ??= load();
  if (!(await ready)) return null;
  try {
    const frame = svgFrame(svg);
    if (!frame) return null;
    const fitTo = frame.w >= frame.h ? { mode: "width" as const, value: size } : { mode: "height" as const, value: size };
    const r = new Resvg(svg, { fitTo, background: "rgba(0,0,0,0)" });
    const png = r.render().asPng() as Uint8Array;
    return png.length ? png : null;
  } catch (e) {
    failure = `could not render: ${(e as Error).message}`;
    console.error("[svg-raster]", failure);
    return null;
  }
}

/** The SVG's own frame — its viewBox, or its width and height — as numbers. */
export function svgFrame(svg: string): { x: number; y: number; w: number; h: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  const dim = (n: string) => Number(/^\s*([\d.]+)(px)?\s*$/.exec(new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1] ?? "")?.[1] ?? NaN);
  const w = dim("width"), h = dim("height");
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
}
