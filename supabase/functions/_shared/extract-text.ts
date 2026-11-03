// Text out of a file, by type: PDF, DOCX, PPTX, plain text. Shared by
// parse-knowledge (a file the brand uploads) and source-sync (a file on the
// brand's Google Drive), so a document reads the same whichever way it arrives.

import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.3";

export async function extractByType(filename: string, bytes: Uint8Array): Promise<string> {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  switch (ext) {
    case "pdf": return await extractPdf(bytes);
    case "docx": return extractDocx(bytes);
    case "pptx": return extractPptx(bytes);
    case "txt":
    case "md":
    case "markdown":
    case "csv":
    case "tsv":
    case "text": return strFromU8(bytes);
    default:
      // Fall back to a UTF-8 read for anything that decodes to sane text
      // (e.g. .json, .html saved as text); reject binary noise.
      { const t = safeUtf8(bytes); if (t) return t; }
      throw new Error(`unsupported file type ".${ext}"`);
  }
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
}

// DOCX is a zip; the body prose lives in word/document.xml (plus headers/
// footers). Pull the <w:t> text runs; treat paragraph/line breaks as newlines.
function extractDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const parts: string[] = [];
  const names = Object.keys(files)
    .filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(n))
    .sort((a) => (/document\.xml$/i.test(a) ? -1 : 1)); // document body first
  for (const n of names) {
    const xml = strFromU8(files[n]);
    parts.push(docXmlToText(xml, "w"));
  }
  return parts.join("\n\n").trim();
}

// PPTX is a zip; each slide is ppt/slides/slideN.xml with <a:t> text runs.
function extractPptx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const parts: string[] = [];
  for (const n of slides) parts.push(docXmlToText(strFromU8(files[n]), "a"));
  return parts.filter(Boolean).join("\n\n").trim();
}

const slideNum = (n: string) => Number(n.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);

// Pull the text out of an OOXML part: <ns:t>…</ns:t> are the text runs;
// </ns:p> (paragraph) and <ns:br/> become newlines. Namespace is "w" (Word)
// or "a" (DrawingML, used by PowerPoint).
function docXmlToText(xml: string, ns: "w" | "a"): string {
  let s = xml;
  s = s.replace(new RegExp(`</${ns}:p>`, "gi"), "\n");
  s = s.replace(new RegExp(`<${ns}:br\\s*/?>`, "gi"), "\n");
  const runs: string[] = [];
  const re = new RegExp(`<${ns}:t[^>]*>([\\s\\S]*?)</${ns}:t>`, "gi");
  let m: RegExpExecArray | null;
  // Walk the (newline-annotated) string, emitting text runs and the paragraph
  // breaks that fall between them.
  let lastIdx = 0;
  while ((m = re.exec(s)) !== null) {
    const between = s.slice(lastIdx, m.index);
    if (between.includes("\n")) runs.push("\n");
    runs.push(decodeXml(m[1]));
    lastIdx = re.lastIndex;
  }
  return runs.join("")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Decode as UTF-8 only if the result looks like text (few control bytes).
function safeUtf8(bytes: Uint8Array): string | null {
  try {
    const t = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const ctrl = (t.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length;
    return ctrl / Math.max(1, t.length) < 0.01 ? t : null;
  } catch { return null; }
}
