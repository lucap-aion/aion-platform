import { describe, it, expect } from "vitest";
import { opsBooklet, type Slide } from "../../supabase/functions/_shared/ops-booklet.ts";
import { slideXml, SLIDE_W } from "../../supabase/functions/_shared/pptx-slides.ts";

const booklet = opsBooklet({ legalName: "Example Maison S.p.A.", shortName: "Example" });
const steps = booklet.filter((s): s is Extract<Slide, { kind: "steps" }> => s.kind === "steps");

describe("the operations booklet's numbered flows", () => {
  it("carries a flow across two slides without restarting it", () => {
    // Both flows are longer than a slide holds. Cut in two and renumbered from 1, the deck
    // says there are four short flows rather than two long ones — "slide 4 should be 2/2 and
    // the numbers should start at 9".
    const seconds = steps.filter((s) => s.part?.index === 2);
    expect(seconds.length).toBe(2);

    for (const second of seconds) {
      const i = booklet.indexOf(second);
      const first = booklet[i - 1];
      expect(first.kind).toBe("steps");
      const part1 = first as Extract<Slide, { kind: "steps" }>;
      // Same flow: same heading, first half, and the second half picks up where it stopped.
      expect(part1.title).toBe(second.title);
      expect(part1.part).toEqual({ index: 1, of: 2 });
      expect(second.start).toBe(part1.steps.length + 1);
    }
  });

  it("draws those numbers, and the part, on the slide", () => {
    const second = steps.find((s) => s.part?.index === 2 && s.start === 9)!;
    const xml = slideXml(second, null);
    // The ninth step is numbered 9, not 1, and the header says which half this is.
    expect(xml).toContain("<a:t>9</a:t>");
    expect(xml).not.toContain("<a:t>1</a:t>");
    expect(xml).toContain("<a:t>2 / 2</a:t>");
  });

  it("puts the section number on the tab and sets the heading's key phrase in bold", () => {
    // "2. Attivazione della polizza": the 2 on the ink tab at the slide's edge, the heading
    // as "**Attivazione** della polizza" — the reference deck's headline.
    const xml = slideXml(steps[0], null);
    expect(xml).toContain("<a:t>2</a:t>");
    expect(xml).toMatch(/b="1"[^>]*>(?:(?!<\/a:r>).)*<a:t>Attivazione<\/a:t>/);
    expect(xml).toContain("<a:t> della polizza</a:t>");
    expect(xml).not.toContain("<a:t>2. </a:t>");
  });

  it("draws a flow as numbered circles on a line, carried off the page and back", () => {
    const [first, second] = steps.filter((s) => s.title === steps[0].title);
    const a = slideXml(first, null);
    const b = slideXml(second, null);
    expect(a).toContain(`prst="ellipse"`);
    expect(a).toContain("<p:cxnSp>");
    // The first half's line runs off the right edge; the second half's comes in from x=0.
    const lines = (xml: string) =>
      [...xml.matchAll(/<p:cxnSp>.*?<a:off x="(-?\d+)" y="\d+"\/><a:ext cx="(\d+)" cy="0"\/>/g)]
        .map((m) => ({ from: Number(m[1]), to: Number(m[1]) + Number(m[2]) }));
    expect(lines(a).some((l) => l.to === SLIDE_W)).toBe(true);
    expect(lines(a).some((l) => l.from === 0)).toBe(false);
    expect(lines(b).some((l) => l.from === 0)).toBe(true);
    expect(lines(b).some((l) => l.to === SLIDE_W)).toBe(false);
  });
});

describe("the deck's furniture", () => {
  const page = { brand: "EXAMPLE" };

  it("puts the section a slide belongs to above its title", () => {
    // "SLA — tempi di risposta della compagnia assicurativa" is a claims slide and said so
    // nowhere. Every slide that is not the one opening its section now carries the section.
    const sla = booklet.find((s) => s.title?.startsWith("SLA"))!;
    expect(sla.eyebrow).toBe("3. Apertura e gestione dei sinistri");
    expect(slideXml(sla, null)).toContain("<a:t>3. Apertura e gestione dei sinistri</a:t>");
  });

  it("names the house at the foot of every slide but the cover", () => {
    const cover = booklet[0] as Extract<Slide, { kind: "section" }>;
    expect(cover.sub).toBe("Example Maison S.p.A.");
    // The cover sets the lockup full size in the middle of the page; it is not repeated
    // small underneath it.
    expect(slideXml(cover, null, page)).not.toContain("AION × EXAMPLE");
    expect(slideXml(booklet[3], null, page)).toContain("<a:t>AION × EXAMPLE</a:t>");
  });

  it("leaves the page number to the template that already draws one", () => {
    // The deck is generated into the teaser package and inherits its layout, which carries a
    // slide-number field. Drawing our own put "2 2" in the corner of every slide — and the
    // local proof render could not show it, because it builds its own blank layout.
    const xml = slideXml(booklet[3], null, page);
    expect(xml).not.toMatch(/<a:t>4<\/a:t>/);
  });

  it("draws the contents as the same six sections the deck is made of", () => {
    const flow = booklet.find((s): s is Extract<Slide, { kind: "flow" }> => s.kind === "flow")!;
    // Every chevron is a section that follows it, in order — a contents page that cannot
    // disagree with its own deck.
    const openers = booklet
      .filter((s) => /^\d+\.\s/.test(s.title ?? ""))
      .map((s) => s.title!.replace(/^\d+\.\s+/, ""));
    expect([...new Set(openers)]).toEqual(flow.items);
    expect(slideXml(flow, null)).toContain(`prst="chevron"`);
  });
});

describe("the graphic pass changes the drawing, not the words", () => {
  const page = { brand: "EXAMPLE" };
  const unescape = (t: string) =>
    t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  /** Every paragraph on a slide, its runs joined — what a reader sees, line by line. */
  const paragraphs = (xml: string) =>
    [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) =>
      unescape([...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("")));
  const heading = (t: string) => t.replace(/^\d+\.\s+/, "");

  it("keeps every string of the booklet on its slide", () => {
    for (const s of booklet) {
      const ps = paragraphs(slideXml(s, null, page));
      const want: string[] = [];
      switch (s.kind) {
        case "section": want.push(s.title, ...(s.sub ? [s.sub.toUpperCase()] : []), ...(s.lead ? [s.lead] : [])); break;
        case "flow": want.push(s.title, ...(s.lead ? [s.lead] : []), ...s.items); break;
        case "bullets": want.push(heading(s.title), ...(s.lead ? [s.lead] : []), ...s.bullets); break;
        case "steps": want.push(heading(s.title), ...(s.lead ? [s.lead] : []), ...s.steps); break;
        case "table":
          want.push(heading(s.title), ...(s.lead ? [s.lead] : []));
          // Cards and key-figure tiles carry their own labels in place of a heading row.
          if (s.display !== "cards" && s.display !== "figures") want.push(...s.head);
          for (const r of s.rows) {
            if (s.display === "cards") want.push(r[0], ...r[1].split(/\s+·\s+/));
            else want.push(...r);
          }
          break;
        case "callout": want.push(s.title, ...s.label.split(/\s+=\s+/), s.body); break;
      }
      for (const w of want) expect(ps, `${s.title}: "${w}"`).toContain(w);
    }
  });

  it("gives every shape on a slide its own id, and writes well-formed XML", () => {
    for (const s of booklet) {
      const xml = slideXml(s, "rId2", page);
      const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, s.title).toBe(ids.length);
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      expect(doc.getElementsByTagName("parsererror").length, s.title).toBe(0);
    }
  });

  it("leaves the business case's plain bullet slide as it was", () => {
    // The business case deck passes no footer and has its own title-and-bullets look; the
    // ops deck's header band, tab and cards are not for it.
    const xml = slideXml({ kind: "bullets", title: "Why now", bullets: ["One", "Two"] }, null);
    expect(xml).not.toContain(`prst="roundRect"`);
    expect(xml).toContain(`<a:buChar char="—"/>`);
  });
});
