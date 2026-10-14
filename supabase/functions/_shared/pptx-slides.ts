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

// ── The figure slides ───────────────────────────────────────────────────────────────────
//
// The business case is a pricing deck, and a pricing deck is figures: what is covered, what
// the premium is, what AION charges, what one piece costs. Set as bullets — "Gross premium
// €331,800" in the middle of a sentence — it read as an internal note, which is what "the
// deck UI is too poor" was about. These four kinds draw the same figures the way the ops
// deck draws its flows: key numbers on tiles, a table that can be read across the room, bars
// whose length is the money, and one card per rate saying where it came from.

/** A key figure: the number set large, what it is under it, and a qualifier under that. */
export type Tile = { value: string; label: string; note?: string; strong?: boolean };

/** What every figure slide's header takes. `key` is the phrase set in bold; `badge` the pill. */
type FigureHead = { title: string; key?: string; badge?: string; lead?: string; eyebrow?: string };

export type FigureSlide =
  | (FigureHead & {
      /** A row of key-figure tiles, then a table or a row of explanatory cards under it. */
      kind: "metrics"; tiles: Tile[];
      table?: {
        head: string[]; rows: string[][];
        /** A closing row set in bold on the gold rail — the perimeter's total. */
        total?: string[];
        /** Right-aligned columns: figures line up on their units. */
        numeric?: boolean[];
        /** Column widths as shares of the table. */
        shares?: number[];
      };
      cards?: { title: string; body: string }[];
    })
  | (FigureHead & {
      /** One row per item with a horizontal bar as long as its value, then an equation strip. */
      kind: "bars";
      captions?: [string, string, string];
      rows: {
        label: string; sub?: string;
        /** The middle column's figure — a rate — and what qualifies it. */
        figure: string; figureSub?: string; tag?: string;
        value: number; valueText: string;
      }[];
      equation?: { terms: { label: string; value: string; strong?: boolean }[]; ops: ("minus" | "plus" | "equal")[] };
    })
  | (FigureHead & {
      /** Stacked horizontal bars on one scale — a cost split into who it goes to. */
      kind: "stack";
      bars: { label: string; sub?: string; total: string; parts: { label: string; value: number; text: string }[] }[];
      tiles?: Tile[];
      notes?: string[];
    })
  | (FigureHead & {
      /** One card per source, under a warning that cannot be skimmed past when there is one. */
      kind: "sources";
      warning?: { label: string; body: string };
      cards: { title: string; sub?: string; figure: string; unit?: string; lines: string[]; tag?: string }[];
      notes?: string[];
    });

/** Every slide the renderer draws: the booklet's shapes and the figure slides. */
export type DeckSlide = Slide | FigureSlide;

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
export function slideXml(slide: DeckSlide, markRelId: string | null, page?: Page): string {
  nextId = 100;
  const body = (() => {
    switch (slide.kind) {
      case "section": return sectionSlide(slide);
      case "bullets": return page ? bulletsSlide(slide) : plainBulletsSlide(slide);
      case "flow": return flowSlide(slide);
      case "steps": return stepsSlide(slide);
      case "table": return tableSlide(slide);
      case "callout": return calloutSlide(slide);
      case "metrics": return metricsSlide(slide);
      case "bars": return barsSlide(slide);
      case "stack": return stackSlide(slide);
      case "sources": return sourcesSlide(slide);
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

// ── Figure slides ───────────────────────────────────────────────────────────────────────

const figureHeader = (s: FigureHead) =>
  opsHeader(s.title, s.lead, undefined, s.eyebrow, { key: s.key, badge: s.badge });

/** A muted, letterspaced column caption — "SEGMENT", "RATE". */
const caption = (t: string, align?: "l" | "ctr" | "r") =>
  para(t.toUpperCase(), { face: BODY, size: 950, color: MUTED, bold: true, spacing: 120, align });

/** On an ink ground, the muted colour that still reads. */
const MUTED_ON_INK = "C9BFAE";
/** The gold, lightened twice — for the smaller shares of a stacked bar. */
const GOLD_2 = "DDBE85";
const GOLD_3 = "EEDCB8";
/** The ink, lightened — the second insurance-side share. */
const INK_2 = "5A534B";

// Tiles ────────────────────────────────────────────────────────────────────

const TILE_GAP = 180000;
const TILE_PAD = 200000;
const TILE_TOP = 40000;

/** How a row of tiles lays out in a width: one figure size for the row, so they line up. */
/**
 * How a row of tiles lays out in a width: one figure size for the row, so they line up.
 * `compact` takes air out of the tile and a step off the figure, for a slide that has a bar
 * chart above its tiles.
 */
function tileLayout(tiles: Tile[], w: number, compact = false) {
  const n = Math.max(1, tiles.length);
  const tileW = Math.floor((w - TILE_GAP * (n - 1)) / n);
  const textW = tileW - 2 * TILE_PAD;
  const padY = compact ? 110000 : 170000;
  // A figure never wraps: "€4,200," over "000" is not a number anybody can read.
  const vSize = pickSize((compact ? [2800, 2600] : [3400, 3000, 2800, 2600]).concat([2400, 2200, 2000, 1800]), (z) =>
    tiles.every((t) => textWidth(t.value, z, HEADING) <= 0.92 * textW));
  const valueH = Math.round(vSize / 100 * 1.25 * EMU_PT);
  const labelH = Math.max(...tiles.map((t) => boldH(t.label, textW, 1400, HEADING, 105)));
  const noteH = Math.max(0, ...tiles.map((t) => (t.note ? textH(t.note, textW, 1100, BODY, 120) : 0)));
  const h = TILE_TOP + padY + valueH + 90000 + 19050 + 110000 + labelH + (noteH ? 50000 + noteH : 0) + padY;
  return { tileW, textW, vSize, valueH, labelH, noteH, h, padY };
}

function tilesXml(tiles: Tile[], x: number, y: number, w: number, compact = false): string {
  const L = tileLayout(tiles, w, compact);
  let xml = "";
  tiles.forEach((t, i) => {
    const tx = x + i * (L.tileW + TILE_GAP);
    const ix = tx + TILE_PAD;
    let cy = y + TILE_TOP + L.padY;
    xml +=
      shape(tx, y, L.tileW, L.h, { prst: "rect", fill: t.strong ? INK : WHITE, line: t.strong ? undefined : RULE, lineW: 9525 }) +
      rect(nid(), tx, y, L.tileW, TILE_TOP, GOLD) +
      textBox(nid(), ix, cy, L.textW, L.valueH, [
        para(t.value, { face: HEADING, size: L.vSize, color: GOLD, bold: true }),
      ], "b");
    cy += L.valueH + 90000;
    xml += rect(nid(), ix, cy, 360000, 19050, GOLD);
    cy += 19050 + 110000;
    xml += textBox(nid(), ix, cy, L.textW, L.labelH + 30000, [
      para(t.label, { face: HEADING, size: 1400, color: t.strong ? BG : INK, bold: true, lineSpacing: 105 }),
    ]);
    cy += L.labelH + 50000;
    if (t.note) {
      xml += textBox(nid(), ix, cy, L.textW, L.noteH + 30000, [
        para(t.note, { face: BODY, size: 1100, color: t.strong ? MUTED_ON_INK : MUTED, lineSpacing: 120 }),
      ]);
    }
  });
  return xml;
}

// A data table ─────────────────────────────────────────────────────────────

type DataTable = NonNullable<Extract<FigureSlide, { kind: "metrics" }>["table"]>;

/** The table's layout in a width and a height: the largest text and the most air that fit. */
function dataTableLayout(t: DataTable, w: number, avail: number) {
  const cols = Math.max(1, t.head.length);
  const shares = t.shares && t.shares.length === cols ? t.shares : Array(cols).fill(1 / cols);
  const sum = shares.reduce((a, b) => a + b, 0);
  const widths = shares.map((f) => Math.round(w * f / sum));
  widths[cols - 1] = w - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  const pad = 2 * 91440;
  const headH = 400000;
  const rows = [...t.rows, ...(t.total ? [t.total] : [])];
  const rowH = (r: string[], z: number, air: number) =>
    Math.max(...r.map((c, i) => textH(c, widths[i] - pad, i === 0 ? z + 100 : z, i === 0 ? HEADING : BODY, 100)))
      + 2 * 45720 + air;
  for (const air of [150000, 100000, 50000, 10000]) {
    for (const z of [1300, 1200, 1100, 1000]) {
      const heights = rows.map((r) => rowH(r, z, air));
      const h = headH + heights.reduce((a, b) => a + b, 0);
      if (h <= avail) return { widths, headH, size: z, heights, h, fits: true };
    }
  }
  const heights = rows.map((r) => rowH(r, 1000, 10000));
  const h = headH + heights.reduce((a, b) => a + b, 0);
  return { widths, headH, size: 1000, heights, h, fits: h <= avail };
}

function dataTableXml(t: DataTable, x: number, y: number, L: ReturnType<typeof dataTableLayout>): string {
  const num = (i: number) => Boolean(t.numeric?.[i]);
  const rows: Row[] = [
    {
      height: L.headH,
      cells: t.head.map((h, i) => ({
        paras: [para(h, { face: BODY, size: 1050, color: BG, bold: true, spacing: 50, align: num(i) ? "r" : "l" })],
        fill: INK, ruleColor: GOLD, ruleW: 28575,
      })),
    },
    ...t.rows.map((r, k) => ({
      height: L.heights[k],
      cells: r.map((c, i) => ({
        paras: [para(c, {
          face: i === 0 ? HEADING : BODY, size: i === 0 ? L.size + 100 : L.size,
          color: INK, bold: i === 0, align: num(i) ? "r" as const : "l" as const,
        })],
        fill: k % 2 === 1 ? BAND : WHITE,
        // The last row before the total carries the gold rule the total is read against.
        ...(t.total && k === t.rows.length - 1 ? { ruleColor: GOLD, ruleW: 19050 } : {}),
      })),
    })),
    ...(t.total
      ? [{
          height: L.heights[t.rows.length],
          cells: t.total.map((c, i) => ({
            paras: [para(c, {
              face: i === 0 ? HEADING : BODY, size: i === 0 ? L.size + 100 : L.size,
              color: INK, bold: true, align: num(i) ? "r" as const : "l" as const,
            })],
            fill: NUMBER_RAIL,
          })),
        }]
      : []),
  ];
  return table(nid(), x, y, L.widths, rows, { rule: true });
}

// Explanatory cards ────────────────────────────────────────────────────────

function noteCardsLayout(cards: { title: string; body: string }[], w: number, maxH: number) {
  const n = Math.max(1, cards.length);
  const gap = 200000;
  const cw = Math.floor((w - gap * (n - 1)) / n);
  const pad = 220000;
  const textW = cw - 2 * pad - 50000;
  const titleH = Math.max(...cards.map((c) => textH(c.title, textW, 1500, HEADING, 105)));
  const bodyH = (z: number) => Math.max(...cards.map((c) => textH(c.body, textW, z, BODY, 135)));
  const size = pickSize([1350, 1250, 1150, 1100, 1000], (z) => titleH + 110000 + bodyH(z) + 2 * pad <= maxH);
  const h = Math.min(maxH, titleH + 110000 + bodyH(size) + 2 * pad);
  return { gap, cw, pad, textW, titleH, size, h };
}

function noteCardsXml(cards: { title: string; body: string }[], x: number, y: number, L: ReturnType<typeof noteCardsLayout>): string {
  return cards.map((c, i) => {
    const cx = x + i * (L.cw + L.gap);
    const ix = cx + 50000 + L.pad;
    return shape(cx, y, L.cw, L.h, { prst: "rect", fill: WHITE, line: RULE, lineW: 9525 }) +
      rect(nid(), cx, y, 50000, L.h, GOLD) +
      textBox(nid(), ix, y + L.pad, L.textW, L.titleH + 30000, [
        para(c.title, { face: HEADING, size: 1500, color: INK, bold: true, lineSpacing: 105 }),
      ]) +
      textBox(nid(), ix, y + L.pad + L.titleH + 110000, L.textW, L.h - 2 * L.pad - L.titleH - 110000 + 40000, [
        para(c.body, { face: BODY, size: L.size, color: INK, lineSpacing: 135 }),
      ]);
  }).join("");
}

/** A panel of notes: a gold rule down its left edge, each note a gold-bulleted line. */
function notesLayout(notes: string[], w: number, maxH: number) {
  const pad = 160000;
  const textW = w - 50000 - 2 * pad;
  const capH = 220000;
  const listH = (z: number) => notes.reduce((a, t) => a + textH(t, textW, z, BODY, 125) + Math.round(z / 100 * 0.35 * EMU_PT), 0);
  const need = (z: number) => capH + listH(z) + 2 * pad;
  const size = pickSize([1300, 1200, 1100, 1050, 1000, 950], (z) => need(z) <= maxH);
  // `fits` is false when even the smallest size overflows `maxH` — the caller then has to
  // find the room elsewhere, because the panel is drawn at its full height regardless.
  return { pad, textW, capH, size, h: need(size), fits: need(size) <= maxH };
}

function notesXml(notes: string[], x: number, y: number, w: number, L: ReturnType<typeof notesLayout>): string {
  return shape(x, y, w, L.h, { prst: "rect", fill: NUMBER_RAIL, line: RULE, lineW: 9525 }) +
    rect(nid(), x, y, 50000, L.h, GOLD) +
    textBox(nid(), x + 50000 + L.pad, y + L.pad - 30000, L.textW, L.capH, [caption("Notes")]) +
    textBox(nid(), x + 50000 + L.pad, y + L.pad + L.capH, L.textW, L.h - 2 * L.pad - L.capH + 40000,
      notes.map((t, k) => para(t, {
        face: BODY, size: L.size, color: INK, bullet: true, bulletColor: GOLD, lineSpacing: 125,
        spaceBefore: k ? Math.round(L.size * 0.35) : 0,
      })));
}

/** A small pill — the "INDICATIVE" on a rate's card. */
function pill(x: number, y: number, text: string, o: { fill?: string; color?: string } = {}): { xml: string; w: number; h: number } {
  const size = 950;
  const w = Math.round(textWidth(text, size, BODY) * 1.15) + 280000;
  const h = 300000;
  return {
    w, h,
    xml: shape(x, y, w, h, {
      prst: "roundRect", fill: o.fill ?? WHITE, line: GOLD, lineW: 12700, adj: { adj: 50000 },
      text: [para(text, { face: BODY, size, color: o.color ?? INK, bold: true, align: "ctr", spacing: 100 })],
      anchor: "ctr", inset: 0,
    }),
  };
}

// metrics ──────────────────────────────────────────────────────────────────

/**
 * Key figures on tiles, then what they are made of: the perimeter's segments as a table, or
 * the fee structure as a row of cards. The two blocks are centred together in the room.
 */
function metricsSlide(s: Extract<FigureSlide, { kind: "metrics" }>): string {
  const top = figureHeader(s);
  const avail = OPS_FLOOR - top.y;
  // A perimeter of six segments needs the room the tiles' air takes: step down to compact
  // tiles and a tighter gap before letting the table's text shrink past legibility.
  const plan = (compact: boolean) => {
    const T = tileLayout(s.tiles, CONTENT_W, compact);
    const gap = compact ? 200000 : 300000;
    const rest = avail - T.h - gap;
    const tl = s.table ? dataTableLayout(s.table, CONTENT_W, rest) : null;
    const cl = !tl && s.cards?.length ? noteCardsLayout(s.cards, CONTENT_W, rest) : null;
    return { compact, T, gap, tl, cl, fits: !tl || tl.fits };
  };
  const loose = plan(false);
  const { compact, T, gap, tl, cl } = loose.fits ? loose : plan(true);
  const belowH = tl ? tl.h : cl ? cl.h : 0;
  const total = T.h + (belowH ? gap + belowH : 0);
  const y = top.y + Math.max(0, Math.round((avail - total) / 2));
  return top.xml + tilesXml(s.tiles, M, y, CONTENT_W, compact) +
    (tl ? dataTableXml(s.table!, M, y + T.h + gap, tl) : "") +
    (cl ? noteCardsXml(s.cards!, M, y + T.h + gap, cl) : "");
}

// bars ─────────────────────────────────────────────────────────────────────

/**
 * One row per item: its name, the figure that drives it, and a bar as long as its value on a
 * track as long as the largest — so the split of the premium reads before any number does.
 * Under the rows, an equation in tiles: gross − fee = net.
 */
function barsSlide(s: Extract<FigureSlide, { kind: "bars" }>): string {
  const top = figureHeader(s);
  const avail = OPS_FLOOR - top.y;
  const n = Math.max(1, s.rows.length);
  // Past three rows the slide runs compact: the rate's qualifier and its source tag share one
  // line, rows lose some air and the equation strip slims down. Six segments drawn at the
  // three-segment spacing overprinted one another.
  const compact = n > 3;
  const eqH = s.equation ? (compact ? 720000 : 950000) : 0;
  const eqGap = s.equation ? (compact ? 160000 : 320000) : 0;
  const capH = s.captions ? (compact ? 240000 : 300000) : 0;
  const rowPad = compact ? 40000 : 120000;
  /** Under the rate: its qualifier and its tag, as separate lines — or one, when compact. */
  const figRuns = (r: (typeof s.rows)[number]): Run[][] => {
    const sub = r.figureSub ? [{ text: r.figureSub }] : [];
    const tag = r.tag ? [{ text: r.tag, bold: true, color: GOLD }] : [];
    if (!compact) return [sub, tag].filter((x) => x.length);
    const both = [...sub, ...(sub.length && tag.length ? [{ text: " · " }] : []), ...tag];
    return both.length ? [both] : [];
  };
  const runsText = (rs: Run[]) => rs.map((x) => x.text).join("");

  // Compact, the rate column is wider: its one merged line is the longest thing in the row.
  const labelW = Math.round(CONTENT_W * (compact ? 0.27 : 0.29));
  const figW = Math.round(CONTENT_W * (compact ? 0.3 : 0.25));
  const barX = M + labelW + figW + 150000;
  const barArea = M + CONTENT_W - barX;
  const maxVal = Math.max(1, ...s.rows.map((r) => r.value));
  const valSize = 1800;
  const valW = Math.max(...s.rows.map((r) => textWidth(r.valueText, valSize, HEADING))) + 160000;
  const track = barArea - valW;

  const lw = labelW - 150000;
  const fw = figW - 100000;
  const block = (z: number) => {
    const sub = Math.round(z * 0.73);
    const label = Math.max(...s.rows.map((r) =>
      boldH(r.label, lw, z, HEADING, 105) + (r.sub ? 40000 + textH(r.sub, lw, sub, BODY, 115) : 0)));
    const fig = Math.max(...s.rows.map((r) => figH(r, z, sub)));
    return Math.max(label, fig, 340000);
  };
  const figH = (r: (typeof s.rows)[number], z: number, sub: number) =>
    Math.round((z + 400) / 100 * 1.2 * EMU_PT) +
    figRuns(r).reduce((a, rs) => a + 30000 + boldH(runsText(rs), fw, sub, BODY, 115), 0);
  const rowsRoom = avail - eqH - eqGap - capH;
  const size = pickSize([1600, 1500, 1400, 1300, 1200, 1100, 1000], (z) => n * (block(z) + 2 * rowPad) <= rowsRoom);
  const subSize = Math.round(size * 0.73);
  // Never shorter than what the row holds: a row squeezed under its text overprints the next.
  const rowH = Math.max(block(size) + 2 * rowPad, Math.min(Math.floor(rowsRoom / n), 800000));
  const total = capH + n * rowH + eqGap + eqH;
  const y0 = top.y + Math.max(0, Math.round((avail - total) / 2));

  let xml = "";
  if (s.captions) {
    xml +=
      textBox(nid(), M, y0, labelW, capH, [caption(s.captions[0])], "ctr") +
      textBox(nid(), M + labelW, y0, figW, capH, [caption(s.captions[1])], "ctr") +
      textBox(nid(), barX, y0, barArea, capH, [caption(s.captions[2])], "ctr") +
      rect(nid(), M, y0 + capH - 9525, CONTENT_W, 9525, INK);
  }
  const barH = Math.min(340000, Math.round(rowH * 0.4));
  s.rows.forEach((r, i) => {
    const y = y0 + capH + i * rowH;
    const mid = y + Math.round(rowH / 2);
    const lb = boldH(r.label, lw, size, HEADING, 105) + (r.sub ? 40000 + textH(r.sub, lw, subSize, BODY, 115) : 0);
    const fb = figH(r, size, subSize);
    const len = Math.max(30000, Math.round(track * r.value / maxVal));
    xml +=
      (i % 2 === 1 ? rect(nid(), M, y, CONTENT_W, rowH, BAND) : "") +
      textBox(nid(), M + 100000, mid - Math.round(lb / 2), lw, lb + 40000, [
        para(r.label, { face: HEADING, size, color: INK, bold: true, lineSpacing: 105 }),
        ...(r.sub ? [para(r.sub, { face: BODY, size: subSize, color: MUTED, lineSpacing: 115, spaceBefore: 300 })] : []),
      ]) +
      textBox(nid(), M + labelW, mid - Math.round(fb / 2), fw, fb + 40000, [
        para(r.figure, { face: HEADING, size: size + 400, color: INK, bold: true }),
        ...figRuns(r).map((rs) => rich(rs, { face: BODY, size: subSize, color: MUTED, lineSpacing: 115, spaceBefore: 200 })),
      ]) +
      // The track is the largest bar's length: a bar is read against it, not against nothing.
      rect(nid(), barX, mid - Math.round(barH / 2), track, barH, i % 2 === 1 ? WHITE : BAND) +
      rect(nid(), barX, mid - Math.round(barH / 2), len, barH, INK) +
      rect(nid(), barX, mid - Math.round(barH / 2), Math.min(len, 36000), barH, GOLD) +
      textBox(nid(), barX + track + 120000, mid - 220000, valW - 120000, 440000, [
        para(r.valueText, { face: HEADING, size: valSize, color: INK, bold: true }),
      ], "ctr") +
      rect(nid(), M, y + rowH - 9525, CONTENT_W, 9525, RULE);
  });

  if (s.equation) {
    const ey = y0 + capH + n * rowH + eqGap;
    const terms = s.equation.terms;
    const opW = 560000;
    const tw = Math.floor((CONTENT_W - opW * (terms.length - 1)) / terms.length);
    const vz = pickSize((compact ? [2200, 2000] : [2800, 2600, 2400, 2200, 2000]), (z) =>
      terms.every((t) => textWidth(t.value, z, HEADING) <= 0.9 * (tw - 400000)));
    const capY = compact ? 90000 : 150000;
    const valY = compact ? 300000 : 380000;
    terms.forEach((t, i) => {
      const tx = M + i * (tw + opW);
      xml +=
        shape(tx, ey, tw, eqH, { prst: "rect", fill: t.strong ? INK : WHITE, line: t.strong ? GOLD : RULE, lineW: t.strong ? 19050 : 9525 }) +
        textBox(nid(), tx + 200000, ey + capY, tw - 400000, 260000, [caption(t.label)]) +
        textBox(nid(), tx + 200000, ey + valY, tw - 400000, eqH - valY - (compact ? 60000 : 120000), [
          para(t.value, { face: HEADING, size: vz, color: t.strong ? GOLD : INK, bold: true }),
        ], "ctr");
      const op = s.equation!.ops[i];
      if (i < terms.length - 1 && op) {
        const prst = op === "minus" ? "mathMinus" : op === "plus" ? "mathPlus" : "mathEqual";
        xml += shape(tx + tw + opW / 2 - 200000, ey + eqH / 2 - 200000, 400000, 400000, { prst, fill: GOLD });
      }
    });
  }
  return top.xml + xml;
}

// stack ────────────────────────────────────────────────────────────────────

/** The colours of a stacked bar's shares, in order: ink for the first, the golds after. */
const STACK_FILLS = [INK, GOLD, GOLD_2, GOLD_3, INK_2];
const onFill = (fill: string) => (fill === INK || fill === INK_2 ? BG : INK);

/**
 * The stack slide's spacing, most generous first. A slide with two bars and a notes panel, or
 * one bar and a row of tiles, does not fit at the generous spacing — the first proof ran its
 * notes into the footer — so the layout steps down until everything is above the floor.
 */
const STACK_DIMS = [
  { barH1: 560000, barHn: 440000, labelH: 440000, subH: 280000, legendLineH: 300000, barGap: 340000, gap: 330000, compact: false },
  { barH1: 470000, barHn: 380000, labelH: 410000, subH: 260000, legendLineH: 280000, barGap: 260000, gap: 250000, compact: true },
  { barH1: 400000, barHn: 320000, labelH: 380000, subH: 250000, legendLineH: 260000, barGap: 200000, gap: 190000, compact: true },
];

/**
 * Stacked horizontal bars on one scale: each a total, split into who it goes to. A share wide
 * enough carries its figure inside; every share is named in a legend under the bar, so a
 * sliver of €2 is still accounted for. Tiles and a notes panel can follow.
 */
function stackSlide(s: Extract<FigureSlide, { kind: "stack" }>): string {
  const top = figureHeader(s);
  const avail = OPS_FLOOR - top.y;
  const scale = Math.max(1, ...s.bars.map((b) => b.parts.reduce((a, p) => a + Math.max(0, p.value), 0)));
  const legendSize = 1150;
  const swatch = 150000;
  type Bar = (typeof s.bars)[number];

  // The legend wraps when its items do not fit on one line.
  const legendRows = (b: Bar) => {
    const rows: { x: number; text: string; fill: string }[][] = [[]];
    let x = 0;
    b.parts.forEach((p, k) => {
      if (p.value <= 0) return;
      const text = `${p.label}  ${p.text}`;
      const w = swatch + 90000 + textWidth(text, legendSize, BODY) + 320000;
      if (x > 0 && x + w > CONTENT_W) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ x, text, fill: STACK_FILLS[k % STACK_FILLS.length] });
      x += w;
    });
    return rows;
  };

  const plan = (D: (typeof STACK_DIMS)[number]) => {
    const barH = s.bars.length > 1 ? D.barHn : D.barH1;
    const subH = (b: Bar) => (b.sub ? Math.max(D.subH, textH(b.sub, CONTENT_W, 1150, BODY, 110) + 40000) : 0);
    const block = (b: Bar) => D.labelH + subH(b) + 80000 + barH + 120000 + legendRows(b).length * D.legendLineH;
    const barsH = s.bars.reduce((a, b) => a + block(b), 0) + D.barGap * Math.max(0, s.bars.length - 1);
    const T = s.tiles?.length ? tileLayout(s.tiles, CONTENT_W, D.compact) : null;
    const rest = avail - barsH - (T ? D.gap + T.h : 0) - D.gap;
    const NL = s.notes?.length ? notesLayout(s.notes, CONTENT_W, rest) : null;
    const total = barsH + (T ? D.gap + T.h : 0) + (NL ? D.gap + NL.h : 0);
    return { D, barH, subH, T, NL, total, fits: total <= avail && (!NL || NL.fits) };
  };
  const P = STACK_DIMS.map(plan).find((p) => p.fits) ?? plan(STACK_DIMS[STACK_DIMS.length - 1]);
  const { D, barH, T, NL } = P;
  let y = top.y + Math.max(0, Math.round((avail - P.total) / 2));

  let xml = "";
  for (const b of s.bars) {
    const totalW = textWidth(b.total, 2400, HEADING) + 200000;
    xml +=
      textBox(nid(), M, y, CONTENT_W - totalW, D.labelH, [
        para(b.label, { face: HEADING, size: 1700, color: INK, bold: true }),
      ], "b") +
      textBox(nid(), M + CONTENT_W - totalW, y, totalW, D.labelH, [
        para(b.total, { face: HEADING, size: 2400, color: GOLD, bold: true, align: "r" }),
      ], "b");
    y += D.labelH;
    if (b.sub) {
      const sh = P.subH(b);
      xml += textBox(nid(), M, y + 30000, CONTENT_W, sh - 30000, [
        para(b.sub, { face: BODY, size: 1150, color: MUTED, lineSpacing: 110 }),
      ]);
      y += sh;
    }
    y += 80000;
    const full = Math.round(CONTENT_W * b.parts.reduce((a, p) => a + Math.max(0, p.value), 0) / scale);
    // The track: the longest bar's length, so the shorter one reads as shorter.
    xml += rect(nid(), M, y, CONTENT_W, barH, BAND);
    let x = M;
    const live = b.parts.map((p, k) => ({ p, k })).filter(({ p }) => p.value > 0);
    live.forEach(({ p, k }, j) => {
      // The last share takes the rounding, so the bar ends exactly where its total says.
      const w = j === live.length - 1 ? M + full - x : Math.round(CONTENT_W * p.value / scale);
      const fill = STACK_FILLS[k % STACK_FILLS.length];
      xml += rect(nid(), x, y, w, barH, fill);
      const tz = barH >= 460000 ? 1500 : 1300;
      if (textWidth(p.text, tz, HEADING) + 200000 <= w) {
        xml += textBox(nid(), x + 100000, y, w - 200000, barH, [
          para(p.text, { face: HEADING, size: tz, color: onFill(fill), bold: true, align: "ctr" }),
        ], "ctr");
      }
      // A hairline of the ground between shares, so two golds side by side stay two.
      if (j > 0) xml += rect(nid(), x - 6350, y, 12700, barH, BG);
      x += w;
    });
    y += barH + 120000;
    for (const row of legendRows(b)) {
      for (const it of row) {
        xml +=
          rect(nid(), M + it.x, y + Math.round((D.legendLineH - swatch) / 2) - 20000, swatch, swatch, it.fill,
            it.fill === GOLD_3 ? { lineColor: GOLD, lineWidth: 6350 } : {}) +
          textBox(nid(), M + it.x + swatch + 90000, y, textWidth(it.text, legendSize, BODY) + 240000, D.legendLineH - 40000, [
            para(it.text, { face: BODY, size: legendSize, color: INK }),
          ], "ctr");
      }
      y += D.legendLineH;
    }
    y += D.barGap;
  }
  y -= D.barGap;
  if (T) {
    y += D.gap;
    xml += tilesXml(s.tiles!, M, y, CONTENT_W, D.compact);
    y += T.h;
  }
  if (NL) {
    y += D.gap;
    xml += notesXml(s.notes!, M, y, CONTENT_W, NL);
  }
  return top.xml + xml;
}

// sources ──────────────────────────────────────────────────────────────────

/**
 * Where each figure came from: a card per source, its rate set large, its provenance as a few
 * lines under it — and, above them all when the figures are not yet this house's own, an ink
 * block with the hazard sign that says so in a sentence. Under the cards, the model's notes.
 *
 * The three blocks are sized together: the first proof sized the cards first and handed the
 * notes whatever was left, and the notes ran into the footer.
 */
function sourcesSlide(s: Extract<FigureSlide, { kind: "sources" }>): string {
  const top = figureHeader(s);
  const avail = OPS_FLOOR - top.y;

  // The warning.
  const blockW = 2300000;
  const wPad = 170000;
  const wTextW = CONTENT_W - blockW - 2 * wPad;
  const warnPlan = (z: number, min: number) =>
    s.warning ? Math.max(min, textH(s.warning.body, wTextW, z, BODY, 135) + 2 * wPad) : 0;

  // The cards. Wide enough, a card sets its rate in a column to the left of its lines; narrow,
  // the rate goes above them.
  const n = s.cards.length;
  const perRow = n <= 4 ? Math.max(1, n) : Math.ceil(n / Math.ceil(n / 4));
  const rowsN = Math.max(1, Math.ceil(n / perRow));
  const cGap = 200000;
  const cw = Math.floor((CONTENT_W - cGap * (perRow - 1)) / perRow);
  const wide = cw >= 3800000;
  const pad = 170000;
  const figColW = wide ? 1500000 : 0;
  const linesW = cw - 2 * pad - (wide ? figColW + 190000 : 0);
  const headTitle = 1400;
  const headW = cw - 2 * pad;
  const tagW = (c: Card) => (c.tag && wide ? pill(0, 0, c.tag.toUpperCase()).w + 120000 : 0);
  const headH = n
    ? Math.max(...s.cards.map((c) =>
        boldH(c.title, headW - tagW(c), headTitle, HEADING, 105) +
        (c.sub ? 30000 + textH(c.sub, headW - tagW(c), 1050, BODY, 110) : 0))) + 2 * 120000
    : 0;
  const figBlock = 560000 + 260000; // the rate and its unit
  const tagH = 300000;
  type Card = (typeof s.cards)[number];
  const lineH = (t: string, k: number, z: number) =>
    (k === 0 ? boldH(t, linesW, z, BODY, 120) : textH(t, linesW, z, BODY, 120)) + Math.round(z / 100 * 0.3 * EMU_PT);
  const linesH = (c: Card, z: number) => c.lines.reduce((a, t, k) => a + lineH(t, k, z), 0);
  // A wide card carries its pill in the header, where there is room beside the title; a
  // narrow one at its foot. In the body of a wide card it made the rate's column the tallest
  // thing on the slide, and the notes went through the footer.
  const cardBody = (c: Card, z: number) => wide
    ? Math.max(figBlock, linesH(c, z))
    : figBlock + 100000 + linesH(c, z) + (c.tag ? 120000 + tagH : 0);
  const cardH = (z: number) => headH + 30000 + 2 * pad + Math.max(0, ...s.cards.map((c) => cardBody(c, z)));

  // More than three sources do not fit as cards under a warning and the notes — six came out
  // twice the height of the slide. They are drawn as a banded list instead: a row per rate,
  // its name, its rate, its provenance on two lines, and its pill.
  const listMode = n > 3;
  const lCapH = 250000;
  const lPad = 60000;
  const lTitleW = Math.round(CONTENT_W * 0.22);
  const lFigW = Math.round(CONTENT_W * 0.12);
  const lTagW = listMode ? Math.max(0, ...s.cards.map((c) => (c.tag ? pill(0, 0, c.tag.toUpperCase()).w + 120000 : 0))) : 0;
  const lLinesW = CONTENT_W - lTitleW - lFigW - lTagW - 3 * 120000;
  const listParas = (c: Card) => [c.lines[0] ?? "", c.lines.slice(1).join(" · ")].filter(Boolean);
  const listRowH = (c: Card, z: number) => Math.max(
    boldH(c.title, lTitleW, z + 100, HEADING, 105) + (c.sub ? 20000 + textH(c.sub, lTitleW, z - 100, BODY, 110) : 0),
    Math.round((z + 700) / 100 * 1.2 * EMU_PT),
    listParas(c).reduce((a, t, k) => a + (k === 0 ? boldH(t, lLinesW, z, BODY, 115) : textH(t, lLinesW, z, BODY, 115)), 0),
  ) + 2 * lPad;
  const listH = (z: number) => lCapH + s.cards.reduce((a, c) => a + listRowH(c, z), 0);

  type Plan = { gap: number; wSize: number; warnH: number; cSize: number; ch: number; cardsH: number;
    NL: ReturnType<typeof notesLayout> | null; total: number; fits: boolean };
  const plans: Plan[] = [];
  for (const gap of [240000, 180000, 140000]) {
    for (const [wz, wmin] of [[1500, 900000], [1350, 800000], [1200, 700000], [1100, 600000]] as const) {
      for (const cSize of [1250, 1150, 1100, 1050, 1000, 950]) {
        const warnH = warnPlan(wz, wmin);
        const ch = n && !listMode ? cardH(cSize) : 0;
        const cardsH = !n ? 0 : listMode ? listH(cSize) : rowsN * ch + cGap * (rowsN - 1);
        const used = (warnH ? warnH + gap : 0) + cardsH;
        const NL = s.notes?.length ? notesLayout(s.notes, CONTENT_W, avail - used - (cardsH || warnH ? gap : 0)) : null;
        const total = used + (NL ? (cardsH || warnH ? gap : 0) + NL.h : 0) - (!cardsH && warnH ? gap : 0);
        plans.push({ gap, wSize: wz, warnH, cSize, ch, cardsH, NL, total, fits: total <= avail && (!NL || NL.fits) });
      }
    }
  }
  const P = plans.find((p) => p.fits) ?? plans.reduce((a, b) => (b.total < a.total ? b : a));
  const { gap, warnH, cSize, ch, cardsH, NL } = P;
  let y = top.y + Math.max(0, Math.round((avail - P.total) / 2));

  let xml = "";
  if (s.warning) {
    const ic = 420000;
    const labelW = blockW - 200000 - ic - 160000 - 100000;
    const label = s.warning.label.toUpperCase();
    // Letterspaced caps on one line: sized from the word's own width plus its spacing.
    const lz = pickSize([1700, 1600, 1500, 1400, 1300, 1200], (z) =>
      textWidth(label, z, HEADING) * 1.08 + label.length * 150 / 100 * EMU_PT <= labelW);
    xml +=
      shape(M, y, CONTENT_W, warnH, { prst: "rect", fill: WHITE, line: GOLD, lineW: 19050 }) +
      shape(M, y, blockW, warnH, { prst: "rect", fill: INK }) +
      icon("warning", M + 200000 + ic / 2, y + warnH / 2, ic, GOLD, INK) +
      textBox(nid(), M + 200000 + ic + 160000, y, labelW, warnH, [
        para(label, { face: HEADING, size: lz, color: GOLD, bold: true, spacing: 150 }),
      ], "ctr") +
      textBox(nid(), M + blockW + wPad, y + wPad, wTextW, warnH - 2 * wPad, [
        para(s.warning.body, { face: BODY, size: P.wSize, color: INK, lineSpacing: 135 }),
      ], "ctr");
    y += warnH + gap;
  }

  if (listMode) {
    const xT = M + 100000;
    const xF = M + lTitleW + 120000;
    const xL = xF + lFigW + 120000;
    xml +=
      textBox(nid(), xT, y, lTitleW, lCapH, [caption("Rate")], "ctr") +
      textBox(nid(), xF, y, lFigW, lCapH, [caption("Of COGS")], "ctr") +
      textBox(nid(), xL, y, lLinesW, lCapH, [caption("Where it comes from")], "ctr") +
      rect(nid(), M, y + lCapH - 9525, CONTENT_W, 9525, INK);
    let ry = y + lCapH;
    s.cards.forEach((c, i) => {
      const h = listRowH(c, cSize);
      const paras = listParas(c);
      const tH = boldH(c.title, lTitleW, cSize + 100, HEADING, 105) + (c.sub ? 20000 + textH(c.sub, lTitleW, cSize - 100, BODY, 110) : 0);
      const lH = paras.reduce((a, t, k) => a + (k === 0 ? boldH(t, lLinesW, cSize, BODY, 115) : textH(t, lLinesW, cSize, BODY, 115)), 0);
      xml +=
        (i % 2 === 1 ? rect(nid(), M, ry, CONTENT_W, h, BAND) : "") +
        (c.tag ? rect(nid(), M, ry, 40000, h, GOLD) : "") +
        textBox(nid(), xT, ry + Math.round((h - tH) / 2), lTitleW - 100000, tH + 30000, [
          para(c.title, { face: HEADING, size: cSize + 100, color: INK, bold: true, lineSpacing: 105 }),
          ...(c.sub ? [para(c.sub, { face: BODY, size: cSize - 100, color: MUTED, lineSpacing: 110, spaceBefore: 150 })] : []),
        ]) +
        textBox(nid(), xF, ry, lFigW, h, [para(c.figure, { face: HEADING, size: cSize + 700, color: GOLD, bold: true })], "ctr") +
        textBox(nid(), xL, ry + Math.round((h - lH) / 2), lLinesW, lH + 30000,
          paras.map((t, k) => para(t, { face: BODY, size: cSize, color: k ? MUTED : INK, bold: k === 0, lineSpacing: 115 }))) +
        (c.tag ? pill(M + CONTENT_W - lTagW + 120000, ry + Math.round((h - 300000) / 2), c.tag.toUpperCase(), { fill: GOLD }).xml : "") +
        rect(nid(), M, ry + h - 9525, CONTENT_W, 9525, RULE);
      ry += h;
    });
  }
  if (!listMode) s.cards.forEach((c, i) => {
    const r = Math.floor(i / perRow);
    const x = M + (i % perRow) * (cw + cGap);
    const cy = y + r * (ch + cGap);
    xml +=
      shape(x, cy, cw, ch, { prst: "rect", fill: WHITE, line: c.tag ? GOLD : RULE, lineW: c.tag ? 12700 : 9525, dash: c.tag ? "dash" : undefined }) +
      shape(x, cy, cw, headH, { prst: "rect", fill: INK }) +
      rect(nid(), x, cy + headH, cw, 30000, GOLD) +
      textBox(nid(), x + pad, cy, headW - tagW(c), headH, [
        para(c.title, { face: HEADING, size: headTitle, color: BG, bold: true, lineSpacing: 105 }),
        ...(c.sub ? [para(c.sub, { face: BODY, size: 1050, color: MUTED_ON_INK, lineSpacing: 110, spaceBefore: 200 })] : []),
      ], "ctr");
    const by = cy + headH + 30000 + pad;
    const fx = x + pad;
    xml +=
      textBox(nid(), fx, by, wide ? figColW : headW, 560000, [
        para(c.figure, { face: HEADING, size: 3200, color: GOLD, bold: true }),
      ], "b") +
      textBox(nid(), fx, by + 580000, wide ? figColW : headW, 240000, [
        para(c.unit ?? "", { face: BODY, size: 1100, color: MUTED, spacing: 60 }),
      ]);
    if (c.tag) {
      xml += wide
        ? pill(x + cw - pad - tagW(c) + 120000, cy + Math.round((headH - 300000) / 2), c.tag.toUpperCase(), { fill: GOLD }).xml
        : pill(fx, cy + ch - pad - tagH, c.tag.toUpperCase(), { fill: GOLD }).xml;
    }
    const lx = wide ? fx + figColW + 150000 : fx;
    const ly = wide ? by : by + figBlock + 100000;
    xml += (wide ? rect(nid(), lx - 80000, by, 9525, ch - headH - 30000 - 2 * pad, RULE) : "") +
      textBox(nid(), lx + (wide ? 40000 : 0), ly, linesW, linesH(c, cSize) + 60000,
        c.lines.map((t, k) => para(t, {
          face: BODY, size: cSize, color: INK, bold: k === 0, lineSpacing: 120,
          spaceBefore: k ? Math.round(cSize * 0.3) : 0,
        })));
  });
  if (cardsH) y += cardsH + gap;
  if (NL) xml += notesXml(s.notes!, M, y, CONTENT_W, NL);
  return top.xml + xml;
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
  // The figure slides' two additions: the phrase to set in bold when the preposition rule
  // would cut it ("Cost per piece" is one phrase, not "Cost" and the rest), and a pill that
  // says something other than a part number — "Indicative", on every page it is true of.
  opts: { key?: string; badge?: string } = {},
): { xml: string; y: number } {
  const badge = opts.badge ?? (part && part.of > 1 ? `${part.index} / ${part.of}` : null);
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
  const badgeSize = opts.badge ? 1150 : 1400;
  const badgeW = badge
    ? Math.max(1000000, Math.round(textWidth(badge, badgeSize, BODY) * 1.12) + (opts.badge ? 360000 : 0))
    : 0;
  const titleW = badge ? CONTENT_W - badgeW - 300000 : CONTENT_W;
  const size = textH(text, titleW, 2800, HEADING, 100) > 2800 / 100 * 1.25 * EMU_PT ? 2400 : 2800;
  const runs: Run[] = opts.key && text.startsWith(opts.key)
    ? [{ text: opts.key, bold: true }, { text: text.slice(opts.key.length) }]
    : headline(text);
  xml += textBox(nid(), M, OPS_TITLE_Y, titleW, OPS_TITLE_H, [
    rich(runs, { face: HEADING, size, color: INK }),
  ], "ctr");
  if (badge) {
    // A part number is a quiet pill; a free-text badge is a warning, so it is gold and loud.
    xml += shape(M + CONTENT_W - badgeW, OPS_TITLE_Y + (OPS_TITLE_H - 440000) / 2, badgeW, 440000, {
      prst: "roundRect", fill: opts.badge ? GOLD : WHITE, line: GOLD, lineW: 15875, adj: { adj: 50000 },
      text: [para(opts.badge ? badge.toUpperCase() : badge, {
        face: BODY, size: badgeSize, color: INK, bold: true, align: "ctr", spacing: opts.badge ? 120 : undefined,
      })],
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

/** A string's advance in em. Figures and € are set at the capitals' width. */
function emWidth(text: string, face: string): number {
  const a = ADVANCE[face] ?? ADVANCE[BODY];
  return [...text].reduce((t, ch) =>
    t + (/[A-ZÀ-Ý0-9%@€]/.test(ch) ? a.upper : /[.,;:'’()\/|·—–-]/.test(ch) ? 0.3 : /\s/.test(ch) ? a.space : a.lower), 0);
}

/** A single line's width in EMU at a size — for a figure that must not wrap. */
function textWidth(text: string, size: number, face: string): number {
  return Math.ceil(emWidth(text, face) * (size / 100) * EMU_PT);
}

function lineCount(text: string, width: number, size: number, face: string): number {
  const a = ADVANCE[face] ?? ADVANCE[BODY];
  // 6% short of the box: a line that fits by a hair in the estimate is the line that wraps in
  // the renderer, which breaks a little early and kerns differently.
  const room = 0.94 * width / (size / 100 * EMU_PT);
  const wordW = (w: string) => emWidth(w, face);
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

/**
 * The same for text set entirely in bold, measured a tenth narrower: the advances above are
 * the regular weights with a margin, and a bold label that "fits by a hair" — "Average price
 * per piece" — is the one that wraps onto the line under it.
 */
function boldH(text: string, width: number, size: number, face: string, lineSpacing = 100): number {
  return textH(text, width * 0.9, size, face, lineSpacing);
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
function footer(page: Page, slide: DeckSlide, hasMark: boolean): string {
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
