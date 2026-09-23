#!/usr/bin/env -S npx tsx
/**
 * The operations booklet, rendered to PNGs on this machine.
 *
 *   npx tsx scripts/proof-deck.mts [--out dir] [--slide 5]
 *
 * WHY THIS EXISTS. The deck is generated inside an edge function, into a template that lives
 * in a private bucket, and the only way to look at the result was to press Build on a brand
 * page and download the file. That is a slow loop for typography, and typography is most of
 * what an ops deck is — so every graphic change was being made blind and checked by somebody
 * else, on a client's copy.
 *
 * The real `renderDeck` reaches for the teaser only to INHERIT its theme and masters; the
 * slides themselves are drawn entirely by `slideXml`. So a minimal package built around the
 * same call — one master, one blank layout, one theme — shows exactly what the slides look
 * like, with no storage and no Supabase. What it cannot show is anything inherited from the
 * teaser, which is the wordmark picture and nothing else.
 *
 * Requires LibreOffice (`soffice`) and poppler (`pdftoppm`), both already used elsewhere here.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { opsBooklet } from "../supabase/functions/_shared/ops-booklet.ts";
import { slideXml, SLIDE_W, SLIDE_H } from "../supabase/functions/_shared/pptx-slides.ts";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const outDir = arg("out", "/tmp/aion-deck-proof");
const only = Number(arg("slide", "0"));

const slides = opsBooklet({ legalName: "Example Maison S.p.A.", shortName: "Example" });
const chosen = only ? [slides[only - 1]] : slides;

const rels = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;

const zip = new JSZip();

zip.file("_rels/.rels", rels(
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`));

// One theme, referenced by the master. Its colours do not matter — every fill and face on a
// generated slide is stated explicitly — but a master without a theme will not open.
zip.file("ppt/theme/theme1.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AION">` +
  `<a:themeElements><a:clrScheme name="AION">` +
  `<a:dk1><a:srgbClr val="262626"/></a:dk1><a:lt1><a:srgbClr val="FAF7F2"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="262626"/></a:dk2><a:lt2><a:srgbClr val="FAF7F2"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="CB9D4D"/></a:accent1><a:accent2><a:srgbClr val="CB9D4D"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="CB9D4D"/></a:accent3><a:accent4><a:srgbClr val="CB9D4D"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="CB9D4D"/></a:accent5><a:accent6><a:srgbClr val="CB9D4D"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="CB9D4D"/></a:hlink><a:folHlink><a:srgbClr val="6B6257"/></a:folHlink>` +
  `</a:clrScheme>` +
  `<a:fontScheme name="AION"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Montserrat"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="AION">` +
  `<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
  `</a:fmtScheme></a:themeElements></a:theme>`);

zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels(
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`));

zip.file("ppt/slideMasters/slideMaster1.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FAF7F2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);

zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels(
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`));

zip.file("ppt/slideLayouts/slideLayout1.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">` +
  `<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);

chosen.forEach((s, i) => {
  const n = i + 1;
  zip.file(`ppt/slides/slide${n}.xml`, slideXml(s, null, { index: only || n, of: slides.length, brand: "EXAMPLE" }));
  zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`));
});

zip.file("ppt/_rels/presentation.xml.rels", rels(
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
  chosen.map((_, i) =>
    `<Relationship Id="rId${10 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")));

zip.file("ppt/presentation.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst>${chosen.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join("")}</p:sldIdLst>` +
  `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`);

zip.file("[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
  `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
  `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
  `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
  chosen.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
  `</Types>`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const pptx = join(outDir, "proof.pptx");
writeFileSync(pptx, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

// LibreOffice writes the PDF next to the input, named after it.
execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptx], { stdio: "inherit" });
execFileSync("pdftoppm", ["-png", "-r", "72", join(outDir, "proof.pdf"), join(outDir, "slide")]);
console.log(`${chosen.length} slides → ${outDir}`);
for (const f of readdirSync(outDir).filter((f) => f.endsWith(".png")).sort()) console.log(`  ${join(outDir, f)}`);
