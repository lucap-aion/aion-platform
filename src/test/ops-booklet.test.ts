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
