import { describe, it, expect } from "vitest";
import { opsBooklet, type Slide } from "../../supabase/functions/_shared/ops-booklet.ts";
import { slideXml } from "../../supabase/functions/_shared/pptx-slides.ts";

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

  it("sets the section number of a heading in the gold", () => {
    // "2. Attivazione della polizza" — two runs, one paragraph.
    const xml = slideXml(steps[0], null);
    expect(xml).toContain("<a:t>2. </a:t>");
    expect(xml).toContain("<a:t>Attivazione della polizza</a:t>");
  });
});

describe("the deck's furniture", () => {
  const page = { index: 4, of: booklet.length, brand: "EXAMPLE" };

  it("puts the section a slide belongs to above its title", () => {
    // "SLA — tempi di risposta della compagnia assicurativa" is a claims slide and said so
    // nowhere. Every slide that is not the one opening its section now carries the section.
    const sla = booklet.find((s) => s.title?.startsWith("SLA"))!;
    expect(sla.eyebrow).toBe("3. Apertura e gestione dei sinistri");
    expect(slideXml(sla, null)).toContain("<a:t>3. Apertura e gestione dei sinistri</a:t>");
  });

  it("names the house and the page at the foot of every slide but the cover", () => {
    const cover = booklet[0] as Extract<Slide, { kind: "section" }>;
    expect(cover.sub).toBe("Example Maison S.p.A.");
    // The cover sets the lockup full size in the middle of the page; it is not repeated
    // small underneath it, and covers are not numbered.
    const coverXml = slideXml(cover, null, { ...page, index: 1 });
    expect(coverXml).not.toContain("AION × EXAMPLE");
    expect(coverXml).not.toContain(`<a:t>1</a:t>`);

    const xml = slideXml(booklet[3], null, page);
    expect(xml).toContain("<a:t>AION × EXAMPLE</a:t>");
    expect(xml).toContain("<a:t>4</a:t>");
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
