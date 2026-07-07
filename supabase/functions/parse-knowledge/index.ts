// parse-knowledge: turn an uploaded FILE into brand knowledge. The browser
// uploads the raw file to the `brand-knowledge-uploads` Storage bucket (keyed
// {brand_id}/{uuid}.{ext}) and then calls this function with the storage path.
// We download it with the service role, extract its text (PDF / DOCX / PPTX /
// TXT / MD / CSV), then chunk + embed + store it into brand_knowledge_docs /
// brand_knowledge_chunks exactly like ingest-knowledge — source_type='upload'.
//
// Brand callers are pinned to their own brand; admins may pass brand_id. The
// storage path's first segment MUST equal the resolved brand — the service-role
// download bypasses RLS, so we re-check ownership here in defense of depth.
//
// Body: { storage_path, filename?, title?, category?, brand_id? }
// Returns: { doc_id, chunk_count, char_count, status }

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.6.2";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.3";
import { chunkText, embedDocuments } from "../_shared/crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;

const BUCKET = "brand-knowledge-uploads";
const MAX_CONTENT_CHARS = 400_000; // ~100k tokens; truncate beyond this.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB raw file ceiling.
const MIN_TEXT_CHARS = 20; // below this we treat the file as "no extractable text".

const VALID_CATEGORIES = ["product", "storytelling", "policy", "training", "other"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return jsonError("method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonError("missing bearer token", 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonError("invalid session", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const storagePath = String(body.storage_path ?? "").trim();
  const filename = String(body.filename ?? storagePath.split("/").pop() ?? "document").trim();
  const category = VALID_CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
  const titleInput = String(body.title ?? "").trim();
  if (!storagePath) return jsonError("storage_path is required", 400);

  // Resolve brand scope + the caller's profile id, same as ingest-knowledge.
  let brandId: number | null = null;
  let profileId: string | null = null;

  const { data: adminRow } = await userClient
    .from("admins").select("id").eq("user_id", user.id).maybeSingle();

  if (adminRow) {
    brandId = Number(body.brand_id ?? 0) || null;
    if (!brandId) return jsonError("brand_id required for admin caller", 400);
  } else {
    const { data: profileRow } = await userClient
      .from("profiles").select("id, brand_id, role")
      .eq("user_id", user.id)
      .in("role", ["brand", "brand_admin", "brand_user"]).maybeSingle();
    if (!profileRow?.brand_id) return jsonError("admin or brand role required", 403);
    brandId = profileRow.brand_id as number;
    profileId = profileRow.id as string;
  }

  // Ownership check: the path MUST live under this brand's prefix. Prevents a
  // caller from pointing the service-role download at another brand's object.
  if ((storagePath.split("/")[0] ?? "") !== String(brandId)) {
    return jsonError("storage_path does not belong to this brand", 403);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Download the raw file (service role — bypasses Storage RLS).
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath);
  if (dlErr || !blob) return jsonError(`could not read the uploaded file: ${dlErr?.message ?? "not found"}`, 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return jsonError("the uploaded file is empty", 400);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return jsonError(`file too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`, 413);
  }

  // 2) Extract text by file type.
  let content: string;
  try {
    content = await extractByType(filename, bytes);
  } catch (e) {
    console.error("[parse-knowledge extract]", e);
    return jsonError(`couldn't read this file: ${e instanceof Error ? e.message : "unknown"}`, 422);
  }
  content = content.replace(/\u0000/g, "").replace(/\uFEFF/g, "").trim();
  if (content.length < MIN_TEXT_CHARS) {
    return jsonError(
      "no readable text found in this file — a scanned or image-only document can't be indexed as text.",
      422,
    );
  }
  let truncated = false;
  if (content.length > MAX_CONTENT_CHARS) { content = content.slice(0, MAX_CONTENT_CHARS); truncated = true; }

  const title = (titleInput || filename.replace(/\.[a-z0-9]+$/i, "")).slice(0, 300) || "Document";

  // 3) Create the doc row up front (status='processing'), then embed. Same
  //    lifecycle as ingest-knowledge so the UI shows it immediately.
  const { data: doc, error: docErr } = await admin
    .from("brand_knowledge_docs")
    .insert({
      brand_id: brandId, title, category,
      source_type: "upload", source_url: storagePath,
      content, char_count: content.length, status: "processing", created_by: profileId,
    })
    .select("id").single();
  if (docErr || !doc) return jsonError(`could not create doc: ${docErr?.message}`, 500);
  const docId = doc.id as string;

  try {
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunkable content");
    const embeddings = await embedDocuments(chunks, VOYAGE_API_KEY);

    const rows = chunks.map((c, i) => ({
      doc_id: docId, brand_id: brandId, chunk_index: i, content: c,
      token_count: Math.round(c.length / 4), embedding: embeddings[i],
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await admin.from("brand_knowledge_chunks").insert(rows.slice(i, i + 200));
      if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
    }

    await admin.from("brand_knowledge_docs")
      .update({ status: "ready", chunk_count: chunks.length, error: null })
      .eq("id", docId);

    return jsonOk({ doc_id: docId, chunk_count: chunks.length, char_count: content.length, status: "ready", truncated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[parse-knowledge]", message);
    await admin.from("brand_knowledge_docs").update({ status: "error", error: message.slice(0, 500) }).eq("id", docId);
    await admin.from("brand_knowledge_chunks").delete().eq("doc_id", docId);
    return jsonError(`indexing failed: ${message}`, 500);
  }
});

// ── Extraction ───────────────────────────────────────────────────────────────
async function extractByType(filename: string, bytes: Uint8Array): Promise<string> {
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

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
