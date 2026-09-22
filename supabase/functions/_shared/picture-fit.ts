// Fitting a swapped photograph to the frame it lands in.
//
// A .pptx picture is two things that have nothing to do with each other: a frame on the
// slide (an <a:xfrm> box, fixed by whoever laid the slide out) and a source rectangle
// (<a:srcRect>, the part of the image that is shown). The shown part is then STRETCHED to
// fill the frame — that is what <a:stretch> means — so a picture only looks right when the
// two aspect ratios agree.
//
// In the teaser they agree because a human made them agree. Slide 10's middle frame is
// 1.113:1 and carries a 550×734 portrait cropped `t=5324 r=-729 b=26890`: the crop is
// tuned, by hand, to that one photograph. Swapping the bytes underneath keeps the crop and
// the frame and changes the only thing they were measured against, so a square packshot
// arrives cropped a quarter off its bottom and then squeezed 25% horizontally. That is the
// "immagini stretchate in modo strano" the decks came back with — and it is worst on the
// slides a human took the most care over, because those are the ones with a tuned crop.
//
// So the crop is recomputed for the picture that is actually there, two ways:
//
//   crop    the frame is kept and the image is cropped to it (CSS object-fit: cover). What
//           a square packshot wants in a 1.15:1 frame — 10% off the height, nothing
//           distorted, nothing meaningfully lost.
//
//   shrink  past `maxCrop`, cropping stops trimming the picture and starts cutting it up.
//           Instead the FRAME shrinks inside its own box to the image's own shape, centred.
//           It never grows, so it cannot collide with anything the layout put beside it; it
//           leaves slide background where the old picture reached, which is a visible,
//           honest gap rather than a stretched face or a beheaded one.
//
// Where the crop is taken from, and how much is allowed, both depend on what the picture IS,
// which the slot's role already says:
//
//   a packshot is centred in its own frame and has whitespace all round it, so the crop is
//   centred too and kept modest — past about a third the trim reaches the object, and half a
//   shoe is worse than a small whole one.
//
//   campaign photography is a person, and a person's face is in the top half. Equal slices
//   off the top and bottom is how a centre-crop decapitates them, so a third comes off the
//   top against two thirds off the bottom — the crop a picture editor would make — and more
//   of it is allowed, because a scene survives being cropped in a way an object does not.
//
// Horizontal crops are always centred: nothing here puts its subject off to one side.
//
// Both paths clear the template's hand-tuned srcRect, which is measured against a
// photograph that is no longer in the file.

/** A picture's frame on the slide, in EMU. */
export type Box = { x: number; y: number; cx: number; cy: number };

/** srcRect edges, in thousandths of a percent — the units <a:srcRect> is written in. */
export type SrcRect = { l: number; t: number; r: number; b: number };

export type Fit =
  | { mode: "crop"; srcRect: SrcRect; box: null; cropped: number }
  | { mode: "shrink"; srcRect: null; box: Box; cropped: 0 }
  | { mode: "exact"; srcRect: null; box: null; cropped: 0 };

/** How much of a picture may be cropped away, and from where — see the note above. */
export type FitRule = { maxCrop: number; anchor: "centre" | "top" };

/** An object in the middle of its own frame: trim the whitespace, do not cut the object. */
export const PACKSHOT: FitRule = { maxCrop: 0.35, anchor: "centre" };
/** A person, or a place with people in it: crop for the face, tolerate a deeper one. */
export const PHOTOGRAPH: FitRule = { maxCrop: 0.5, anchor: "top" };

/**
 * How to show `img` in `frame` without distorting it.
 *
 * `exact` means the two already agree to within a percent: no crop, no resize, just drop
 * whatever crop the template was carrying.
 */
export function fitPicture(
  frame: Box, img: { w: number; h: number }, rule: FitRule = PACKSHOT,
): Fit {
  const { maxCrop, anchor } = rule;
  if (!(frame.cx > 0 && frame.cy > 0 && img.w > 0 && img.h > 0)) {
    return { mode: "exact", srcRect: null, box: null, cropped: 0 };
  }
  const frameA = frame.cx / frame.cy;
  const imgA = img.w / img.h;
  const ratio = Math.min(frameA, imgA) / Math.max(frameA, imgA);

  // Within a percent the crop would be sub-pixel, and an empty srcRect reads better in the
  // file than four values that all round to nothing.
  if (ratio > 0.99) return { mode: "exact", srcRect: null, box: null, cropped: 0 };

  const cropped = 1 - ratio;
  if (cropped > maxCrop) {
    // Fit the frame to the picture, inside the box the layout gave it.
    const cx = imgA > frameA ? frame.cx : Math.round(frame.cy * imgA);
    const cy = imgA > frameA ? Math.round(frame.cx / imgA) : frame.cy;
    return {
      mode: "shrink",
      srcRect: null,
      box: {
        x: frame.x + Math.round((frame.cx - cx) / 2),
        y: frame.y + Math.round((frame.cy - cy) / 2),
        cx, cy,
      },
      cropped: 0,
    };
  }

  // Crop the long axis. 100000 = the whole edge.
  const gone = Math.round(cropped * 100000);
  if (imgA > frameA) {
    const off = Math.round(gone / 2);
    return { mode: "crop", box: null, srcRect: { l: off, t: 0, r: gone - off, b: 0 }, cropped };
  }
  const top = anchor === "top" ? Math.round(gone / 3) : Math.round(gone / 2);
  return { mode: "crop", box: null, srcRect: { l: 0, t: top, r: 0, b: gone - top }, cropped };
}

/** The frame of a <p:pic>, or null when the shape inherits its geometry from a layout. */
export function frameOf(pic: string): Box | null {
  const spPr = /<p:spPr[^>]*>[\s\S]*?<\/p:spPr>/.exec(pic)?.[0];
  if (!spPr) return null;
  // Scoped to spPr because <a:ext> is also the extension-list element: <a:ext uri="{...}">
  // appears in every cNvPr this deck has. Matching on cx/cy keeps the two apart.
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(spPr);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(spPr);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) };
}

/**
 * The same <p:pic>, fitted.
 *
 * Rewrites the srcRect (always — the template's belongs to a photograph that has been
 * replaced), normalises the fill to a plain stretch, and moves the frame when the fit asks
 * for it.
 */
export function applyFit(pic: string, fit: Fit): string {
  let out = pic;

  const srcRect = fit.srcRect
    ? `<a:srcRect${(["l", "t", "r", "b"] as const)
        .filter((k) => fit.srcRect![k] !== 0)
        .map((k) => ` ${k}="${fit.srcRect![k]}"`).join("")}/>`
    : "<a:srcRect/>";

  out = out.replace(/<p:blipFill[^>]*>[\s\S]*?<\/p:blipFill>/, (fill) => {
    let f = /<a:srcRect\b[^>]*\/>/.test(fill)
      ? fill.replace(/<a:srcRect\b[^>]*\/>/, srcRect)
      // No srcRect of its own: it goes after the blip, which is where the schema wants it.
      : fill.replace(/(<a:blip\b[^>]*\/>|<a:blip\b[\s\S]*?<\/a:blip>)/, `$1${srcRect}`);
    // A fillRect with offsets of its own would undo the crop we just computed, and
    // <a:stretch/> on its own is the same thing written shorter. Both become the plain form.
    f = /<a:stretch\b/.test(f)
      ? f.replace(/<a:stretch\b[^>]*\/>|<a:stretch\b[^>]*>[\s\S]*?<\/a:stretch>/, "<a:stretch><a:fillRect/></a:stretch>")
      : f.replace("</p:blipFill>", "<a:stretch><a:fillRect/></a:stretch></p:blipFill>");
    return f;
  });

  if (fit.mode === "shrink") {
    const box = fit.box;
    out = out.replace(/<p:spPr[^>]*>[\s\S]*?<\/p:spPr>/, (spPr) =>
      spPr
        .replace(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/, `<a:off x="${box.x}" y="${box.y}"/>`)
        .replace(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/, `<a:ext cx="${box.cx}" cy="${box.cy}"/>`));
  }
  return out;
}

/**
 * Fit the picture that embeds `relId` on a slide. Returns the slide unchanged, and says
 * why, when there is nothing safe to do.
 */
export function fitPictureInSlide(
  xml: string, relId: string, img: { w: number; h: number } | null, rule: FitRule = PACKSHOT,
): { xml: string; fit: Fit | null; why?: string } {
  const pic = (xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [])
    .find((p) => new RegExp(`r:embed="${relId}"`).test(p));
  if (!pic) return { xml, fit: null, why: "no picture on the slide embeds it" };

  // Dimensions unreadable (a GIF, say). The template's crop is still wrong for this file, so
  // it goes; the picture is shown whole and stretched, which is the old behaviour and is
  // reported rather than hidden.
  if (!img) {
    return {
      xml: xml.replace(pic, applyFit(pic, { mode: "exact", srcRect: null, box: null, cropped: 0 })),
      fit: null,
      why: "its pixel dimensions could not be read, so it was not fitted",
    };
  }

  const frame = frameOf(pic);
  if (!frame) return { xml, fit: null, why: "the picture has no frame of its own to fit to" };

  const fit = fitPicture(frame, img, rule);
  return { xml: xml.replace(pic, applyFit(pic, fit)), fit };
}
