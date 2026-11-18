// Native, vector jsPDF report generator — crisp text and charts drawn directly
// (not an html2canvas screenshot), for a designed, branded document.
import type { ReportPayload, ReportSection } from "@/components/assistant/ReportView";

const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [140, 140, 140];
const GOLD: [number, number, number] = [184, 134, 11];
const HAIR: [number, number, number] = [228, 228, 228];
const PANEL: [number, number, number] = [248, 247, 244];
const CHART: [number, number, number][] = [
  [42, 123, 91], [184, 134, 11], [143, 183, 166], [217, 178, 95],
  [76, 158, 122], [199, 154, 59], [167, 203, 188], [228, 200, 126],
];

// Italian grouping by hand: it-IT leaves four-digit numbers ungrouped ("€9800" next
// to "€53.333" in the same column).
const grp = (v: number) => {
  const [i, d] = (Math.round(v * 100) / 100).toString().split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${d ? `,${d}` : ""}`;
};
const eur = (v: number) => `€${grp(Math.round(v))}`;
const looksMoney = (c: string) => /(price|revenue|spend|ticket|value|amount|premium|cost|total|prezz|ricav|spesa|scontrin|fatturat|incass|importo|valore|(^|_)eur(o)?$)/i.test(c);

type Img = { data: string; w: number; h: number };
type ChartSection = Extract<ReportSection, { type: "bar" | "line" | "pie" }>;

// Fetch an image (cross-origin ones via the CORS image-proxy) and return a data
// URL + natural dimensions, so jsPDF can embed it and keep the aspect ratio.
async function loadImage(url: string): Promise<Img | null> {
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    const cross = /^https?:\/\//i.test(url) && !url.startsWith(location.origin);
    const fetchUrl = url.startsWith("data:") ? url
      : cross && base ? `${base}/functions/v1/image-proxy?url=${encodeURIComponent(url)}` : url;
    const res = await fetch(fetchUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
      im.onerror = () => resolve({ w: 1, h: 1 });
      im.src = data;
    });
    return { data, w: dims.w, h: dims.h };
  } catch { return null; }
}

// Crop transparent margins off a (data-URL) logo so it aligns flush to the
// left margin instead of appearing indented by the PNG's built-in padding.
async function trimTransparent(img: Img): Promise<Img> {
  try {
    const el = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("load")); im.src = img.data;
    });
    const w = el.naturalWidth, h = el.naturalHeight;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); if (!ctx) return img;
    ctx.drawImage(el, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      if (px[(yy * w + xx) * 4 + 3] > 8) { found = true; if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
    }
    if (!found || maxX <= minX || maxY <= minY) return img;
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const oc = document.createElement("canvas"); oc.width = cw; oc.height = ch;
    oc.getContext("2d")!.drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
    return { data: oc.toDataURL("image/png"), w: cw, h: ch };
  } catch { return img; }
}

export async function downloadReportPdf(report: ReportPayload, filename: string) {
  const doc = await buildReportDoc(report);
  doc.save(`${(filename || report.title || "report").replace(/[^a-z0-9-_. ]/gi, "").replace(/\s+/g, "_").slice(0, 80) || "report"}.pdf`);
}

// Build the jsPDF document (no save) — split out so it can be rendered headless
// for design iteration.
export async function buildReportDoc(report: ReportPayload) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 16, CW = W - 2 * M;

  // Preload all images (logo + product photos) up front, in parallel.
  const urls = new Set<string>();
  if (report.brand_logo) urls.add(report.brand_logo);
  for (const s of report.sections) if (s.type === "products") for (const p of s.items) if (p.image_url) urls.add(p.image_url);
  const loaded = await Promise.all([...urls].map(async (u) => [u, await loadImage(u)] as const));
  const imgs = new Map<string, Img | null>(loaded);

  let y = M, page = 1;
  const footerText = `${report.brand ?? "AION"} · ${report.title}`;
  const footer = () => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(footerText, M, H - 8, { maxWidth: CW - 12 });
    doc.text(String(page), W - M, H - 8, { align: "right" });
  };
  const addPage = () => { footer(); doc.addPage(); page++; y = M; };
  const ensure = (need: number) => { if (y + need > H - M - 6) addPage(); };
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const pt = (cx: number, cy: number, r: number, deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  let logo = report.brand_logo ? imgs.get(report.brand_logo) ?? null : null;
  if (logo && logo.data) logo = await trimTransparent(logo);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); setColor(MUTED);
  doc.text(new Date(report.generated_at).toLocaleDateString("it-IT"), W - M, y + 4, { align: "right" });
  if (logo && logo.data) {
    // Preserve aspect ratio (cap by width AND height so a wide wordmark isn't
    // squished).
    let lh = 8, lw = (lh * logo.w) / logo.h;
    const maxW = 55;
    if (lw > maxW) { lw = maxW; lh = (lw * logo.h) / logo.w; }
    doc.addImage(logo.data, "PNG", M, y, lw, lh);
    y += Math.max(lh, 7) + 7;
  } else {
    if (report.brand) { doc.setFont("helvetica", "bold"); doc.setFontSize(11); setColor(GOLD); doc.text(report.brand.toUpperCase(), M, y + 5); }
    y += 12;
  }
  doc.setFont("times", "bold"); doc.setFontSize(19); setColor(INK);
  doc.text(report.title, M, y);
  y += 6;
  if (report.subtitle) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); setColor(MUTED);
    doc.text(report.subtitle, M, y, { maxWidth: CW }); y += 5;
  }
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 8;

  // ── Sections ───────────────────────────────────────────────────────────────
  // Keep the title with the start of its content (reserve space) — no orphans.
  const sectionTitle = (t: string | undefined, reserve: number) => {
    if (!t) return;
    ensure(reserve);
    y += 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); setColor(GOLD); doc.setCharSpace(0.6);
    doc.text(t.toUpperCase(), M, y); doc.setCharSpace(0);
    y += 5.5;
  };

  // Editorial KPI band: no boxes — small letter-spaced labels, large serif
  // figures, thin hairline separators.
  const drawKpis = (items: { label: string; value: string }[]) => {
    if (!items.length) return;
    const n = Math.min(items.length, 5), ch = 15;
    for (let r = 0; r < items.length; r += n) {
      const row = items.slice(r, r + n), colW = CW / row.length;
      ensure(ch + 6);
      const y0 = y;
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.2); doc.line(M, y0, W - M, y0);
      row.forEach((it, i) => {
        const x = M + i * colW, tx = x + (i > 0 ? 5 : 0);
        if (i > 0) { doc.setDrawColor(...HAIR); doc.line(x, y0 + 2.5, x, y0 + ch - 1); }
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.3); setColor(MUTED); doc.setCharSpace(0.4);
        doc.text(it.label.toUpperCase(), tx, y0 + 5, { maxWidth: colW - (i > 0 ? 7 : 2) });
        doc.setCharSpace(0);
        doc.setFont("times", "normal"); doc.setFontSize(16); setColor(INK);
        doc.text(it.value, tx, y0 + 13, { maxWidth: colW - (i > 0 ? 7 : 2) });
      });
      y = y0 + ch + 7;
    }
  };

  // Fit a string to a width, cutting with an ellipsis (jsPDF has no clipping).
  const fit = (txt: string, w: number) => {
    if (doc.getTextWidth(txt) <= w) return txt;
    let t = txt;
    while (t.length > 1 && doc.getTextWidth(`${t}…`) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };

  // Columns are sized to what they hold. They used to be one wide first column and
  // equal narrow ones, every one but the first right-aligned with no limit, so a
  // client name or "COLLARS, EARRINGS, RINGS" in a narrow column ran across its
  // neighbours (Roberto Coin's top-clients export, 2026-11-18). Now text is
  // left-aligned and cut to its column, numbers right-aligned.
  const drawTable = (s: Extract<ReportSection, { type: "table" }>) => {
    const cols = s.columns, n = cols.length;
    if (!n) return;
    const cell = (c: { key: string; header: string }, v: unknown) => {
      const money = looksMoney(c.key) || looksMoney(c.header);
      return v == null ? "—"
        : money && v !== "" && Number.isFinite(Number(v)) ? eur(Number(v))
        : typeof v === "number" ? grp(v) : String(v);
    };
    const numeric = cols.map((c) => s.rows.every((r) => {
      const v = r[c.key];
      return v == null || typeof v === "number" || (v !== "" && Number.isFinite(Number(v)));
    }));
    const fontSize = n > 6 ? 7.5 : 8.5, pad = 3;
    // Natural width: the longest cell (or header), capped so one long column can't take the page.
    const natural = cols.map((c, i) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
      let w = doc.getTextWidth(c.header);
      doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize);
      for (const r of s.rows.slice(0, 200)) w = Math.max(w, doc.getTextWidth(cell(c, r[c.key])));
      return Math.min(w + pad, numeric[i] ? 40 : 75);
    });
    const total = natural.reduce((a, b) => a + b, 0);
    let widths: number[];
    if (total <= CW) {
      // Spare room goes to the text columns (or all, if there are none).
      const grow = numeric.some((x) => !x) ? numeric.map((x) => !x) : numeric.map(() => true);
      const growW = natural.reduce((a, w, i) => a + (grow[i] ? w : 0), 0) || 1;
      widths = natural.map((w, i) => grow[i] ? w + (CW - total) * (w / growW) : w);
    } else {
      // Too wide: numbers keep their width (they can't be cut), text shares what's left.
      // The widest text columns give way first, down to a common cap, so a short
      // column (a city) keeps its width while a long one (categories) is cut. If the
      // numbers alone would take most of the page, everything shrinks alike.
      const numW = natural.reduce((a, w, i) => a + (numeric[i] ? w : 0), 0);
      if (natural.some((_, i) => !numeric[i]) && numW <= CW * 0.6) {
        const room = CW - numW;
        let lo = 0, hi = Math.max(...natural);
        for (let k = 0; k < 30; k++) {
          const cap = (lo + hi) / 2;
          const used = natural.reduce((a, w, i) => a + (numeric[i] ? 0 : Math.min(w, cap)), 0);
          if (used > room) hi = cap; else lo = cap;
        }
        widths = natural.map((w, i) => numeric[i] ? w : Math.min(w, lo));
      } else {
        widths = natural.map((w) => (w / total) * CW);
      }
    }
    const xs: number[] = []; widths.reduce((x, w, i) => { xs[i] = x; return x + w; }, M);
    const rowH = 6.5;
    const place = (txt: string, i: number) => numeric[i]
      ? doc.text(fit(txt, widths[i] - pad), xs[i] + widths[i] - pad, y, { align: "right" })
      : doc.text(fit(txt, widths[i] - pad), xs[i], y);
    const header = () => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); setColor(MUTED);
      cols.forEach((c, i) => place(c.header, i));
      y += 2; doc.setDrawColor(...HAIR); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 4;
    };
    ensure(rowH * 2); header();
    for (const r of s.rows) {
      if (y + rowH > H - M - 6) { addPage(); header(); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize); setColor(INK);
      cols.forEach((c, i) => place(cell(c, r[c.key]), i));
      y += 1.6; doc.setDrawColor(243, 243, 243); doc.line(M, y, W - M, y); y += rowH - 1.6;
    }
  };

  const drawProducts = (items: Extract<ReportSection, { type: "products" }>["items"]) => {
    const per = 4, gap = 4, cw = (CW - gap * (per - 1)) / per, imgS = cw, cardH = imgS + 15;
    const list = items.slice(0, 8);
    for (let r = 0; r < list.length; r += per) {
      const row = list.slice(r, r + per);
      ensure(cardH + 3);
      row.forEach((p, i) => {
        const x = M + i * (cw + gap);
        const im = p.image_url ? imgs.get(p.image_url) : null;
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...HAIR); doc.setLineWidth(0.2);
        doc.rect(x, y, imgS, imgS, "FD");
        if (im && im.data) {
          const scale = Math.min(imgS / im.w, imgS / im.h), iw = im.w * scale, ih = im.h * scale;
          try { doc.addImage(im.data, "JPEG", x + (imgS - iw) / 2, y + (imgS - ih) / 2, iw, ih); } catch { /* skip */ }
        }
        let ty = y + imgS + 4;
        if (p.subtitle) { doc.setFont("helvetica", "normal"); doc.setFontSize(6); setColor(MUTED); doc.text(String(p.subtitle).toUpperCase().slice(0, 24), x, ty); ty += 3; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(7); setColor(INK);
        const name = doc.splitTextToSize(p.name, cw).slice(0, 2) as string[];
        doc.text(name, x, ty); ty += name.length * 3 + 1;
        if (p.price != null) { doc.setFontSize(7.5); setColor(INK); doc.text(eur(p.price), x, ty); }
      });
      y += cardH + 3;
    }
  };

  // Many bars, or names under them: a vertical chart would overlap its labels
  // (15 client names under 11 mm slots), so it is drawn sideways, label first.
  const drawHBar = (s: ChartSection) => {
    const data = s.data, money = s.unit === "eur";
    const fmtVal = (v: number) => money ? eur(v) : grp(v);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    const labW = Math.min(62, Math.max(...data.map((d) => doc.getTextWidth(String(d.label)))) + 3);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    const valW = Math.max(...data.map((d) => doc.getTextWidth(fmtVal(d.value)))) + 3;
    const bx = M + labW, bw = CW - labW - valW, rowH = 5.6, barH = 3.4;
    const max = Math.max(...data.map((d) => d.value), 1);
    data.forEach((d) => {
      ensure(rowH);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setColor(INK);
      doc.text(fit(String(d.label), labW - 3), M, y + barH - 0.6);
      const len = Math.max(0, bw * (d.value / max));
      doc.setFillColor(...GOLD); doc.rect(bx, y, len, barH, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); setColor(INK);
      doc.text(fmtVal(d.value), bx + len + 1.5, y + barH - 0.6);
      y += rowH;
    });
    y += 3;
  };

  const drawBarLine = (s: ChartSection) => {
    const data = s.data; if (!data.length) return;
    const money = s.unit === "eur";
    const bx = M + 16, bw = CW - 16, bh = 40;
    if (s.type === "bar") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
      const slot = Math.min(bw, data.length * 34) / data.length;
      if (data.length > 8 || data.some((d) => doc.getTextWidth(String(d.label)) > slot - 1)) return drawHBar(s);
    }
    ensure(bh + 10);
    const by = y, max = Math.max(...data.map((d) => d.value), 1);
    doc.setFontSize(6.5); setColor(MUTED); doc.setDrawColor(...HAIR); doc.setLineWidth(0.2);
    [0, 0.5, 1].forEach((f) => {
      const yy = by + bh - bh * f;
      doc.line(bx, yy, bx + bw, yy);
      doc.text(money ? `€${Math.round((max * f) / 1000)}k` : grp(Math.round(max * f)), bx - 2, yy + 1, { align: "right" });
    });
    const fmtVal = (v: number) => money ? (v >= 1000 ? `€${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : eur(v)) : grp(v);
    if (s.type === "bar") {
      // Centre the bars in a band so a few points don't float far apart.
      const areaW = Math.min(bw, data.length * 34), x0 = bx + (bw - areaW) / 2;
      const slot = areaW / data.length, barW = Math.min(slot * 0.5, 24);
      data.forEach((d, i) => {
        const hh = bh * (d.value / max), x = x0 + i * slot + (slot - barW) / 2;
        doc.setFillColor(...GOLD); doc.rect(x, by + bh - hh, barW, hh, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); setColor(INK);
        doc.text(fmtVal(d.value), x + barW / 2, by + bh - hh - 1.5, { align: "center" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); setColor(MUTED);
        doc.text(String(d.label), x + barW / 2, by + bh + 4, { align: "center" });
      });
    } else {
      doc.setDrawColor(...CHART[0]); doc.setLineWidth(0.6);
      const pts = data.map((d, i) => [bx + (bw / Math.max(1, data.length - 1)) * i, by + bh - bh * (d.value / max)] as [number, number]);
      for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      doc.setFillColor(...CHART[0]); pts.forEach((p) => doc.circle(p[0], p[1], 0.8, "F"));
      setColor(MUTED); doc.setFontSize(6.5);
      data.forEach((d, i) => doc.text(String(d.label), pts[i][0], by + bh + 4, { align: "center" }));
    }
    y = by + bh + 10;
  };

  const drawPie = (s: ChartSection) => {
    const data = [...s.data].sort((a, b) => b.value - a.value); if (!data.length) return;
    const money = s.unit === "eur", total = data.reduce((a, d) => a + d.value, 0) || 1;
    const r = 19; ensure(2 * r + 4);
    const cx = M + r, cy = y + r;
    let a0 = -90;
    data.forEach((d, i) => {
      const a1 = a0 + (360 * d.value) / total, col = CHART[i % CHART.length];
      doc.setFillColor(col[0], col[1], col[2]);
      for (let a = a0; a < a1; a += 4) {
        const b = Math.min(a + 4, a1), p1 = pt(cx, cy, r, a), p2 = pt(cx, cy, r, b);
        doc.triangle(cx, cy, p1[0], p1[1], p2[0], p2[1], "F");
      }
      a0 = a1;
    });
    let ly = y + 3; const lx = cx + r + 8;
    data.forEach((d, i) => {
      const col = CHART[i % CHART.length];
      doc.setFillColor(col[0], col[1], col[2]); doc.rect(lx, ly - 2.4, 3, 3, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setColor(INK);
      doc.text(String(d.label), lx + 5, ly, { maxWidth: W - M - (lx + 5) - 34 });
      doc.text(`${money ? eur(d.value) : grp(d.value)} · ${Math.round((d.value / total) * 100)}%`, W - M, ly, { align: "right" });
      ly += 5.5;
    });
    y = Math.max(cy + r, ly) + 4;
  };

  const reserveFor = (t: ReportSection["type"]) =>
    t === "bar" || t === "line" ? 54 : t === "pie" ? 46 : t === "products" ? 62 : t === "kpis" ? 24 : t === "table" ? 20 : 14;
  for (const s of report.sections) {
    sectionTitle(s.title, reserveFor(s.type));
    if (s.type === "kpis") drawKpis(s.items);
    else if (s.type === "table") drawTable(s);
    else if (s.type === "products") drawProducts(s.items);
    else if (s.type === "bar" || s.type === "line") drawBarLine(s);
    else if (s.type === "pie") drawPie(s);
    else if (s.type === "note") {
      doc.setFont("times", "italic"); doc.setFontSize(9.5); setColor(MUTED);
      const lines = doc.splitTextToSize(s.body, CW) as string[];
      ensure(lines.length * 4.5 + 2); doc.text(lines, M, y); y += lines.length * 4.5;
    }
    y += 7;
  }
  footer();
  return doc;
}
