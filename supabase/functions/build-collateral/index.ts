// build-collateral: the rest of the commercial pack, per brand.
//
//   data_request  — the pilot data-request workbook, with the prospect's legal
//                   entity, address and product focus in place of Ferragamo's
//   business_case — the pricing model as slides: perimeter, premium, AION fees,
//                   cost per product, and the provenance of every rate used
//   operations    — the ops booklet as a deck, in the intro deck's own style
//
// The two decks are generated INTO the teaser package: its theme, masters and
// layouts are kept and only the slides are replaced, which is what makes them
// look like the intro deck rather than like PowerPoint's defaults.
//
// Auth: AION admin, or batch.
// Body: { brand_id, kind, segments?, months?, legal_name?, address?, focus? }

import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KNOWLEDGE_BATCH_SECRET = Deno.env.get("KNOWLEDGE_BATCH_SECRET") ?? "";
const BUCKET = "decks";
const STYLE_TEMPLATE = "templates/AION_Teaser_New.pptx";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-batch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SlideSpec = { title: string; bullets: string[] };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const isBatch =
    (KNOWLEDGE_BATCH_SECRET && req.headers.get("x-batch-secret") === KNOWLEDGE_BATCH_SECRET) ||
    token === SUPABASE_SERVICE_ROLE_KEY || jwtRole(token) === "service_role";
  if (!isBatch) {
    if (!token) return json({ error: "missing bearer token" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid session" }, 401);
    const { data: adminRow } = await userClient.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return json({ error: "AION admin only" }, 403);
  }

  const brandId = Number(body.brand_id ?? 0);
  const kind = String(body.kind ?? "");
  if (!brandId) return json({ error: "brand_id required" }, 400);

  const { data: brand } = await admin.from("brands")
    .select("id, name, slug, hq_address, hq_city, hq_country, hq_postcode").eq("id", brandId).maybeSingle();
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  try {
    if (kind === "data_request") return json(await buildDataRequest(admin, brand, body));
    if (kind === "business_case") return json(await buildBusinessCase(admin, brand, body));
    if (kind === "operations") return json(await buildOperations(admin, brand));
    return json({ error: "kind must be data_request | business_case | operations" }, 400);
  } catch (e) {
    console.error("[build-collateral]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── 1. Data request workbook ────────────────────────────────────────────────
// A .xlsx keeps its text in xl/sharedStrings.xml, so branding it is a string
// swap — the questions, structure and formatting are untouched.
async function buildDataRequest(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>, body: Record<string, unknown>) {
  const { data: tpl } = await admin.from("deck_templates").select("*").eq("key", "data_request").maybeSingle();
  if (!tpl) throw new Error("data_request template not registered");

  const { data: file, error } = await admin.storage.from(BUCKET).download(tpl.storage_path);
  if (error || !file) throw new Error(`template not readable: ${error?.message}`);

  const address = [brand.hq_address, brand.hq_postcode, brand.hq_city, brand.hq_country].filter(Boolean).join(", ");
  const values: Record<string, string> = {
    "{{BRAND_LEGAL_NAME}}": String(body.legal_name ?? brand.name ?? ""),
    "{{BRAND_ADDRESS}}": String(body.address ?? address ?? ""),
    "{{BRAND_FOCUS}}": String(body.focus ?? ""),
  };

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const path = "xl/sharedStrings.xml";
  let xml = await zip.file(path)?.async("string");
  if (!xml) throw new Error("workbook has no shared strings");

  const applied: string[] = [];
  for (const slot of (tpl.text_slots ?? []) as { find: string; replace_with: string }[]) {
    const to = values[slot.replace_with] ?? slot.replace_with;
    // An unanswered field is left blank rather than carrying another client's
    // answer forward — a stale legal entity in a data request is a real problem.
    if (xml.includes(slot.find)) {
      xml = xml.replaceAll(slot.find, escapeXml(to));
      applied.push(`${slot.find} → ${to || "(blank)"}`);
    }
  }
  zip.file(path, xml);

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return await store(admin, brand, "data_request", "xlsx", out,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { replacements: applied, review: ["Confirm the legal entity and address with the client before sending.", "Set the product focus for the pilot if it was left blank."] });
}

// ── 2. Business case deck ───────────────────────────────────────────────────
async function buildBusinessCase(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>, body: Record<string, unknown>) {
  const segments = body.segments;
  if (!Array.isArray(segments) || !segments.length) {
    throw new Error("segments required, e.g. [{name, category, revenues, cogs_ratio, avg_price, start_month}]");
  }

  const { data: bc, error } = await admin.rpc("compute_business_case", {
    p_brand_id: Number(brand.id),
    p_segments: segments,
    p_months: Number(body.months ?? 36),
    p_terms_key: String(body.terms_key ?? "standard_2026"),
    p_include_api: body.include_api === true,
    p_setup_discounted: body.setup_discounted !== false,
  });
  if (error) throw new Error(error.message);
  const c = bc as Record<string, any>;
  if (c.ok === false) return { ok: false, reason: c.reason };

  // Preview: the numbers, without building a deck. The perimeter gets adjusted
  // several times before anyone wants a file, and generating a 10MB PPTX for
  // each tweak is slow and litters storage.
  if (body.preview === true) return { ok: true, preview: true, business_case: c };

  const eur = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const fees = c.aion_fees ?? {};
  const pp = c.per_product ?? {};

  const slides: SlideSpec[] = [
    { title: `${brand.name} — programme business case`, bullets: [
      `Perimeter modelled over ${c.months} months`,
      ...c.segments.map((s: any) => `${s.segment}: ${eur(s.revenues_covered)} covered, ${s.units ?? "—"} pieces`),
      `Total covered revenues ${eur(c.revenues_covered)}${c.products_covered ? ` across ${c.products_covered.toLocaleString("en-US")} pieces` : ""}`,
      c.average_price ? `Average price per piece ${eur(c.average_price)}` : "",
    ].filter(Boolean) },

    { title: "Insurance cost", bullets: [
      ...c.segments.map((s: any) => `${s.segment}: ${pct(s.rate_of_cogs)} of COGS → ${eur(s.gross_premium)} gross premium`),
      `Gross premium ${eur(c.gross_premium)}`,
      `Net premium after GVT fee ${eur(c.net_premium)}`,
      c.indicative
        ? "Rates are INDICATIVE — quoted for another house, pending formal quotation"
        : "Rates as quoted for this house",
    ] },

    { title: "AION fees", bullets: [
      `Tier ${fees.tier} on covered GMV`,
      `Setup ${eur(fees.setup)}`,
      fees.service_fee_month ? `Service ${eur(fees.service_fee_month)}/month → ${eur(fees.service)} over the period` : `Service fee: ${fees.service_note ?? "on quotation"}`,
      `Activation ${eur(fees.activation)}`,
      `Total AION fees ${eur(fees.total)}`,
    ] },

    { title: "Cost per piece", bullets: pp.total ? [
      `Insurer ${eur(pp.insurer_fee)} per piece`,
      `AION ${eur(pp.aion_fee)} per piece`,
      `Total ${eur(pp.total)} per piece`,
      `${pct(pp.total_pct_of_price)} of retail price (${pct(pp.total_pct_of_price_incl_vat)} incl. VAT)`,
    ] : ["Average price not supplied — add avg_price per segment for per-piece figures"] },

    { title: "Summary", bullets: [
      `Total cost to ${brand.name}: ${eur(c.total_cost_to_brand)}`,
      `of which insurance ${eur(c.gross_premium)} and AION ${eur(fees.total)}`,
      `AION revenue over the period ${eur(c.aion_total_revenue)}`,
      "Figures are a model, not an offer — the formal insurer quotation governs",
    ] },

    { title: "Where these rates come from", bullets: (c.rates_used ?? []).map((r: any) =>
      `${r.category}: ${pct(r.rate_of_cogs)} of COGS — ${r.insurer}, quoted for ${r.quoted_for ?? "—"}${r.quoted_at ? ` (${r.quoted_at})` : ""}${r.own_quote ? "" : " — INDICATIVE"}`) },
  ];

  const out = await renderDeck(admin, slides);
  return await store(admin, brand, "business_case", "pptx", out,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    {
      business_case: c,
      indicative: c.indicative,
      review: [
        c.indicative
          ? "These rates were quoted for another house. Decide deliberately whether to show them, and keep the 'indicative' wording on the slide."
          : "Rates are this brand's own quote.",
        "Check the perimeter against what the client actually declared in the data request.",
        "A formal Chubb quotation takes 1–2 months and supersedes this.",
      ],
    });
}

// ── 3. Operations deck ──────────────────────────────────────────────────────
// Faithful to the approved booklet: the same six sections in the same order,
// with the client's name in place of the previous one. It is a summary of the
// booklet for a meeting, not a replacement for it.
async function buildOperations(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>) {
  const B = String(brand.name ?? "the brand").toUpperCase();
  const slides: SlideSpec[] = [
    { title: `AION Cover × ${brand.name} — come funziona`, bullets: [
      "Servizio di copertura assicurativa integrato su furto e danni accidentali",
      "Modello CLIP (Contractual Liability Insurance Policy)",
      "Attivazione semplice per il cliente finale",
      "Gestione centralizzata su piattaforma white-label AION",
      "Conformità alle normative assicurative e GDPR",
    ] },
    { title: "I quattro attori", bullets: [
      "Chubb — definisce termini e condizioni, approva i sinistri, fattura al brand",
      `${B} — racconta il servizio al cliente, raccoglie i dati, gestisce la relazione`,
      "AION Cover — piattaforma, verifica dei sinistri, bordereau, raccomandazioni",
      "Cliente finale — si registra, attiva la copertura, apre gli eventuali sinistri",
    ] },
    { title: "Attivazione della polizza", bullets: [
      "Chubb e AION concordano i campi obbligatori dei bordereaux",
      `${B} raccoglie i dati del cliente e del prodotto al momento dell'acquisto`,
      "Il cliente riceve l'invito e attiva l'account sulla piattaforma",
      "La copertura decorre dall'attivazione, per la durata concordata",
    ] },
    { title: "Apertura e gestione dei sinistri", bullets: [
      "Il cliente apre il sinistro sulla piattaforma (furto o danno accidentale)",
      "AION verifica la completezza della documentazione",
      "Chubb analizza e approva o rigetta, entro gli SLA concordati",
      `${B} mantiene la relazione diretta con il cliente`,
      "Processo speculare a quello della garanzia legale",
    ] },
    { title: "Sostituzione del prodotto — voucher", bullets: [
      "Codice alfanumerico univoco e nominale per il beneficiario",
      "Utilizzabile su uno o più SKU nei punti vendita concordati",
      "Durata: 6 mesi o 1 anno dalla data di emissione",
      "Valore pari al prezzo pubblico del prodotto al momento dell'acquisto",
      "Riporta traffico in boutique e risolve i prodotti fuori produzione",
    ] },
    { title: "Comunicazioni e ciclo attivo/passivo", bullets: [
      "Piano delle comunicazioni al cliente concordato con il brand",
      "Chubb emette fattura al brand entro il 15 del mese successivo",
      "AION fattura setup, service e activation fee secondo contratto",
      "Reportistica e bordereau condivisi periodicamente",
    ] },
    { title: "Setup — cosa serve", bullets: [
      "Preparazione roll-out plan — 0,5 giorni",
      "Legal: FAQ e T&C — 2 giorni",
      "Ops: flusso email e definizione processi — 3 giorni",
      "Piattaforma: colori, immagini, branding — 0,5 giorni",
      "Comunicazione e formazione — 1 giorno",
      "Totale indicativo: 7 giorni team business",
    ] },
  ];

  const out = await renderDeck(admin, slides);
  return await store(admin, brand, "operations", "pptx", out,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    { review: [
      "Summarises the approved booklet — check it against the latest version before sending.",
      "SLA figures and voucher duration are placeholders from the Ferragamo booklet; confirm per client.",
    ] });
}

// ── PPTX rendering ──────────────────────────────────────────────────────────
// Slides are generated INTO the teaser package: theme, masters and layouts stay,
// only the slide list is replaced. That is what makes these decks look like the
// intro deck instead of like default PowerPoint.
async function renderDeck(admin: ReturnType<typeof createClient>, slides: SlideSpec[]): Promise<Uint8Array> {
  const { data: file, error } = await admin.storage.from(BUCKET).download(STYLE_TEMPLATE);
  if (error || !file) throw new Error(`style template not readable: ${error?.message}`);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Drop the teaser's own slides — and its speaker notes with them. A notesSlide
  // points back at its parent slide, so deleting slides alone leaves notes
  // relationships dangling at parts that no longer exist.
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/.test(name)) zip.remove(name);
    if (/^ppt\/notesSlides\//.test(name)) zip.remove(name);
  }

  const LAYOUT = "../slideLayouts/slideLayout2.xml"; // the layout the teaser's own content slides use
  const MARK_IMG = "../media/image2.png";             // the AION wordmark
  const hasMark = zip.file("ppt/media/image2.png") !== null;

  slides.forEach((s, i) => {
    const n = i + 1;
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(s, hasMark ? "rId2" : null));
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${LAYOUT}"/>` +
      (hasMark ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${MARK_IMG}"/>` : "") +
      `</Relationships>`);
  });

  // presentation.xml.rels: keep every non-slide relationship, then re-add ours
  // with fresh ids so nothing collides with the masters and theme.
  const relsPath = "ppt/_rels/presentation.xml.rels";
  const relsXml = await zip.file(relsPath)!.async("string");
  // Match on the relationship TYPE, not on the target path: the teaser's targets
  // are written as "slides/slide10.xml" with no leading slash, so a path filter
  // silently kept them and left ten relationships pointing at deleted parts.
  const kept = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0])
    .filter((r) => !/relationships\/slide"/.test(r));
  let maxId = 0;
  for (const r of kept) {
    const id = Number(r.match(/Id="rId(\d+)"/)?.[1] ?? 0);
    if (id > maxId) maxId = id;
  }
  const slideRels = slides.map((_, i) =>
    `<Relationship Id="rId${maxId + 1 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`);
  zip.file(relsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...kept, ...slideRels].join("")}</Relationships>`);

  // presentation.xml: rewrite the slide id list to match.
  const presPath = "ppt/presentation.xml";
  let pres = await zip.file(presPath)!.async("string");
  const sldIdLst = `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${maxId + 1 + i}"/>`).join("")}</p:sldIdLst>`;
  pres = pres.includes("<p:sldIdLst>")
    ? pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, sldIdLst)
    : pres.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>)/, `$1${sldIdLst}`);
  zip.file(presPath, pres);

  // [Content_Types].xml: one override per slide part.
  const ctPath = "[Content_Types].xml";
  let ct = await zip.file(ctPath)!.async("string");
  ct = ct.replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "");
  ct = ct.replace(/<Override[^>]*PartName="\/ppt\/notesSlides\/[^"]*"[^>]*\/>/g, "");
  const overrides = slides.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  ct = ct.replace("</Types>", `${overrides}</Types>`);
  zip.file(ctPath, ct);

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// The AION look does not come from the slide master — the teaser sets it on each
// slide: a cream background (FAF7F2) and the wordmark bottom-left. Generated
// slides that only reference the layout inherit PowerPoint's blue default
// instead, which is what the first render showed. So set both explicitly, with
// the wordmark at the same coordinates the teaser uses.
const BG = "FAF7F2";
const MARK = { x: 848926, y: 6455335, cx: 627631, cy: 178973 };

function slideXml(s: SlideSpec, markRelId: string | null): string {
  const para = (t: string, lvl = 0) =>
    `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ""}<a:r><a:rPr lang="en-GB" dirty="0"/><a:t>${escapeXml(t)}</a:t></a:r></a:p>`;
  const bullets = s.bullets.filter(Boolean).map((b) => para(b)).join("") || para("");
  const mark = markRelId
    ? `<p:pic><p:nvPicPr><p:cNvPr id="4" name="AION"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${markRelId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${MARK.x}" y="${MARK.y}"/><a:ext cx="${MARK.cx}" cy="${MARK.cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${para(s.title)}</p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${bullets}</p:txBody></p:sp>` + mark +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// ── Shared ──────────────────────────────────────────────────────────────────
async function store(
  admin: ReturnType<typeof createClient>, brand: Record<string, unknown>,
  kind: string, ext: string, bytes: Uint8Array, contentType: string, extra: Record<string, unknown>,
) {
  const slug = String(brand.slug ?? brand.name ?? brand.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const path = `brands/${brand.id}/aion-x-${slug}-${kind}.${ext}`;
  const fileName = `AION x ${brand.name} — ${kind.replace(/_/g, " ")}.${ext}`;

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);

  await admin.from("brand_deck_outputs").upsert({
    brand_id: brand.id, template_key: kind, storage_path: path, generated_at: new Date().toISOString(),
    slots_filled: [],
  }, { onConflict: "brand_id,template_key" });

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7, { download: fileName });
  return { ok: true, kind, brand: brand.name, file_name: fileName, storage_path: path, download_url: signed?.signedUrl ?? null, ...extra };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jwtRole(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const pad = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

function json(payload: unknown, code = 200) {
  return new Response(JSON.stringify(payload), { status: code, headers: { ...CORS, "Content-Type": "application/json" } });
}
