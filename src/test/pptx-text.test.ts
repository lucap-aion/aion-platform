import { describe, it, expect } from "vitest";
import { mergeTwinRuns, slideText } from "../../supabase/functions/_shared/pptx-text.ts";

const fill = `<a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill><a:latin typeface="Georgia"/>`;

describe("runs split for no visible reason", () => {
  // Verbatim shape of slide 6 in the 2026-11-04 teaser.
  const slide = `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="it-IT" sz="600" dirty="0">${fill}</a:rPr><a:t>Leather </a:t></a:r>` +
    `<a:r><a:rPr lang="it-IT" sz="600" dirty="0" err="1">${fill}</a:rPr><a:t>bag</a:t></a:r><a:endParaRPr lang="it-IT" sz="600"/></a:p>`;

  it("joins a phrase that differs only by a spell-check flag", () => {
    expect(slide.includes("Leather bag")).toBe(false);
    expect(slideText(slide)).toBe("Leather bag");
    const merged = mergeTwinRuns(slide);
    expect(merged).toContain("<a:t>Leather bag</a:t>");
    expect(merged.match(/<a:r>/g)).toHaveLength(1);
  });

  it("keeps runs apart when they are drawn differently", () => {
    const bold = slide.replace('err="1"', 'b="1"');
    expect(mergeTwinRuns(bold)).toBe(bold);
  });

  it("does not run a self-closing rPr into the next run", () => {
    const xml = `<a:p><a:r><a:rPr lang="en-US"/><a:t>A</a:t></a:r><a:r><a:rPr lang="en-US" sz="900">${fill}</a:rPr><a:t>B</a:t></a:r></a:p>`;
    expect(mergeTwinRuns(xml)).toBe(xml);
  });
});
