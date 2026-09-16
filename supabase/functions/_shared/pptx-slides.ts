// Slides with a shape to them, rather than a title and a column of bullets.
//
// Everything AION generates as a deck went through one renderer that drew a title and a
// bulleted list, because that is all the business case needed. The operations booklet is not
// that: it is four actors and their responsibilities, two numbered flows of a dozen steps, a
// table of insurer SLAs, a communications plan with a sender and a trigger per row, and two
// things that have to be impossible to skim past. Flattened into bullets it stopped being an
// operating document — which is why the ops deck was being replaced by hand with the PDF.
//
// So: four more slide shapes, drawn as real DrawingML. A table is an `<a:tbl>` in a
// `<p:graphicFrame>`, not indented text; a numbered flow is a borderless table with a gold
// number column, because a table is the one construct PowerPoint will reflow when a step runs
// long and the alternative is measuring text in EMUs and being wrong on the longest line.
//
// Nothing here touches the theme. Colours, faces and the cream ground are set explicitly per
// run, exactly as the hand-built teaser sets them — a generated slide that only references
// the layout inherits PowerPoint's blue default, which is what the first render of the ops
// deck looked like.

import type { Slide } from "./ops-booklet.ts";

// ── The look, which is the teaser's own ─────────────────────────────────────────────────
export const BG = "FAF7F2";
export const INK = "262626";
/** AION gold — hsl(38 55% 55%) in the product, #CB9D4D on paper. */
export const GOLD = "CB9D4D";
export const MUTED = "6B6257";
export const RULE = "E3DACB";
export const HEADING = "Georgia";
export const BODY = "Montserrat";

// 16:9 at 13.333in × 7.5in, in EMU.
export const SLIDE_W = 12192000;
export const SLIDE_H = 6858000;
/** The AION wordmark's own left margin in the teaser; everything lines up with it. */
const M = 848926;
const CONTENT_W = SLIDE_W - 2 * M;
/** Where the wordmark sits, so nothing is drawn over it. */
export const MARK = { x: M, y: 6455335, cx: 627631, cy: 178973 };
const FLOOR = MARK.y - 120000;

const TITLE_Y = 620000;
const TITLE_H = 760000;

/**
 * One slide's XML.
 *
 * `markRelId` is the relationship id of the AION wordmark in this slide's rels, or null when
 * the package has no wordmark to place.
 */
export function slideXml(slide: Slide, markRelId: string | null): string {
  const body = (() => {
    switch (slide.kind) {
      case "section": return sectionSlide(slide);
      case "bullets": return bulletsSlide(slide);
      case "steps": return stepsSlide(slide);
      case "table": return tableSlide(slide);
      case "callout": return calloutSlide(slide);
    }
  })();

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    body + mark(markRelId) +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// ── The five shapes ─────────────────────────────────────────────────────────────────────

/** A cover or a divider: the title large and centred, over a gold rule. */
function sectionSlide(s: Extract<Slide, { kind: "section" }>): string {
  const y = 2100000;
  return textBox(2, M, y, CONTENT_W, 1400000, [
    para(s.title, { face: HEADING, size: 4000, align: "ctr", color: INK }),
  ]) +
    rect(3, Math.round(SLIDE_W / 2 - 400000), y + 1500000, 800000, 22000, GOLD) +
    (s.lead
      ? textBox(4, M + 900000, y + 1750000, CONTENT_W - 1800000, 1200000, [
          para(s.lead, { face: BODY, size: 1400, align: "ctr", color: MUTED, lineSpacing: 150 }),
        ])
      : "");
}

function bulletsSlide(s: Extract<Slide, { kind: "bullets" }>): string {
  const top = header(s.title, s.lead);
  return top.xml + textBox(20, M, top.y, CONTENT_W, FLOOR - top.y,
    s.bullets.filter(Boolean).map((b) =>
      para(b, { face: BODY, size: 1500, color: INK, bullet: true, lineSpacing: 130, spaceBefore: 600 })));
}

/**
 * A numbered flow.
 *
 * The number in its own gold column, which is what makes fourteen steps scannable and what
 * lets the reader say "we are stuck on 5" in a meeting. Split across slides by the caller —
 * this draws whatever it is given and shrinks the type rather than running off the page.
 */
function stepsSlide(s: Extract<Slide, { kind: "steps" }>): string {
  const top = header(s.title, s.lead);
  const h = FLOOR - top.y;
  const n = Math.max(1, s.steps.length);
  const rowH = Math.floor(h / n);
  // Eight steps at 15pt is comfortable; twelve is not, so the type follows the count rather
  // than the last rows sliding under the wordmark.
  const size = n <= 6 ? 1500 : n <= 9 ? 1300 : 1150;

  const rows = s.steps.map((text, i) => ({
    height: rowH,
    cells: [
      // The number a size up from its step: it is the thing being pointed at in a meeting.
    { paras: [para(String(i + 1), { face: HEADING, size: size + 200, color: GOLD, align: "ctr" })], fill: null, align: "ctr" as const },
      { paras: [para(text, { face: BODY, size, color: INK })], fill: null, align: "ctr" as const },
    ],
  }));
  return top.xml + table(21, M, top.y, [620000, CONTENT_W - 620000], rows, { rule: true });
}

function tableSlide(s: Extract<Slide, { kind: "table" }>): string {
  const top = header(s.title, s.lead);
  const h = FLOOR - top.y;
  const cols = Math.max(1, s.head.length);
  const size = s.rows.length <= 4 ? 1300 : 1150;

  // Two shapes here, not one. Usually the first column is a label column — narrower, in ink,
  // in bold — and the rest share what is left. But a single row of two columns is not a table
  // of labels and values, it is two panels side by side (the active/passive cycle is one
  // paragraph each), so they get equal width and equal weight. Bolding one half of that
  // slide, which is what a label column would do, makes it read as the important one.
  const panels = s.rows.length === 1 && cols === 2;
  const widths = panels
    ? [Math.round(CONTENT_W / 2), CONTENT_W - Math.round(CONTENT_W / 2)]
    : [Math.round(CONTENT_W * 0.28), ...Array(cols - 1).fill(Math.round(CONTENT_W * 0.72 / (cols - 1 || 1)))];

  const headH = 460000;
  const rowH = Math.floor((h - headH) / Math.max(1, s.rows.length));
  const rows = [
    {
      height: headH,
      cells: s.head.map((t) => ({
        paras: [para(t, { face: BODY, size: 1200, color: BG, bold: true })],
        fill: INK, align: "ctr" as const,
      })),
    },
    ...s.rows.map((r) => ({
      height: rowH,
      cells: r.map((t, i) => ({
        paras: [para(t, {
          face: BODY, size,
          color: panels || i === 0 ? INK : MUTED,
          bold: !panels && i === 0 && cols > 1,
          lineSpacing: panels ? 140 : undefined,
        })],
        fill: null, align: panels ? ("t" as const) : ("ctr" as const),
      })),
    })),
  ];
  return top.xml + table(22, M, top.y, widths.slice(0, cols), rows, { rule: true });
}

/** One thing nobody may skim past: a gold-edged panel with the point in it. */
function calloutSlide(s: Extract<Slide, { kind: "callout" }>): string {
  const top = header(s.title);
  const h = 1900000;
  // Centred in what is left of the slide rather than pinned under the title: a panel with
  // four inches of cream under it reads as a slide that did not finish loading.
  const y = Math.max(top.y + 200000, Math.round(top.y + (FLOOR - top.y - h) / 2));
  return top.xml +
    rect(30, M, y, CONTENT_W, h, "FFFFFF", { lineColor: GOLD, lineWidth: 19050 }) +
    rect(31, M, y, 44000, h, GOLD) +
    textBox(32, M + 420000, y + 260000, CONTENT_W - 840000, 500000, [
      para(s.label, { face: HEADING, size: 1900, color: GOLD }),
    ]) +
    textBox(33, M + 420000, y + 830000, CONTENT_W - 840000, h - 1000000, [
      para(s.body, { face: BODY, size: 1400, color: INK, lineSpacing: 140 }),
    ]);
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────

/** Title, optional standfirst, and where the content may start underneath them. */
function header(title: string, lead?: string): { xml: string; y: number } {
  let xml = textBox(10, M, TITLE_Y, CONTENT_W, TITLE_H, [
    para(title, { face: HEADING, size: 2600, color: INK }),
  ]);
  xml += rect(11, M, TITLE_Y + TITLE_H - 40000, 520000, 19050, GOLD);
  let y = TITLE_Y + TITLE_H + 200000;
  if (lead) {
    // Roughly four lines' worth at this measure; a standfirst longer than that is a
    // paragraph and gets the room for one.
    const h = lead.length > 420 ? 1250000 : lead.length > 210 ? 900000 : 560000;
    xml += textBox(12, M, y, CONTENT_W, h, [
      para(lead, { face: BODY, size: 1250, color: MUTED, lineSpacing: 140 }),
    ]);
    y += h + 120000;
  }
  return { xml, y };
}

type ParaOpts = {
  face: string; size: number; color: string;
  bold?: boolean; align?: "l" | "ctr" | "r"; bullet?: boolean;
  /** Percent, e.g. 140 for 1.4 lines. */
  lineSpacing?: number;
  spaceBefore?: number;
};

function para(text: string, o: ParaOpts): string {
  const props = [
    o.align && o.align !== "l" ? ` algn="${o.align}"` : "",
    o.bullet ? ` marL="228600" indent="-228600"` : ` marL="0" indent="0"`,
  ].join("");
  const spacing =
    (o.lineSpacing ? `<a:lnSpc><a:spcPct val="${o.lineSpacing * 1000}"/></a:lnSpc>` : "") +
    (o.spaceBefore ? `<a:spcBef><a:spcPts val="${o.spaceBefore}"/></a:spcBef>` : "");
  // An explicit bullet character, because "no buChar" inherits whatever the layout says and
  // the layouts in these packages disagree with each other.
  const bullet = o.bullet
    ? `<a:buFont typeface="Arial"/><a:buChar char="—"/>`
    : `<a:buNone/>`;
  return `<a:p><a:pPr${props}>${spacing}${bullet}</a:pPr>` +
    `<a:r><a:rPr lang="it-IT" sz="${o.size}"${o.bold ? ` b="1"` : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` +
    `<a:latin typeface="${o.face}"/><a:cs typeface="${o.face}"/></a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function textBox(id: number, x: number, y: number, cx: number, cy: number, paras: string[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"><a:normAutofit/></a:bodyPr>` +
    `<a:lstStyle/>${paras.join("") || `<a:p/>`}</p:txBody></p:sp>`;
}

function rect(
  id: number, x: number, y: number, cx: number, cy: number, fill: string,
  o: { lineColor?: string; lineWidth?: number } = {},
): string {
  const line = o.lineColor
    ? `<a:ln w="${o.lineWidth ?? 12700}"><a:solidFill><a:srgbClr val="${o.lineColor}"/></a:solidFill></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rect ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${line}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

type Cell = { paras: string[]; fill: string | null; align?: "t" | "ctr" | "b" };
type Row = { height: number; cells: Cell[] };

/**
 * A DrawingML table.
 *
 * No `tableStyleId`: a style id points into ppt/tableStyles.xml, which these packages do not
 * all carry, and a missing style renders as PowerPoint's default blue banding over the cream.
 * Every fill and rule is set on the cell instead, so the table looks the same wherever the
 * deck is opened.
 */
function table(
  id: number, x: number, y: number, widths: number[], rows: Row[],
  o: { rule?: boolean } = {},
): string {
  const grid = widths.map((w) => `<a:gridCol w="${w}"/>`).join("");
  const trs = rows.map((r) => {
    const tcs = r.cells.map((c) => {
      const fill = c.fill
        ? `<a:solidFill><a:srgbClr val="${c.fill}"/></a:solidFill>`
        : `<a:noFill/>`;
      // Every edge stated, not just the one that is wanted. A cell that says nothing about
      // its left border gets whatever the renderer's default table style draws, and the
      // proof render came back with a grid of vertical rules nobody asked for.
      const rule =
        `<a:lnL><a:noFill/></a:lnL><a:lnR><a:noFill/></a:lnR><a:lnT><a:noFill/></a:lnT>` +
        (o.rule
          ? `<a:lnB w="6350" cap="flat"><a:solidFill><a:srgbClr val="${RULE}"/></a:solidFill></a:lnB>`
          : `<a:lnB><a:noFill/></a:lnB>`);
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${c.paras.join("")}</a:txBody>` +
        `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="${c.align ?? "ctr"}">${rule}${fill}</a:tcPr></a:tc>`;
    }).join("");
    return `<a:tr h="${r.height}">${tcs}</a:tr>`;
  }).join("");

  return `<p:graphicFrame><p:nvGraphicFramePr>` +
    `<p:cNvPr id="${id}" name="Table ${id}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/>` +
    `</p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${widths.reduce((a, b) => a + b, 0)}" cy="${rows.reduce((a, b) => a + b.height, 0)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`;
}

function mark(relId: string | null): string {
  if (!relId) return "";
  // 990, not 4. Shape ids have to be unique within a slide, and the section opener already
  // uses 2, 3 and 4 — so on the cover, the one slide where both appear, the wordmark
  // collided with the standfirst and PowerPoint offers to repair the file. The local proof
  // renders without a wordmark, so this only shows up in the deck built into the teaser.
  return `<p:pic><p:nvPicPr><p:cNvPr id="990" name="AION"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${MARK.x}" y="${MARK.y}"/><a:ext cx="${MARK.cx}" cy="${MARK.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
