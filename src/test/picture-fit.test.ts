import { describe, it, expect } from "vitest";
import {
  fitPicture, frameOf, applyFit, fitPictureInSlide, PACKSHOT, PHOTOGRAPH,
} from "../../supabase/functions/_shared/picture-fit.ts";

// The real thing, lifted out of slide 10 of AION_Teaser_2026-09-16.pptx: the middle of the
// three benefit slots. It is the case that made Giulio open the Prada deck — a 1.113:1 frame
// carrying a hand-tuned crop (t=5324 r=-729 b=26890) measured against a 550×734 portrait. Any
// fixture invented for this would leave out exactly the parts that bite: the negative edge,
// the <a:blip> with children, and the two <a:extLst> blocks whose <a:ext uri="..."> elements
// share a tag name with the frame's <a:ext cx="..." cy="...">.
const PIC = `<p:pic><p:nvPicPr><p:cNvPr id="14" name="Picture 4" descr="Overstyling in Jewelry: Bvlgari Case"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{8B97AA6D-E1FF-62F6-1296-B1DC89C72159}"/></a:ext></a:extLst></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill rotWithShape="1"><a:blip r:embed="rId6"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst></a:blip><a:srcRect t="5324" r="-729" b="26890"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr bwMode="auto"><a:xfrm><a:off x="4560930" y="1908806"/><a:ext cx="2769510" cy="2487345"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 4281"/></a:avLst></a:prstGeom><a:noFill/><a:extLst><a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}"><a14:hiddenFill xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a14:hiddenFill></a:ext></a:extLst></p:spPr></p:pic>`;

const FRAME = { x: 4560930, y: 1908806, cx: 2769510, cy: 2487345 };  // 1.113:1

const srcRectOf = (xml: string) => /<a:srcRect\b[^>]*\/>/.exec(xml)?.[0];
const frameAfter = (xml: string) => frameOf(xml)!;

describe("reading the frame", () => {
  it("reads the picture's own box, not an extension list's <a:ext>", () => {
    expect(frameOf(PIC)).toEqual(FRAME);
  });

  it("says so when the shape inherits its geometry", () => {
    expect(frameOf(PIC.replace(/<a:xfrm>[\s\S]*?<\/a:xfrm>/, ""))).toBeNull();
  });
});

describe("choosing a fit", () => {
  it("crops a square packshot evenly into a slightly wider frame", () => {
    const fit = fitPicture(FRAME, { w: 1000, h: 1000 }, PACKSHOT);
    expect(fit.mode).toBe("crop");
    // 1 − 1/1.1134 of the height goes, half off each edge: the object is in the middle.
    expect(fit.srcRect).toEqual({ l: 0, t: 5094, r: 0, b: 5094 });
    expect(fit.cropped).toBeCloseTo(0.1019, 3);
  });

  it("takes more off the bottom than the top of a photograph, so a face survives", () => {
    const fit = fitPicture(FRAME, { w: 550, h: 734 }, PHOTOGRAPH);   // the slot's own portrait
    expect(fit.mode).toBe("crop");
    expect(fit.srcRect!.b).toBeGreaterThan(fit.srcRect!.t * 1.9);
    expect(fit.srcRect!.t + fit.srcRect!.b).toBeCloseTo(fit.cropped * 100000, 0);
  });

  it("would rather show a whole packshot small than cut a third off it", () => {
    // A 4:5 Prada packshot in slide 4's 1.5:1 frame: 47% of the height would go.
    const wide = { x: 0, y: 0, cx: 5804054, cy: 3871161 };
    expect(fitPicture(wide, { w: 2400, h: 3000 }, PACKSHOT).mode).toBe("shrink");
    // The same frame with a boutique photograph in it is a scene, and crops.
    expect(fitPicture(wide, { w: 2400, h: 3000 }, PHOTOGRAPH).mode).toBe("crop");
  });

  it("centre-crops the width when the picture is the wider one", () => {
    const fit = fitPicture(FRAME, { w: 911, h: 510 }, PHOTOGRAPH);   // slide 10's right-hand slot
    expect(fit.mode).toBe("crop");
    expect(fit.srcRect!.t).toBe(0);
    expect(fit.srcRect!.b).toBe(0);
    expect(Math.abs(fit.srcRect!.l - fit.srcRect!.r)).toBeLessThanOrEqual(1);   // an odd total splits by one
    expect(fit.srcRect!.l).toBeGreaterThan(0);
  });

  it("leaves an already-matching picture uncropped", () => {
    expect(fitPicture(FRAME, { w: 1113, h: 1000 }).mode).toBe("exact");
  });

  it("shrinks the frame rather than cutting most of a picture away", () => {
    const fit = fitPicture(FRAME, { w: 800, h: 2000 }, PHOTOGRAPH);   // 0.4:1 — a third would remain
    expect(fit.mode).toBe("shrink");
    const box = fit.box!;
    // The picture's own shape, inside the box the layout gave it, centred on it.
    expect(box.cy).toBe(FRAME.cy);
    expect(box.cx / box.cy).toBeCloseTo(800 / 2000, 3);
    expect(box.cx).toBeLessThan(FRAME.cx);
    expect(box.x + box.cx / 2).toBeCloseTo(FRAME.x + FRAME.cx / 2, 0);
    expect(box.y).toBe(FRAME.y);
  });

  it("never grows a frame, so a shrunk picture cannot collide with the layout", () => {
    for (const img of [{ w: 800, h: 2000 }, { w: 1200, h: 300 }, { w: 400, h: 1600 }]) {
      const fit = fitPicture(FRAME, img, PHOTOGRAPH);
      if (fit.mode !== "shrink") continue;
      expect(fit.box.cx).toBeLessThanOrEqual(FRAME.cx);
      expect(fit.box.cy).toBeLessThanOrEqual(FRAME.cy);
    }
  });

  it("refuses to divide by a missing dimension", () => {
    expect(fitPicture(FRAME, { w: 0, h: 0 }).mode).toBe("exact");
    expect(fitPicture({ ...FRAME, cy: 0 }, { w: 10, h: 10 }).mode).toBe("exact");
  });
});

describe("writing the fit back", () => {
  it("replaces the template's hand-tuned crop, negative edge and all", () => {
    const out = applyFit(PIC, fitPicture(FRAME, { w: 1000, h: 1000 }));
    expect(out).not.toContain('t="5324"');
    expect(out).not.toContain('r="-729"');
    expect(srcRectOf(out)).toBe('<a:srcRect t="5094" b="5094"/>');
  });

  it("drops the crop entirely when the shapes already agree", () => {
    const out = applyFit(PIC, fitPicture(FRAME, { w: 1113, h: 1000 }));
    expect(srcRectOf(out)).toBe("<a:srcRect/>");
    expect(frameAfter(out)).toEqual(FRAME);   // an exact fit moves nothing
  });

  it("moves the frame for a shrink, and only the frame", () => {
    const fit = fitPicture(FRAME, { w: 800, h: 2000 }, PHOTOGRAPH);
    const out = applyFit(PIC, fit);
    expect(frameAfter(out)).toEqual(fit.box);
    expect(srcRectOf(out)).toBe("<a:srcRect/>");
    // The extension lists are untouched — their <a:ext uri="..."> is not a frame.
    expect(out).toContain('<a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}">');
    expect(out).toContain('<a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}">');
    expect(out).toContain('prst="roundRect"');
  });

  it("gives a blipFill with no crop of its own one, after the blip", () => {
    const bare = PIC.replace('<a:srcRect t="5324" r="-729" b="26890"/>', "");
    const out = applyFit(bare, fitPicture(FRAME, { w: 1000, h: 1000 }));
    expect(out).toContain('</a:blip><a:srcRect t="5094" b="5094"/><a:stretch>');
  });

  it("normalises a short or offset stretch, which would undo the crop", () => {
    for (const fill of ["<a:stretch/>", '<a:stretch><a:fillRect l="-8000" r="-8000"/></a:stretch>']) {
      const out = applyFit(PIC.replace("<a:stretch><a:fillRect/></a:stretch>", fill), fitPicture(FRAME, { w: 1000, h: 1000 }));
      expect(out).toContain("<a:stretch><a:fillRect/></a:stretch>");
      expect(out).not.toContain('l="-8000"');
    }
  });
});

describe("fitting the picture on a slide", () => {
  const SLIDE = `<p:sld><p:cSld><p:spTree>${PIC.replace('r:embed="rId6"', 'r:embed="rId9"')}${PIC}</p:spTree></p:cSld></p:sld>`;

  it("fits the picture that embeds the relationship, and leaves its neighbour alone", () => {
    const { xml, fit } = fitPictureInSlide(SLIDE, "rId6", { w: 1000, h: 1000 });
    expect(fit!.mode).toBe("crop");
    expect(xml).toContain('<a:srcRect t="5094" b="5094"/>');
    expect(xml).toContain('<a:srcRect t="5324" r="-729" b="26890"/>');   // rId9's, untouched
  });

  it("clears a crop it cannot recompute, and says why", () => {
    const { xml, fit, why } = fitPictureInSlide(SLIDE, "rId6", null);
    expect(fit).toBeNull();
    expect(why).toMatch(/dimensions/);
    // The template's crop belonged to a photograph that is no longer in the file.
    expect(xml).toContain("<a:srcRect/>");
    expect(xml).toContain('<a:srcRect t="5324" r="-729" b="26890"/>');   // rId9's, untouched
  });

  it("changes nothing when no picture embeds the relationship", () => {
    const { xml, fit, why } = fitPictureInSlide(SLIDE, "rId42", { w: 1000, h: 1000 });
    expect(xml).toBe(SLIDE);
    expect(fit).toBeNull();
    expect(why).toMatch(/no picture/);
  });
});
