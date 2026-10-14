// Slides with a shape to them, rather than a title and a column of bullets.
//
// Everything AION generates as a deck went through one renderer that drew a title and a
// bulleted list, because that is all the business case needed. The operations booklet is not
// that: it is four actors and their responsibilities, two numbered flows of a dozen steps, a
// table of insurer SLAs, a communications plan with a sender and a trigger per row, and two
// things that have to be impossible to skim past. Flattened into bullets it stopped being an
// operating document — which is why the ops deck was being replaced by hand with the PDF.
//
// So: real DrawingML for each shape. "Better — can it be even MORE graphic?" was the second
// pass, with the original roll-out deck as the reference for the graphics only: a headline
// with its key phrase in bold, a numbered tab at the edge of every section slide, flows drawn
// as numbered circles on a line with a card per step, key figures set large, pictograms,
// callouts that are panels rather than boxed paragraphs. Kept in AION's cream, ink and gold,
// not the reference's pastels — and every word on these slides is still the booklet's.
//
// Nothing here touches the theme. Colours, faces and the cream ground are set explicitly per
// run, exactly as the hand-built teaser sets them — a generated slide that only references
// the layout inherits PowerPoint's blue default, which is what the first render of the ops
// deck looked like.
//
// Text is MEASURED, not left to autofit. `normAutofit` is still set as a safety net, but
// PowerPoint only applies it once somebody edits the box, and LibreOffice applies it at once
// — so a proof that relies on it looks fine and the client's copy overflows. Every box here is
// sized from an estimate of its own text (see `lineCount`), on the generous side.

import type { IconName, Slide } from "./ops-booklet.ts";

// ── The look, which is the teaser's own ─────────────────────────────────────────────────
export const BG = "FAF7F2";
export const INK = "262626";
/** AION gold — hsl(38 55% 55%) in the product, #CB9D4D on paper. */
export const GOLD = "CB9D4D";
export const MUTED = "6B6257";
export const RULE = "E3DACB";
/** The gold at the weight a ground can carry — the number column's rail. */
export const NUMBER_RAIL = "F7F1E6";
/** Every other row of a table, a shade off the cream. */
export const BAND = "F3EEE6";
/** The title band across the top of a content slide — the cream, a step darker. */
const HEAD_BAND = "F2ECE2";
const WHITE = "FFFFFF";
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
/**
 * Where the ops slides' content stops: a clear quarter-inch above the footer lockup, so a
 * card's bottom edge never reads as underlining the house's name.
 */
const OPS_FLOOR = MARK.y - 260000;

const TITLE_Y = 620000;
const TITLE_H = 760000;

/** The ops header: band, tab, title. Content starts under `BAND_H`. */
const BAND_H = 1320000;
const OPS_TITLE_Y = 500000;
const OPS_TITLE_H = 700000;
const CONTENT_Y = BAND_H + 220000;

const EMU_PT = 12700;

/** Whose deck this is, for the footer lockup. */
export type Page = { brand: string };

/**
 * Shape ids, unique within a slide. The drawn shapes count up from 100: the wordmark is 990,
 * the footer 991, and the plain business-case slide still uses its fixed ids under 100.
 */
let nextId = 100;
const nid = () => nextId++;

/**
 * One slide's XML.
 *
 * `markRelId` is the relationship id of the AION wordmark in this slide's rels, or null when
 * the package has no wordmark to place.
 *
 * `page` draws the footer lockup — AION × house. Omitting it leaves a bullet slide exactly as
 * it was drawn before: the business case deck passes nothing, and its plain title-and-bullets
 * slide is not part of the ops deck's graphic pass.
 */
export function slideXml(slide: Slide, markRelId: string | null, page?: Page): string {
  nextId = 100;
  const body = (() => {
    switch (slide.kind) {
      case "section": return sectionSlide(slide);
      case "bullets": return page ? bulletsSlide(slide) : plainBulletsSlide(slide);
      case "flow": return flowSlide(slide);
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
    body + mark(markRelId) + (page ? footer(page, slide, markRelId !== null) : "") +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// ── The cover ───────────────────────────────────────────────────────────────────────────

/**
 * A cover or a divider: the title large and centred, over a gold rule.
 *
 * With `sub` — which only the cover carries — the house goes UNDER the rule in letterspaced
 * caps rather than into the title beside our own name. Set as one line, a long legal entity
 * shrinks the whole lockup to fit the slide, and the house ends up in the same face and
 * weight as AION; stacked, its name can be as long as it is and still be the second thing
 * read. The headline is set the way every other slide's is — the first word in bold — and
 * the rule carries a gold lozenge, the one ornament the deck allows itself.
 */
function sectionSlide(s: Extract<Slide, { kind: "section" }>): string {
  const y = s.sub ? 1750000 : 2100000;
  const ruleY = y + (s.sub ? 1250000 : 1500000);
  const cx = Math.round(SLIDE_W / 2);
  const dia = 150000;
  const words = s.title.split(" ");
  const runs: Run[] = words.length > 1
    ? [{ text: words[0], bold: true }, { text: " " + words.slice(1).join(" ") }]
    : [{ text: s.title, bold: true }];
  return textBox(nid(), M, y, CONTENT_W, 1200000, [
    rich(runs, { face: HEADING, size: 5400, align: "ctr", color: INK }),
  ], "b") +
    rect(nid(), cx - 900000, ruleY + dia / 2 - 9525, 900000 - dia, 19050, GOLD) +
    rect(nid(), cx + dia, ruleY + dia / 2 - 9525, 900000 - dia, 19050, GOLD) +
    shape(cx - dia / 2, ruleY, dia, dia, { prst: "diamond", fill: GOLD }) +
    (s.sub
      ? textBox(nid(), M, ruleY + 380000, CONTENT_W, 500000, [
          // Letterspaced, because caps set solid read as a word rather than as a name, and
          // this is the one place in the deck where the house signs the document.
          para(s.sub.toUpperCase(), { face: HEADING, size: 1800, align: "ctr", color: INK, spacing: 300 }),
        ])
      : "") +
    (s.lead
      ? textBox(nid(), M + 1300000, ruleY + (s.sub ? 1150000 : 300000), CONTENT_W - 2600000, 1300000, [
          para(s.lead, { face: BODY, size: 1400, align: "ctr", color: MUTED, lineSpacing: 150 }),
        ])
      : "");
}

// ── The contents ────────────────────────────────────────────────────────────────────────

/**
 * The programme as a row of chevrons — the deck's own contents, drawn.
 *
 * Ink chevrons with the section number in gold, a pictogram for each section in a gold-ringed
 * medallion under it, and the section's name under that: the reference deck's "Step 0 … Step
 * 5" row, in AION's colours. The sections are passed in, so this is a picture of the deck that
 * follows rather than a second copy of it that can go stale.
 */
function flowSlide(s: Extract<Slide, { kind: "flow" }>): string {
  const top = opsHeader(s.title, s.lead, undefined, s.eyebrow);
  const n = Math.max(1, s.items.length);
  const gap = 70000;
  const colW = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const chevH = 600000;
  const badge = 980000;
  const labelSize = n >= 6 ? 1500 : 1700;
  const labelW = colW - 60000;
  const labelH = Math.max(...s.items.map((t) => textH(t, labelW, labelSize, HEADING, 115)));
  const block = chevH + 330000 + badge + 260000 + labelH;
  const avail = OPS_FLOOR - top.y;
  const y0 = top.y + Math.max(0, Math.round((avail - block) / 2));
  const head = Math.round(chevH / 2);

  let xml = "";
  s.items.forEach((item, i) => {
    const x = M + i * (colW + gap);
    const mid = x + Math.round(colW / 2);
    xml +=
      shape(x, y0, colW, chevH, { prst: i === 0 ? "homePlate" : "chevron", fill: i % 2 ? INK : "3A3632" }) +
      // A chevron's notch and point balance, so its own box centre is the centre of its body;
      // the first, a home plate, is flat on the left and centred a half-head left of that.
      textBox(nid(), x, y0, i === 0 ? colW - Math.round(head / 2) : colW, chevH, [
        para(String(i + 1).padStart(2, "0"), { face: HEADING, size: 2000, color: GOLD, align: "ctr", bold: true }),
      ], "ctr") +
      // A thin gold stem from chevron to medallion: it is what makes the three tiers read
      // as one column per section.
      rect(nid(), mid - 6350, y0 + chevH, 12700, 330000, GOLD) +
      shape(mid - badge / 2, y0 + chevH + 330000, badge, badge, {
        prst: "ellipse", fill: WHITE, line: GOLD, lineW: 19050,
      }) +
      (s.icons?.[i] ? icon(s.icons[i], mid, y0 + chevH + 330000 + badge / 2, 560000, GOLD, WHITE) : "") +
      textBox(nid(), x + 30000, y0 + chevH + 330000 + badge + 260000, labelW, labelH + 60000, [
        para(item, { face: HEADING, size: labelSize, color: INK, align: "ctr", lineSpacing: 115 }),
      ]);
  });
  return top.xml + xml;
}

// ── Bullets ─────────────────────────────────────────────────────────────────────────────

/**
 * A section opener: the standfirst as a panel on the left, the points as four cards on the
 * right.
 *
 * The standfirst is the paragraph that says what the section is, so it is set in the heading
 * face like a pull-quote, under the section's pictogram; the points are the things to take
 * away, so each gets a card and a gold lozenge. Without a standfirst the cards take the width.
 */
function bulletsSlide(s: Extract<Slide, { kind: "bullets" }>): string {
  const top = opsHeader(s.title, undefined, undefined, s.eyebrow);
  const bullets = s.bullets.filter(Boolean);
  const avail = OPS_FLOOR - top.y;
  const gap = 200000;

  const panelW = s.lead ? Math.round(CONTENT_W * 0.44) : 0;
  const gridX = s.lead ? M + panelW + 300000 : M;
  const gridW = s.lead ? CONTENT_W - panelW - 300000 : CONTENT_W;

  // Two by two for four points, one column for three or fewer, two columns otherwise.
  const cols = bullets.length <= 3 ? 1 : 2;
  const rowsN = Math.ceil(bullets.length / cols);
  const cardW = Math.floor((gridW - gap * (cols - 1)) / cols);
  const cPad = 230000;
  const cTextW = cardW - 2 * cPad;
  const markH = 340000;
  const maxCardH = Math.floor((avail - gap * (rowsN - 1)) / rowsN);
  const bh = (z: number) => Math.max(...bullets.map((b) => textH(b, cTextW, z, BODY, 125)));
  const bSize = pickSize([1700, 1600, 1500, 1400, 1300, 1200], (z) => bh(z) + markH + 2 * cPad <= maxCardH);
  const gridNeed = rowsN * (bh(bSize) + markH + 2 * cPad) + gap * (rowsN - 1);

  // The standfirst panel, if there is one, and the grid share a height: two blocks of
  // different heights side by side read as a layout that did not finish.
  const pPad = 300000;
  const iconBlock = s.icon ? 760000 : 0;
  const pTextW = panelW - 2 * pPad - 50000;
  const lSize = s.lead
    ? pickSize([1600, 1500, 1400, 1300, 1200, 1100], (z) =>
        textH(s.lead!, pTextW, z, HEADING, 140) + iconBlock + 2 * pPad <= avail)
    : 0;
  const leadH = s.lead ? textH(s.lead, pTextW, lSize, HEADING, 140) : 0;
  const panelNeed = s.lead ? leadH + iconBlock + 2 * pPad : 0;
  const H = Math.min(avail, Math.max(panelNeed, gridNeed, 2600000));
  const y = top.y + Math.round((avail - H) / 2);

  let xml = "";
  if (s.lead) {
    // The icon and the paragraph as one group, centred in the panel.
    const gy = y + Math.max(pPad, Math.round((H - leadH - iconBlock) / 2));
    xml +=
      shape(M, y, panelW, H, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      rect(nid(), M, y, 50000, H, GOLD) +
      (s.icon
        ? shape(M + 50000 + pPad, gy, 560000, 560000, { prst: "ellipse", fill: NUMBER_RAIL, line: GOLD, lineW: 12700 }) +
          icon(s.icon, M + 50000 + pPad + 280000, gy + 280000, 340000, GOLD, NUMBER_RAIL)
        : "") +
      textBox(nid(), M + 50000 + pPad, gy + iconBlock, pTextW, leadH + 80000, [
        para(s.lead, { face: HEADING, size: lSize, color: INK, lineSpacing: 140 }),
      ]);
  }
  const cardH = Math.floor((H - gap * (rowsN - 1)) / rowsN);
  bullets.forEach((b, i) => {
    const x = gridX + (i % cols) * (cardW + gap);
    const row = Math.floor(i / cols);
    const cy = y + row * (cardH + gap);
    const th = textH(b, cTextW, bSize, BODY, 125);
    // Centred on the tallest card in its row, so the lozenges and first lines line up across.
    const rowTh = Math.max(...bullets.slice(row * cols, row * cols + cols).map((t) => textH(t, cTextW, bSize, BODY, 125)));
    const gy = cy + Math.max(cPad, Math.round((cardH - markH - rowTh) / 2));
    xml +=
      shape(x, cy, cardW, cardH, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      rect(nid(), x, cy, cardW, 36000, GOLD) +
      shape(x + cPad, gy, 170000, 170000, { prst: "diamond", fill: GOLD }) +
      textBox(nid(), x + cPad, gy + markH, cTextW, th + 80000, [
        para(b, { face: BODY, size: bSize, color: INK, lineSpacing: 125 }),
      ]);
  });
  return top.xml + xml;
}

/**
 * The business case's slide, drawn exactly as it always was: a title and a column of bullets.
 * It is not part of the ops deck's graphic pass and nobody asked for it to change.
 */
function plainBulletsSlide(s: Extract<Slide, { kind: "bullets" }>): string {
  const top = plainHeader(s.title, s.lead, undefined, s.eyebrow);
  const bullets = s.bullets.filter(Boolean);
  const h = FLOOR - top.y;
  // Open the list out into the room it has instead of stacking it at the top. Four bullets
  // in the top third of a slide is what made these pages look half-finished next to the
  // tables and the numbered flows, which fill the page by construction.
  const slotPt = h / 12700 / Math.max(1, bullets.length);
  const gap = Math.round(Math.max(600, Math.min(2600, (slotPt - 19.5) * 100)));
  return top.xml + textBox(20, M, top.y, CONTENT_W, h,
    bullets.map((b) =>
      para(b, { face: BODY, size: 1500, color: INK, bullet: true, lineSpacing: 130, spaceBefore: gap })),
    "ctr");
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────

/**
 * A numbered flow, drawn as a process: gold numbered circles on a line, a card per step under
 * each, the line turning back at the end of a row to carry the eye to the next one.
 *
 * Five steps or fewer sit on one row; more are split over two. A flow that runs over two
 * slides says so with its line: on the first half it runs off the right edge of the page, on
 * the second it comes in from the left — and the numbers pick up where the first half
 * stopped. A step that is a branch ("Se …:") gets its condition in bold and a dashed card, so
 * the reader can see where the flow forks without reading every card.
 */
function stepsSlide(s: Extract<Slide, { kind: "steps" }>): string {
  const top = opsHeader(s.title, s.lead, s.part, s.eyebrow);
  const n = Math.max(1, s.steps.length);
  const perRow = n <= 5 ? n : Math.ceil(n / 2);
  const rowsN = Math.ceil(n / perRow);
  // Where this slide's numbering picks up. A flow cut across two slides is still one flow,
  // and the second slide's first step is the ninth, not the first.
  const from = Math.max(1, Math.round(s.start ?? 1));
  const continues = s.part && s.part.index < s.part.of;
  const continued = s.part && s.part.index > 1;

  const gap = 150000;
  const colW = Math.floor((CONTENT_W - gap * (perRow - 1)) / perRow);
  const D = 400000;
  const toCard = 70000;
  const rowGap = 260000;
  const padX = 130000;
  const padY = 110000;
  const textW = colW - 2 * padX;
  const avail = OPS_FLOOR - top.y;
  const maxCardH = Math.floor((avail - rowsN * (D + toCard) - rowGap * (rowsN - 1)) / rowsN);
  const stepH = (t: string, z: number) => textH(t, textW, z, BODY, 112);
  const size = pickSize([1500, 1400, 1300, 1200, 1100, 1000], (z) =>
    Math.max(...s.steps.map((t) => stepH(t, z))) + 2 * padY + 30000 <= maxCardH);
  const need = Math.max(...s.steps.map((t) => stepH(t, size))) + 2 * padY + 30000;
  const cardH = Math.min(maxCardH, Math.max(need, 800000));
  const rowH = D + toCard + cardH;
  const total = rowsN * rowH + rowGap * (rowsN - 1);
  const y0 = top.y + Math.max(0, Math.round((avail - total) / 2));

  const lineW = 19050;
  let lines = "";
  let marks = "";
  const left = M;
  const right = M + CONTENT_W;
  const out = 200000;
  for (let r = 0; r < rowsN; r++) {
    const cy = y0 + r * (rowH + rowGap) + D / 2;
    const first = r === 0;
    const last = r === rowsN - 1;
    const x1 = first ? (continued ? 0 : left + Math.round(colW / 2)) : left - out;
    const x2 = last ? (continues ? SLIDE_W : right) : right + out;
    lines += line(x1, cy, x2, cy, { color: GOLD, w: lineW, arrow: last && !continues });
    if (!last) {
      // The turn: down the right margin, back along the gap between the rows, down the left
      // margin into the next row's line.
      const cyNext = cy + rowH + rowGap;
      const yTurn = y0 + r * (rowH + rowGap) + rowH + Math.round(rowGap / 2);
      lines +=
        line(right + out, cy, right + out, yTurn, { color: GOLD, w: lineW }) +
        line(left - out, yTurn, right + out, yTurn, { color: GOLD, w: lineW }) +
        line(left - out, yTurn, left - out, cyNext, { color: GOLD, w: lineW });
    }
  }
  s.steps.forEach((text, i) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const x = M + c * (colW + gap);
    const y = y0 + r * (rowH + rowGap);
    const mid = x + Math.round(colW / 2);
    const branch = /^Se [^:]+:/.test(text);
    marks +=
      shape(mid - D / 2, y, D, D, {
        prst: "ellipse", fill: GOLD, line: BG, lineW: 28575,
        text: [para(String(from + i), { face: HEADING, size: 1400, color: INK, bold: true, align: "ctr" })],
        anchor: "ctr", inset: 0,
      }) +
      shape(x, y + D + toCard, colW, cardH, {
        prst: "rect", fill: WHITE, line: branch ? GOLD : RULE, lineW: branch ? 12700 : 9525,
        dash: branch ? "dash" : undefined,
      }) +
      (branch ? "" : rect(nid(), x, y + D + toCard, colW, 30000, GOLD)) +
      textBox(nid(), x + padX, y + D + toCard + padY + 30000, textW, cardH - 2 * padY - 30000 + 30000, [
        rich(emphasise(text), { face: BODY, size, color: INK, lineSpacing: 112 }),
      ]);
  });
  return top.xml + lines + marks;
}

// ── Tables, and the shapes a table can take ─────────────────────────────────────────────

function tableSlide(s: Extract<Slide, { kind: "table" }>): string {
  switch (s.display) {
    case "cards": return cardsSlide(s);
    case "figures": {
      const figures = s.rows.map((r) => daysIn(r[r.length - 1] ?? ""));
      if (figures.every((f) => f !== null)) return figuresSlide(s, figures as string[]);
      return plainTableSlide(s);
    }
    case "panels": return panelsSlide(s);
    default: return plainTableSlide(s);
  }
}

/**
 * A table with a heading row you can see from the back of the room: ink, with a gold rule
 * under it, banded rows, and a marker at the start of each row — gold where AION is the
 * sender, ink where it is the house — so who sends what reads before any of it is read.
 */
function plainTableSlide(s: Extract<Slide, { kind: "table" }>): string {
  const top = opsHeader(s.title, s.lead, undefined, s.eyebrow);
  const avail = OPS_FLOOR - top.y;
  const cols = Math.max(1, s.head.length);
  const markW = 90000;
  const w = CONTENT_W - markW;
  const shares = cols === 3 ? [0.27, 0.29, 0.44] : cols === 2 ? [0.3, 0.7] : Array(cols).fill(1 / cols);
  const widths = [markW, ...shares.map((f, i) =>
    i === cols - 1 ? w - shares.slice(0, -1).reduce((a, b) => a + Math.round(w * b), 0) : Math.round(w * f))];
  const pad = 2 * 91440;
  const headH = 480000;
  const size = pickSize([1300, 1200, 1150, 1100, 1000], (z) =>
    headH + s.rows.reduce((a, r) => a + rowNeed(r, widths.slice(1), z, pad), 0) <= avail);
  const natural = s.rows.map((r) => rowNeed(r, widths.slice(1), size, pad));
  const spare = Math.max(0, avail - headH - natural.reduce((a, b) => a + b, 0));
  // Rows open out to fill the room, up to a point: a table of six short rows stretched to
  // the floor is all air.
  const extra = Math.min(Math.floor(spare / Math.max(1, s.rows.length)), 150000);
  const isAion = (r: string[]) => /^AION\b/.test(r[1] ?? r[0] ?? "");
  const rows: Row[] = [
    {
      height: headH,
      cells: [
        { paras: [para("", { face: BODY, size: 1000, color: INK })], fill: INK, ruleColor: GOLD, ruleW: 28575 },
        ...s.head.map((t) => ({
          paras: [para(t, { face: BODY, size: 1200, color: BG, bold: true, spacing: 50 })],
          fill: INK, align: "ctr" as const, ruleColor: GOLD, ruleW: 28575,
        })),
      ],
    },
    ...s.rows.map((r, row) => ({
      height: natural[row] + extra,
      cells: [
        { paras: [para("", { face: BODY, size: 1000, color: INK })], fill: isAion(r) ? GOLD : INK },
        ...r.map((t, i) => ({
          paras: [para(t, {
            face: i === 0 ? HEADING : BODY, size: i === 0 ? size + 100 : size,
            color: i === cols - 1 ? MUTED : INK,
            bold: i === 0 && cols > 1,
          })],
          fill: row % 2 === 1 ? BAND : WHITE,
          align: "ctr" as const,
        })),
      ],
    })),
  ];
  return top.xml + table(nid(), M, top.y, widths, rows, { rule: true });
}

/** A row's height at a size: its tallest cell, plus the cell margins. */
function rowNeed(r: string[], widths: number[], size: number, pad: number): number {
  return Math.max(...r.map((t, i) => textH(t, widths[i] - pad, i === 0 ? size + 100 : size, i === 0 ? HEADING : BODY, 100)))
    + 2 * 45720 + 120000;
}

/**
 * The actors, as one card each: a pictogram and the name on an ink header, the duties under it
 * as a list. The booklet writes each actor's duties as one line separated by " · "; that line
 * is drawn as the list it always was.
 */
function cardsSlide(s: Extract<Slide, { kind: "table" }>): string {
  const top = opsHeader(s.title, s.lead, undefined, s.eyebrow);
  const avail = OPS_FLOOR - top.y;
  const n = Math.max(1, s.rows.length);
  const gap = 160000;
  const cardW = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const padX = 150000;
  const nameSize = (name: string) => (name.length > 22 ? 1400 : 1600);
  const nameW = cardW - 2 * padX;
  // Icon, then the name under it — as tall as the longest name needs, so "Compagnia
  // assicurativa (Chubb)" on two lines does not ride up into its umbrella.
  const nameTop = 640000;
  const nameH = Math.max(...s.rows.map((r) => textH(r[0] ?? "", nameW, nameSize(r[0] ?? ""), HEADING, 100)));
  const headH = nameTop + nameH + 150000;
  const textW = cardW - 2 * padX - 200000;
  const items = s.rows.map((r) => (r[1] ?? "").split(/\s+·\s+/).filter(Boolean));
  const listH = (list: string[], z: number) =>
    list.reduce((a, t) => a + textH(t, textW, z, BODY, 115) + Math.round(z / 100 * 0.45 * EMU_PT), 0);
  const size = pickSize([1400, 1300, 1200, 1150, 1100, 1050, 1000], (z) =>
    headH + Math.max(...items.map((l) => listH(l, z))) + 2 * 180000 <= avail);
  const need = headH + Math.max(...items.map((l) => listH(l, size))) + 2 * 180000;
  const cardH = Math.min(avail, need);
  const y = top.y + Math.round((avail - cardH) / 2);
  let xml = "";
  s.rows.forEach((r, i) => {
    const x = M + i * (cardW + gap);
    const name = r[0] ?? "";
    xml +=
      shape(x, y, cardW, cardH, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      shape(x, y, cardW, headH, { prst: "rect", fill: INK }) +
      rect(nid(), x, y + headH, cardW, 30000, GOLD) +
      (s.icons?.[i] ? icon(s.icons[i], x + cardW / 2, y + 320000, 460000, GOLD, INK) : "") +
      textBox(nid(), x + padX, y + nameTop, nameW, nameH + 40000, [
        para(name, { face: HEADING, size: nameSize(name), color: BG, bold: true, align: "ctr" }),
      ], "ctr") +
      textBox(nid(), x + padX, y + headH + 180000, cardW - 2 * padX, cardH - headH - 2 * 180000 + 60000,
        items[i].map((t, k) => para(t, {
          face: BODY, size, color: INK, bullet: true, bulletColor: GOLD, lineSpacing: 115,
          spaceBefore: k ? Math.round(size * 0.45) : 0,
        })));
  });
  return top.xml + xml;
}

/**
 * The SLA, as key figures: the working days set large in the gold, what they measure under
 * them, and the booklet's own sentence under that — the figure for the back of the room, the
 * sentence for whoever has to hold the insurer to it.
 */
function figuresSlide(s: Extract<Slide, { kind: "table" }>, figures: string[]): string {
  const top = opsHeader(s.title, s.lead, undefined, s.eyebrow);
  const avail = OPS_FLOOR - top.y;
  const n = Math.max(1, s.rows.length);
  const gap = 220000;
  const tileW = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const padX = 280000;
  const textW = tileW - 2 * padX;
  const figH = 1050000;
  const unitH = 320000;
  const labelSize = 1600;
  const labelH = Math.max(...s.rows.map((r) => textH(r[0] ?? "", textW, labelSize, HEADING, 110)));
  const bodySize = 1350;
  const bodyH = Math.max(...s.rows.map((r) => textH(r[1] ?? "", textW, bodySize, BODY, 130)));
  const tileH = Math.min(avail, 260000 + figH + unitH + 260000 + labelH + 160000 + bodyH + 300000);
  const y = top.y + Math.round((avail - tileH) / 2);
  let xml = "";
  s.rows.forEach((r, i) => {
    const x = M + i * (tileW + gap);
    let cy = y + 260000;
    xml +=
      shape(x, y, tileW, tileH, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      rect(nid(), x, y, tileW, 40000, GOLD) +
      textBox(nid(), x + padX, cy, textW, figH, [
        para(figures[i], { face: HEADING, size: figures[i].length > 4 ? 5400 : 6600, color: GOLD, bold: true }),
      ], "b");
    cy += figH;
    xml += textBox(nid(), x + padX, cy, textW, unitH, [
      para("giorni lavorativi", { face: BODY, size: 1200, color: MUTED, spacing: 100 }),
    ], "t");
    cy += unitH + 100000;
    xml += rect(nid(), x + padX, cy, 420000, 19050, GOLD);
    cy += 160000;
    xml += textBox(nid(), x + padX, cy, textW, labelH + 40000, [
      para(r[0] ?? "", { face: HEADING, size: labelSize, color: INK, bold: true, lineSpacing: 110 }),
    ]);
    cy += labelH + 160000;
    xml += textBox(nid(), x + padX, cy, textW, bodyH + 60000, [
      rich(emphasise(r[1] ?? ""), { face: BODY, size: bodySize, color: INK, lineSpacing: 130 }),
    ]);
  });
  return top.xml + xml;
}

/**
 * "N giorni lavorativi" anywhere in an SLA, as the figure to set large — "5", or "5 / 10"
 * where the sentence names two. Null when the cell names no working days, in which case the
 * slide is drawn as the table it is.
 */
function daysIn(t: string): string | null {
  const days = [...t.matchAll(/(\d+)\s+giorni lavorativi/g)].map((m) => m[1]);
  const unique = [...new Set(days)];
  return unique.length ? unique.join(" / ") : null;
}

/**
 * Two paragraphs side by side, each on its own card under an ink header with a pictogram —
 * equal width and equal weight, because neither half of the active/passive cycle is the
 * important one.
 */
function panelsSlide(s: Extract<Slide, { kind: "table" }>): string {
  const top = opsHeader(s.title, s.lead, undefined, s.eyebrow);
  const avail = OPS_FLOOR - top.y;
  const cols = Math.max(1, s.head.length);
  const gap = 300000;
  const w = Math.floor((CONTENT_W - gap * (cols - 1)) / cols);
  const headH = 760000;
  const pad = 300000;
  const textW = w - 2 * pad;
  const cells = s.head.map((_, i) => s.rows.map((r) => r[i] ?? "").join("\n"));
  // Each panel's deadline set large above its paragraph, when every panel names one — the
  // 15th of the month on one side, five days on the other. Only when all do, or the two
  // panels stop matching.
  const figs = cells.map(deadlineIn);
  const hero = figs.every((f) => f !== null) ? 880000 : 0;
  const size = pickSize([1600, 1500, 1400, 1300, 1200], (z) =>
    headH + hero + Math.max(...cells.map((t) => textH(t, textW, z, BODY, 135))) + 2 * pad <= avail);
  const bodyH = Math.max(...cells.map((t) => textH(t, textW, size, BODY, 135)));
  const h = Math.min(avail, Math.max(headH + hero + bodyH + 2 * pad, 2800000));
  const y = top.y + Math.round((avail - h) / 2);
  let xml = "";
  s.head.forEach((head, i) => {
    const x = M + i * (w + gap);
    const fig = hero ? figs[i]! : null;
    xml +=
      shape(x, y, w, h, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      shape(x, y, w, headH, { prst: "rect", fill: INK }) +
      rect(nid(), x, y + headH, w, 30000, GOLD) +
      (s.icons?.[i] ? icon(s.icons[i], x + pad + 230000, y + headH / 2, 440000, GOLD, INK) : "") +
      textBox(nid(), x + pad + (s.icons?.[i] ? 640000 : 0), y, w - 2 * pad - 640000, headH, [
        para(head, { face: HEADING, size: 2000, color: BG, bold: true }),
      ], "ctr");
    if (fig) {
      const numW = Math.round(fig.n.length * 0.62 * 5400 / 100 * EMU_PT) + 120000;
      xml +=
        textBox(nid(), x + pad, y + headH + pad - 100000, numW, 700000, [
          para(fig.n, { face: HEADING, size: 5400, color: GOLD, bold: true }),
        ], "b") +
        textBox(nid(), x + pad + numW, y + headH + pad - 100000, textW - numW, 700000 - 90000, [
          para(fig.unit, { face: BODY, size: 1300, color: MUTED, spacing: 100 }),
        ], "b") +
        // Clear of the figure's descender — Georgia's numerals are old-style, and a 5 or a 9
        // hangs below the line.
        rect(nid(), x + pad, y + headH + pad + 740000, 420000, 19050, GOLD);
    }
    xml += textBox(nid(), x + pad, y + headH + hero + pad, textW, h - headH - hero - 2 * pad + 60000,
      cells[i].split("\n").map((t) =>
        rich(emphasise(t), { face: BODY, size, color: INK, lineSpacing: 135 })));
  });
  return top.xml + xml;
}

/** The first deadline in a paragraph, as a figure and what it counts: "15" / "del mese successivo". */
function deadlineIn(t: string): { n: string; unit: string } | null {
  const m = /(?:[Ee]ntro il|\b[Ii]n) (\d+) (del mese successivo|giorni lavorativi|giorni)/.exec(t);
  return m ? { n: m[1], unit: m[2] } : null;
}

// ── Callouts ────────────────────────────────────────────────────────────────────────────

/**
 * One thing nobody may skim past.
 *
 * A warning is an ink block with the hazard sign and the label in it, beside a white panel
 * with the point. A label that is an equation — "Valore voucher = prezzo retail del prodotto"
 * — is drawn as one: two tiles and an equals sign, with the explanation underneath.
 */
function calloutSlide(s: Extract<Slide, { kind: "callout" }>): string {
  const top = opsHeader(s.title, undefined, undefined, s.eyebrow);
  const avail = OPS_FLOOR - top.y;
  const eq = s.label.split(/\s+=\s+/);
  if (eq.length === 2) return top.xml + equationCallout(s, eq as [string, string], top.y, avail);

  const blockW = 3300000;
  const pad = 420000;
  const textW = CONTENT_W - blockW - 2 * pad;
  const size = pickSize([2000, 1800, 1600, 1500, 1400], (z) => textH(s.body, textW, z, BODY, 145) + 2 * pad <= avail);
  const h = Math.min(avail, Math.max(textH(s.body, textW, size, BODY, 145) + 2 * pad, 2900000));
  const y = top.y + Math.round((avail - h) / 2);
  const ic = 1000000;
  return top.xml +
    shape(M, y, CONTENT_W, h, { prst: "rect", fill: WHITE, line: GOLD, lineW: 19050 }) +
    shape(M, y, blockW, h, { prst: "rect", fill: INK }) +
    icon(s.icon ?? "warning", M + blockW / 2, y + Math.round(h * 0.36), ic, GOLD, INK) +
    textBox(nid(), M + 250000, y + Math.round(h * 0.36) + ic / 2 + 200000, blockW - 500000, 800000, [
      para(s.label, { face: HEADING, size: 1700, color: BG, bold: true, align: "ctr", lineSpacing: 110 }),
    ]) +
    textBox(nid(), M + blockW + pad, y + pad, textW, h - 2 * pad, [
      para(s.body, { face: BODY, size, color: INK, lineSpacing: 145 }),
    ], "ctr");
}

function equationCallout(
  s: Extract<Slide, { kind: "callout" }>, [lhs, rhs]: [string, string], top: number, avail: number,
): string {
  const eqW = 1000000;
  const tileW = Math.floor((CONTENT_W - eqW) / 2);
  const tileH = 1150000;
  const gap = 340000;
  const pad = 380000;
  const textW = CONTENT_W - 2 * pad - 50000;
  const size = pickSize([1600, 1500, 1400, 1300], (z) =>
    tileH + gap + textH(s.body, textW, z, BODY, 145) + 2 * pad <= avail);
  const bodyH = textH(s.body, textW, size, BODY, 145) + 2 * pad;
  const total = tileH + gap + bodyH;
  const y = top + Math.max(0, Math.round((avail - total) / 2));
  const by = y + tileH + gap;
  return shape(M, y, tileW, tileH, {
      prst: "rect", fill: INK,
      text: [para(lhs, { face: HEADING, size: 2400, color: BG, bold: true, align: "ctr" })], anchor: "ctr", inset: 200000,
    }) +
    shape(M + tileW + eqW / 2 - 300000, y + tileH / 2 - 260000, 600000, 520000, { prst: "mathEqual", fill: GOLD }) +
    shape(M + tileW + eqW, y, tileW, tileH, {
      prst: "rect", fill: NUMBER_RAIL, line: GOLD, lineW: 25400,
      text: [para(rhs, { face: HEADING, size: 2400, color: INK, bold: true, align: "ctr" })], anchor: "ctr", inset: 200000,
    }) +
    shape(M, by, CONTENT_W, bodyH, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
    rect(nid(), M, by, 50000, bodyH, GOLD) +
    textBox(nid(), M + 50000 + pad, by + pad, textW, bodyH - 2 * pad + 40000, [
      para(s.body, { face: BODY, size, color: INK, lineSpacing: 145 }),
    ], "ctr");
}

// ── Headers ─────────────────────────────────────────────────────────────────────────────

/**
 * The content slide's header: a band a step darker than the page, the section's number on an
 * ink tab at the left edge, the title with its key phrase in bold, and the section this slide
 * belongs to above it in small italic.
 *
 * The tab is the reference deck's device: a reader can find section 3 by flicking through
 * without reading a title. The number comes from the title ("3. Apertura …") or, on a slide
 * inside a section, from its eyebrow; the contents slide, which belongs to no section, gets
 * the tab without a number.
 *
 * `part` draws the "2 / 2" a flow carries when it runs over two slides — opposite the title,
 * as a pill. It replaces a heading that said "— dal nono passo": a reader who has to be told
 * in prose which half of a flow they are looking at is a reader the deck is not helping.
 */
function opsHeader(
  title: string, lead?: string, part?: { of: number; index: number }, eyebrow?: string,
): { xml: string; y: number } {
  const badge = part && part.of > 1 ? `${part.index} / ${part.of}` : null;
  const numbered = /^(\d+)\.\s+(\S[\s\S]*)$/.exec(title);
  const fromBrow = eyebrow ? /^(\d+)\./.exec(eyebrow) : null;
  const num = numbered?.[1] ?? fromBrow?.[1] ?? null;
  const text = numbered ? numbered[2] : title;

  let xml = rect(nid(), 0, 0, SLIDE_W, BAND_H, HEAD_BAND) +
    rect(nid(), 0, BAND_H - 12700, SLIDE_W, 12700, RULE);
  if (eyebrow) {
    xml += textBox(nid(), M, 220000, CONTENT_W, 260000, [
      para(eyebrow, { face: BODY, size: 1050, color: MUTED, italic: true }),
    ]);
  }
  // Off the left edge on purpose: only its right end, with its rounded corners, is on the
  // page — a tab, not a box.
  const tabY = OPS_TITLE_Y + 50000;
  const tabH = OPS_TITLE_H - 100000;
  xml += shape(-300000, tabY, 300000 + 580000, tabH, {
    prst: "roundRect", fill: num ? INK : GOLD, adj: { adj: 22000 },
  });
  if (num) {
    xml += textBox(nid(), 0, tabY, 580000, tabH, [
      para(num, { face: HEADING, size: 2600, color: GOLD, bold: true, align: "ctr" }),
    ], "ctr");
  }
  const titleW = badge ? CONTENT_W - 1300000 : CONTENT_W;
  const size = textH(text, titleW, 2800, HEADING, 100) > 2800 / 100 * 1.25 * EMU_PT ? 2400 : 2800;
  xml += textBox(nid(), M, OPS_TITLE_Y, titleW, OPS_TITLE_H, [
    rich(headline(text), { face: HEADING, size, color: INK }),
  ], "ctr");
  if (badge) {
    xml += shape(M + CONTENT_W - 1000000, OPS_TITLE_Y + (OPS_TITLE_H - 440000) / 2, 1000000, 440000, {
      prst: "roundRect", fill: WHITE, line: GOLD, lineW: 15875, adj: { adj: 50000 },
      text: [para(badge, { face: BODY, size: 1400, color: INK, bold: true, align: "ctr" })],
      anchor: "ctr", inset: 0,
    });
  }
  let y = CONTENT_Y;
  if (lead) {
    const h = textH(lead, CONTENT_W, 1300, BODY, 140) + 40000;
    xml += textBox(nid(), M, y, CONTENT_W, h, [
      para(lead, { face: BODY, size: 1300, color: MUTED, lineSpacing: 140 }),
    ]);
    y += h + 220000;
  }
  return { xml, y };
}

/**
 * The key phrase of a heading, in bold: everything before the first preposition or dash —
 * "**Apertura e gestione** dei sinistri", "**I quattro attori** del sistema", "**SLA** — tempi
 * di risposta…". A heading with no break is bold throughout.
 */
function headline(title: string): Run[] {
  const i = title.search(/\s(?=(?:—|–|del|della|dello|dei|degli|delle|di|con|in|tra|per)\s)/);
  if (i <= 0) return [{ text: title, bold: true }];
  return [{ text: title.slice(0, i), bold: true }, { text: title.slice(i) }];
}

/**
 * The parts of a step to set in bold: a branch's condition ("Se i dati sono incompleti:") and
 * every deadline ("entro 2 giorni lavorativi", "entro il 15 del mese successivo"). The words
 * are the booklet's; the weight is what lets a reader find the timings on a page of steps.
 */
function emphasise(text: string): Run[] {
  const runs: Run[] = [];
  let rest = text;
  const cond = /^(Se [^:]+:)(\s*)/.exec(rest);
  if (cond) {
    runs.push({ text: cond[1], bold: true }, ...(cond[2] ? [{ text: cond[2] }] : []));
    rest = rest.slice(cond[0].length);
  }
  const deadline =
    /[Ee]ntro (?:circa |il )?\d+ (?:giorni lavorativi|del mese successivo|dello stesso mese)|entro (?:la )?fine (?:del )?mese|in \d+ giorni/g;
  let at = 0;
  for (const m of rest.matchAll(deadline)) {
    if (m.index! > at) runs.push({ text: rest.slice(at, m.index) });
    runs.push({ text: m[0], bold: true });
    at = m.index! + m[0].length;
  }
  if (at < rest.length) runs.push({ text: rest.slice(at) });
  return runs;
}

/** The plain header the business case slide has always had. */
function plainHeader(
  title: string, lead?: string, part?: { of: number; index: number }, eyebrow?: string,
): { xml: string; y: number } {
  const badge = part && part.of > 1 ? `${part.index} / ${part.of}` : null;
  const brow = eyebrow
    ? textBox(14, M, 300000, CONTENT_W, 300000, [
        para(eyebrow, { face: BODY, size: 1050, color: MUTED, italic: true }),
      ])
    : "";
  const numbered = /^(\d+\.)\s+(\S[\s\S]*)$/.exec(title);
  let xml = brow + textBox(10, M, TITLE_Y, badge ? CONTENT_W - 900000 : CONTENT_W, TITLE_H, [
    numbered
      ? para(numbered[2], {
          face: HEADING, size: 2600, color: INK,
          accent: { text: `${numbered[1]} `, color: GOLD },
        })
      : para(title, { face: HEADING, size: 2600, color: INK }),
  ]);
  if (badge) {
    xml += textBox(13, M + CONTENT_W - 900000, TITLE_Y + 70000, 900000, 400000, [
      para(badge, { face: BODY, size: 1400, color: GOLD, align: "r" }),
    ]);
  }
  xml += rect(11, M, TITLE_Y + TITLE_H - 40000, 520000, 19050, GOLD);
  let y = TITLE_Y + TITLE_H + 200000;
  if (lead) {
    const h = lead.length > 420 ? 1250000 : lead.length > 210 ? 900000 : 560000;
    xml += textBox(12, M, y, CONTENT_W, h, [
      para(lead, { face: BODY, size: 1250, color: MUTED, lineSpacing: 140 }),
    ]);
    y += h + 120000;
  }
  return { xml, y };
}

// ── Measuring ───────────────────────────────────────────────────────────────────────────

/**
 * Lines a string wraps to at a size in a width, by greedy word wrap on measured advances.
 *
 * Measured on this booklet's own words, in em: Montserrat lowercase 0.535 (bold 0.56),
 * capitals 0.69 (bold 0.71), space 0.26; Georgia lowercase 0.47 (bold 0.55), capitals 0.65
 * (bold 0.74). Capitals get their own figure because the booklet is full of them — AION,
 * CLIP, GDPR, the house's short name in caps — and an average that ignored them put the
 * last line of a card on its border. The figures are a shade over the regular weights,
 * because deadlines and conditions are set in bold.
 */
const ADVANCE: Record<string, { lower: number; upper: number; space: number }> = {
  [BODY]: { lower: 0.55, upper: 0.71, space: 0.28 },
  [HEADING]: { lower: 0.5, upper: 0.7, space: 0.26 },
};

function lineCount(text: string, width: number, size: number, face: string): number {
  const a = ADVANCE[face] ?? ADVANCE[BODY];
  // 6% short of the box: a line that fits by a hair in the estimate is the line that wraps in
  // the renderer, which breaks a little early and kerns differently.
  const room = 0.94 * width / (size / 100 * EMU_PT);
  const wordW = (w: string) =>
    [...w].reduce((t, ch) => t + (/[A-ZÀ-Ý0-9%@]/.test(ch) ? a.upper : /[.,;:'’()\/|·—–-]/.test(ch) ? 0.3 : a.lower), 0);
  let n = 0;
  for (const hard of text.split("\n")) {
    n++;
    let cur = -1;
    for (const w of hard.split(/\s+/).filter(Boolean)) {
      const ww = wordW(w);
      if (cur < 0) cur = ww;
      else if (cur + a.space + ww <= room) cur += a.space + ww;
      else { n++; cur = ww; }
    }
  }
  return Math.max(1, n);
}

/** A text's height in EMU, at a line spacing in percent. */
function textH(text: string, width: number, size: number, face: string, lineSpacing = 100): number {
  return Math.ceil(lineCount(text, width, size, face) * (size / 100) * 1.2 * (lineSpacing / 100) * EMU_PT);
}

/** The largest size that fits, or the smallest on offer. */
function pickSize(sizes: number[], fits: (size: number) => boolean): number {
  for (const z of sizes) if (fits(z)) return z;
  return sizes[sizes.length - 1];
}

// ── Pictograms ──────────────────────────────────────────────────────────────────────────

/**
 * A pictogram centred on (cx, cy) in a box `s` wide, in `color`, with `knock` as the colour of
 * the ground it sits on (for the details cut into it). Each one is a few preset shapes, so it
 * is real vector art that recolours with the deck and needs no image part.
 */
function icon(name: IconName, cx: number, cy: number, s: number, color: string, knock: string): string {
  const u = (f: number) => Math.round(s * f);
  const X = (f: number) => Math.round(cx - s / 2 + s * f);
  const Y = (f: number) => Math.round(cy - s / 2 + s * f);
  switch (name) {
    case "overview":
      return shape(X(0.08), Y(0.08), u(0.84), u(0.84), { prst: "gear6", fill: color }) +
        shape(X(0.36), Y(0.36), u(0.28), u(0.28), { prst: "ellipse", fill: knock });
    case "policy":
      return shape(X(0.18), Y(0.04), u(0.64), u(0.86), { prst: "foldedCorner", fill: color }) +
        [0.3, 0.45, 0.6].map((f) => rect(nid(), X(0.3), Y(f), u(f === 0.6 ? 0.26 : 0.4), u(0.05), knock)).join("");
    case "claim":
      return shape(X(0.02), Y(0.02), u(0.96), u(0.96), { prst: "irregularSeal1", fill: color });
    case "voucher":
      return shape(X(0.02), Y(0.2), u(0.96), u(0.6), { prst: "plaque", fill: color }) +
        shape(X(0.38), Y(0.38), u(0.24), u(0.24), { prst: "star5", fill: knock });
    case "mail":
      return shape(X(0.04), Y(0.18), u(0.92), u(0.64), { prst: "rect", fill: color }) +
        shape(X(0.04), Y(0.18), u(0.92), u(0.4), { prst: "triangle", fill: null, line: knock, lineW: u(0.05), flipV: true });
    case "cycle":
      return shape(X(0.04), Y(0.04), u(0.92), u(0.92), { prst: "circularArrow", fill: color, adj: { adj1: 12500, adj5: 12500 } }) +
        shape(X(0.04), Y(0.04), u(0.92), u(0.92), { prst: "circularArrow", fill: color, rot: 10800000, adj: { adj1: 12500, adj5: 12500 } });
    case "insurer":
      // An umbrella: a half disc, a handle, and the crook of it.
      return shape(X(0.02), Y(0.08), u(0.96), u(0.84), { prst: "pie", fill: color, adj: { adj1: 10800000, adj2: 0 } }) +
        rect(nid(), X(0.475), Y(0.48), u(0.05), u(0.38), color) +
        shape(X(0.3), Y(0.74), u(0.22), u(0.22), { prst: "arc", fill: null, line: color, lineW: u(0.05), adj: { adj1: 0, adj2: 10800000 } });
    case "brand":
      // A shopping bag.
      return shape(X(0.12), Y(0.34), u(0.76), u(0.6), { prst: "rect", fill: color }) +
        shape(X(0.3), Y(0.06), u(0.4), u(0.52), { prst: "arc", fill: null, line: color, lineW: u(0.06), adj: { adj1: 10800000, adj2: 0 } });
    case "platform":
      // A screen on a stand.
      return shape(X(0.02), Y(0.1), u(0.96), u(0.62), { prst: "roundRect", fill: color, adj: { adj: 8000 } }) +
        rect(nid(), X(0.09), Y(0.17), u(0.82), u(0.46), knock) +
        rect(nid(), X(0.16), Y(0.27), u(0.36), u(0.06), color) +
        rect(nid(), X(0.16), Y(0.4), u(0.5), u(0.06), color) +
        rect(nid(), X(0.44), Y(0.72), u(0.12), u(0.12), color) +
        rect(nid(), X(0.26), Y(0.84), u(0.48), u(0.06), color);
    case "client":
      // A person: a head and shoulders.
      return shape(X(0.31), Y(0.04), u(0.38), u(0.38), { prst: "ellipse", fill: color }) +
        shape(X(0.1), Y(0.5), u(0.8), u(0.46), { prst: "round2SameRect", fill: color, adj: { adj1: 50000, adj2: 0 } });
    case "warning":
      return shape(X(0.0), Y(0.04), u(1), u(0.9), {
        prst: "triangle", fill: color,
        text: [para("!", { face: HEADING, size: Math.max(1200, Math.round(s / EMU_PT * 55)), color: knock, bold: true, align: "ctr" })],
        anchor: "b", inset: [0, 0, 0, u(0.06)],
      });
    case "coins":
      return [0.6, 0.4, 0.2].map((f) =>
        shape(X(0.14), Y(f - 0.08), u(0.72), u(0.3), { prst: "can", fill: color, line: knock, lineW: u(0.03), adj: { adj: 35000 } })).join("");
  }
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────

type Run = { text: string; bold?: boolean; italic?: boolean; color?: string };

type ParaOpts = {
  face: string; size: number; color: string;
  bold?: boolean; italic?: boolean; align?: "l" | "ctr" | "r"; bullet?: boolean;
  /** The bullet's own colour, when it is not the text's. */
  bulletColor?: string;
  /** Letterspacing in hundredths of a point — caps set solid are a word, not a name. */
  spacing?: number;
  /** Percent, e.g. 140 for 1.4 lines. */
  lineSpacing?: number;
  spaceBefore?: number;
  /** A run set before the text, in another colour — the gold section number on a heading. */
  accent?: { text: string; color: string };
};

function para(text: string, o: ParaOpts): string {
  return rich([
    ...(o.accent ? [{ text: o.accent.text, color: o.accent.color }] : []),
    { text },
  ], o);
}

/** A paragraph of runs, each of which may be bold or another colour. */
function rich(runs: Run[], o: ParaOpts): string {
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
    ? (o.bulletColor ? `<a:buClr><a:srgbClr val="${o.bulletColor}"/></a:buClr>` : "") +
      `<a:buFont typeface="Arial"/><a:buChar char="${o.bulletColor ? "•" : "—"}"/>`
    : `<a:buNone/>`;
  const run = (r: Run) => {
    const bold = r.bold ?? o.bold;
    const italic = r.italic ?? o.italic;
    return `<a:r><a:rPr lang="it-IT" sz="${o.size}"${bold ? ` b="1"` : ""}${italic ? ` i="1"` : ""}` +
      `${o.spacing ? ` spc="${o.spacing}"` : ""} dirty="0">` +
      `<a:solidFill><a:srgbClr val="${r.color ?? o.color}"/></a:solidFill>` +
      `<a:latin typeface="${o.face}"/><a:cs typeface="${o.face}"/></a:rPr>` +
      `<a:t>${escapeXml(r.text)}</a:t></a:r>`;
  };
  const body = runs.filter((r) => r.text !== "").map(run).join("");
  // An empty paragraph still states its size, or it takes the theme's 18pt and props a
  // table cell open taller than its neighbours.
  const end = body ? "" : `<a:endParaRPr lang="it-IT" sz="${o.size}" dirty="0"/>`;
  return `<a:p><a:pPr${props}>${spacing}${bullet}</a:pPr>${body}${end}</a:p>`;
}

function textBox(
  id: number, x: number, y: number, cx: number, cy: number, paras: string[],
  // Where the text sits in a box taller than it needs. A short list pinned to the top of the
  // space left under a standfirst leaves a third of the slide empty and reads as a slide that
  // lost its last point; centred in the same space it reads as the slide it is.
  anchor?: "t" | "ctr" | "b",
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"` +
    `${anchor && anchor !== "t" ? ` anchor="${anchor}"` : ""}><a:normAutofit/></a:bodyPr>` +
    `<a:lstStyle/>${paras.join("") || `<a:p/>`}</p:txBody></p:sp>`;
}

function rect(
  id: number, x: number, y: number, cx: number, cy: number, fill: string,
  o: { lineColor?: string; lineWidth?: number; prst?: string } = {},
): string {
  const line = o.lineColor
    ? `<a:ln w="${o.lineWidth ?? 12700}"><a:solidFill><a:srgbClr val="${o.lineColor}"/></a:solidFill></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rect ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>` +
    `<a:prstGeom prst="${o.prst ?? "rect"}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${line}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

type ShapeOpts = {
  prst: string;
  /** null for an outline only. */
  fill?: string | null;
  line?: string; lineW?: number; dash?: "dash" | "sysDash";
  rot?: number; flipV?: boolean; flipH?: boolean;
  /** Preset adjust values, by guide name. */
  adj?: Record<string, number>;
  text?: string[]; anchor?: "t" | "ctr" | "b";
  /** Text insets in EMU — one value for all four, or [l, t, r, b]. */
  inset?: number | [number, number, number, number];
};

/** Any preset shape, optionally with text in it. */
function shape(x: number, y: number, cx: number, cy: number, o: ShapeOpts): string {
  const id = nid();
  const xfrmAttr = (o.rot ? ` rot="${o.rot}"` : "") + (o.flipH ? ` flipH="1"` : "") + (o.flipV ? ` flipV="1"` : "");
  const av = o.adj
    ? `<a:avLst>${Object.entries(o.adj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${v}"/>`).join("")}</a:avLst>`
    : `<a:avLst/>`;
  const fill = o.fill ? `<a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill>` : `<a:noFill/>`;
  const ln = o.line
    ? `<a:ln w="${o.lineW ?? 12700}"><a:solidFill><a:srgbClr val="${o.line}"/></a:solidFill>` +
      `${o.dash ? `<a:prstDash val="${o.dash}"/>` : ""}</a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  const ins = o.inset === undefined ? [91440, 45720, 91440, 45720]
    : typeof o.inset === "number" ? [o.inset, o.inset, o.inset, o.inset] : o.inset;
  const body = o.text
    ? `<p:txBody><a:bodyPr wrap="square" lIns="${ins[0]}" tIns="${ins[1]}" rIns="${ins[2]}" bIns="${ins[3]}"` +
      ` anchor="${o.anchor ?? "ctr"}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${o.text.join("")}</p:txBody>`
    : `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm${xfrmAttr}><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>` +
    `<a:prstGeom prst="${o.prst}">${av}</a:prstGeom>${fill}${ln}</p:spPr>${body}</p:sp>`;
}

/** A straight connector, horizontal or vertical, optionally with an arrowhead at its end. */
function line(
  x1: number, y1: number, x2: number, y2: number,
  o: { color: string; w: number; arrow?: boolean },
): string {
  const id = nid();
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(Math.min(x1, x2))}" y="${Math.round(Math.min(y1, y2))}"/>` +
    `<a:ext cx="${Math.round(Math.abs(x2 - x1))}" cy="${Math.round(Math.abs(y2 - y1))}"/></a:xfrm>` +
    `<a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
    `<a:ln w="${o.w}"><a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` +
    `${o.arrow ? `<a:tailEnd type="triangle" w="med" len="med"/>` : ""}</a:ln></p:spPr></p:cxnSp>`;
}

type Cell = {
  paras: string[]; fill: string | null; align?: "t" | "ctr" | "b";
  /** The rule under this cell, when it is not the table's hairline. */
  ruleColor?: string; ruleW?: number;
};
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
        (c.ruleColor
          ? `<a:lnB w="${c.ruleW ?? 6350}" cap="flat"><a:solidFill><a:srgbClr val="${c.ruleColor}"/></a:solidFill></a:lnB>`
          : o.rule
          ? `<a:lnB w="6350" cap="flat"><a:solidFill><a:srgbClr val="${RULE}"/></a:solidFill></a:lnB>`
          : `<a:lnB><a:noFill/></a:lnB>`);
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${c.paras.join("")}</a:txBody>` +
        `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="${c.align ?? "ctr"}">${rule}${fill}</a:tcPr></a:tc>`;
    }).join("");
    return `<a:tr h="${Math.round(r.height)}">${tcs}</a:tr>`;
  }).join("");

  return `<p:graphicFrame><p:nvGraphicFramePr>` +
    `<p:cNvPr id="${id}" name="Table ${id}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/>` +
    `</p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${widths.reduce((a, b) => a + b, 0)}" cy="${Math.round(rows.reduce((a, b) => a + b.height, 0))}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`;
}

/**
 * The footer: whose deck this is.
 *
 * AION's wordmark with "× HOUSE" beside it — the same lockup the intro deck carries on its
 * cover, repeated small. It is what stops fifteen slides of cream from reading as an internal
 * handout, and it is the one piece of furniture the generated decks did not have.
 *
 * It does NOT draw a page number, though it did for an afternoon. The deck is generated into
 * the teaser package and inherits its layout, and that layout already carries a slide-number
 * field — which the local proof render cannot show, because it builds its own blank layout.
 * So the first real build came back with "2 2" in the corner of every slide. The numbers were
 * there all along; what was missing was the lockup. Nothing else is drawn in that corner
 * either: every content shape stops at OPS_FLOOR.
 *
 * Not on the cover, which sets the lockup at full size in the middle of the page already.
 */
function footer(page: Page, slide: Slide, hasMark: boolean): string {
  const isCover = slide.kind === "section" && Boolean(slide.sub);
  if (isCover) return "";
  const y = MARK.y - 52000;
  // Beside the wordmark picture when there is one, and the whole lockup in type when there is
  // not — the local proof render has no picture, and a footer that silently disappears in the
  // one place the deck is checked is a footer nobody checks.
  const lockup = hasMark
    ? textBox(991, MARK.x + MARK.cx + 92000, y, 5000000, 320000, [
        para(`× ${page.brand}`, { face: HEADING, size: 1050, color: INK, spacing: 150 }),
      ])
    : textBox(991, MARK.x, y, 5000000, 320000, [
        para(`AION × ${page.brand}`, { face: HEADING, size: 1050, color: INK, spacing: 150 }),
      ]);
  return lockup;
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
