// build-collateral: the rest of the commercial pack, per brand.
//
//   data_request  — the pilot data-request workbook, with the prospect's legal
//                   entity, address and product focus in place of Ferragamo's
//   read_data_request
//                 — the SAME workbook, filled in and sent back, read into a
//                   pricing perimeter instead of retyped by hand
//   business_case — the pricing model as slides: perimeter, premium, AION fees,
//                   cost per product, and the provenance of every rate used
//   operations    — the ops booklet as a deck, in the intro deck's own style
//
// The two decks are generated INTO the teaser package: its theme, masters and
// layouts are kept and only the slides are replaced, which is what makes them
// look like the intro deck rather than like PowerPoint's defaults.
//
// Auth: AION admin, or batch.
// Body: { brand_id, kind, segments?, months?, legal_name?, address?, focus?,
//         file_base64?, file_name? }

import { createClient } from "npm:@supabase/supabase-js@2";
import { originAllowed, originRefused } from "../_shared/origin.ts";
import JSZip from "npm:jszip@3.10.1";
import { sharedStrings, sheetGrid, extractPerimeter, decodeXml, type Sheet } from "../_shared/xlsx-grid.ts";

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
  // Refuse a browser origin that isn't ours before doing anything else.
  if (!originAllowed(req)) return originRefused();

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
    .select("id, name, slug, hq_address, hq_city, hq_country, hq_postcode, legal_name, registered_address, product_focus")
    .eq("id", brandId).maybeSingle();
  if (!brand) return json({ error: `brand ${brandId} not found` }, 404);

  try {
    // Everything already built for this brand, with FRESH links. A signed URL
    // lasts a week, so the one returned at generation time is dead by the time
    // the deal comes back round — and the old panel had no way to get another
    // one except by regenerating the file.
    if (kind === "list") return json(await listArtifacts(admin, brand));
    if (kind === "data_request") return json(await buildDataRequest(admin, brand, body));
    if (kind === "business_case") return json(await buildBusinessCase(admin, brand, body));
    if (kind === "operations") return json(await buildOperations(admin, brand));
    if (kind === "read_data_request") return json(await readDataRequest(admin, brand, body));
    return json({ error: "kind must be list | data_request | read_data_request | business_case | operations" }, 400);
  } catch (e) {
    console.error("[build-collateral]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── 0. What already exists, with links that still work ──────────────────────
async function listArtifacts(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>) {
  const { data: rows } = await admin.from("brand_deck_outputs")
    .select("template_key, storage_path, generated_at, slots_filled")
    .eq("brand_id", brand.id).order("generated_at", { ascending: false });

  const artifacts = [];
  for (const r of (rows ?? []) as { template_key: string; storage_path: string; generated_at: string; slots_filled: unknown[] }[]) {
    const ext = r.storage_path.split(".").pop() ?? "pptx";
    const fileName = `AION x ${brand.name} — ${r.template_key.replace(/_/g, " ")}.${ext}`;
    const { data: signed } = await admin.storage.from(BUCKET)
      .createSignedUrl(r.storage_path, 60 * 60 * 24 * 7, { download: fileName });
    artifacts.push({
      kind: r.template_key, file_name: fileName, generated_at: r.generated_at,
      slots_filled: Array.isArray(r.slots_filled) ? r.slots_filled.length : 0,
      storage_path: r.storage_path,
      // A row whose file was deleted from storage signs fine but 404s on click.
      download_url: signed?.signedUrl ?? null,
    });
  }
  return { ok: true, brand: brand.name, artifacts };
}

// ── 1. Data request workbook ────────────────────────────────────────────────
// A .xlsx keeps its text in xl/sharedStrings.xml, so branding it is a string
// swap — the questions, structure and formatting are untouched.
async function buildDataRequest(admin: ReturnType<typeof createClient>, brand: Record<string, unknown>, body: Record<string, unknown>) {
  const { data: tpl } = await admin.from("deck_templates").select("*").eq("key", "data_request").maybeSingle();
  // Both of these used to surface as one unhelpful line. They are different
  // problems with different fixes, so say which one it is and where the file
  // belongs — this button failed on every brand for weeks because nothing ever
  // registered the template and the error did not say so.
  if (!tpl) {
    throw new Error(
      "the data-request template is not registered — run the commercial-cycle migration, " +
      "then upload the workbook to the 'decks' bucket at the path that row names.",
    );
  }

  const { data: file, error } = await admin.storage.from(BUCKET).download(tpl.storage_path);
  if (error || !file) {
    throw new Error(
      `the data-request workbook is not in storage — upload it to the '${BUCKET}' bucket at ` +
      `${tpl.storage_path} (${error?.message ?? "not found"})`,
    );
  }

  // The record first, the request second, and NOTHING falls back to the trading
  // name. It used to: `legal_name ?? brand.name` meant the workbook always had an
  // answer in its most important cell, the "no legal entity" warning could never
  // fire, and every client received a data request contracted to "Pomellato"
  // rather than to whatever Pomellato's entity is actually called.
  const composed = [brand.hq_address, brand.hq_postcode, brand.hq_city, brand.hq_country].filter(Boolean).join(", ");
  const pick = (fromBody: unknown, fromRecord: unknown) =>
    String(fromBody ?? fromRecord ?? "").trim();
  const legalName = pick(body.legal_name, brand.legal_name);
  const brandAddress = pick(body.address, brand.registered_address) || composed;
  const focus = pick(body.focus, brand.product_focus);
  const values: Record<string, string> = {
    "{{BRAND_LEGAL_NAME}}": legalName,
    "{{BRAND_ADDRESS}}": brandAddress,
    "{{BRAND_FOCUS}}": focus,
  };

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const path = "xl/sharedStrings.xml";
  let xml = await zip.file(path)?.async("string");
  if (!xml) throw new Error("workbook has no shared strings");

  const applied: string[] = [];
  const missed: string[] = [];
  for (const slot of (tpl.text_slots ?? []) as { find: string; replace_with: string }[]) {
    const to = values[slot.replace_with] ?? slot.replace_with;
    // An unanswered field is left blank rather than carrying another client's
    // answer forward — a stale legal entity in a data request is a real problem.
    if (xml.includes(slot.find)) {
      xml = xml.replaceAll(slot.find, escapeXml(to));
      applied.push(`${slot.find} → ${to || "(blank)"}`);
    } else {
      // A slot that never matched means the workbook was revised and the
      // template map is stale. Silently shipping the previous client's text is
      // the failure this has to be loud about.
      missed.push(slot.find);
    }
  }
  zip.file(path, xml);

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return await store(admin, brand, "data_request", "xlsx", out,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    {
      replacements: applied,
      unmatched: missed,
      review: [
        legalName ? `Confirm "${legalName}" is the entity the pilot is contracted with.` : "No legal entity set — the workbook went out blank there.",
        brandAddress ? "Check the registered address against the client's own records." : "No registered address set — fill it on the brand record or in the field above.",
        focus ? `Product focus: ${focus}.` : "No product focus set — the client will not know which categories the pilot covers.",
        ...(missed.length ? [`${missed.length} template slot${missed.length === 1 ? "" : "s"} did not match the workbook — it has been revised since the template was mapped, so check those cells by hand.`] : []),
      ],
    });
}

// ── 1b. The same workbook, filled in and sent back ──────────────────────────
// The client returns the data request and somebody retypes it into the business
// case: eight fields per segment, from a file AION generated in the first place.
// That is where the two hours in step 4 go.
//
// This reads it instead. It proposes a perimeter and says, per figure, where it
// came from and what it had to assume — it does NOT price anything and it does
// not save anything. The admin looks at the segments, fixes what is wrong, and
// presses Calculate as before. A workbook read wrongly and priced silently would
// be far worse than one nobody read at all.
const MAX_WORKBOOK_BYTES = 12 * 1024 * 1024;

async function readDataRequest(
  admin: ReturnType<typeof createClient>, brand: Record<string, unknown>, body: Record<string, unknown>,
) {
  const b64 = String(body.file_base64 ?? "").replace(/^data:[^;]*;base64,/, "");
  if (!b64) return { ok: false, reason: "attach the workbook the client returned" };

  let bytes: Uint8Array;
  try {
    const binary = atob(b64);
    if (binary.length > MAX_WORKBOOK_BYTES) {
      return { ok: false, reason: `that file is ${Math.round(binary.length / 1024 / 1024)}MB — the reader takes up to 12MB` };
    }
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, reason: "could not decode the upload" };
  }

  const zip = await JSZip.loadAsync(bytes).catch(() => null);
  if (!zip) return { ok: false, reason: "that is not a .xlsx workbook — an .xls or a PDF cannot be read" };
  if (!zip.file("xl/workbook.xml")) {
    return { ok: false, reason: "that is not a .xlsx workbook — it has no xl/workbook.xml" };
  }

  const sheets = await readSheets(zip);
  if (!sheets.length) return { ok: false, reason: "the workbook has no readable sheets" };

  const extraction = extractPerimeter(sheets);

  // Keep what the client sent, whatever came of reading it. Six weeks later,
  // "what did they actually declare" is a question about the file, not about the
  // numbers somebody typed from it.
  const fileName = String(body.file_name ?? "data request returned.xlsx");
  let stored: Record<string, unknown> | null = null;
  try {
    stored = await store(admin, brand, "data_request_returned", "xlsx", bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { received_as: fileName });
  } catch (e) {
    // The reading is the point; failing to archive it must not lose the result.
    extraction.notes.push(`The workbook could not be attached to the brand (${e instanceof Error ? e.message : "unknown error"}), but it was read.`);
  }

  return {
    ok: true,
    kind: "read_data_request",
    brand: brand.name,
    received_as: fileName,
    segments: extraction.segments,
    notes: extraction.notes,
    sheets: extraction.scanned,
    stored_as: stored?.storage_path ?? null,
    download_url: stored?.download_url ?? null,
  };
}

// Sheets in the order the workbook presents them, resolved through the
// relationship ids — sheet1.xml is not reliably the first tab.
// Structural, not `JSZip`: the only thing needed from the archive is "give me this entry as
// a string", and naming that avoids depending on how the npm types happen to be exported.
type ZipLike = { file(path: string): { async(type: "string"): Promise<string> } | null };

async function readSheets(zip: ZipLike): Promise<Sheet[]> {
  const workbookXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";

  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)) {
    targets.set(m[1], m[2].replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = sharedXml ? sharedStrings(sharedXml) : [];

  const sheets: Sheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const name = /\bname="([^"]*)"/.exec(attrs)?.[1] ?? `Sheet ${sheets.length + 1}`;
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = targets.get(rid) ?? `worksheets/sheet${sheets.length + 1}.xml`;
    const xml = await zip.file(`xl/${target}`)?.async("string");
    if (!xml) continue;
    sheets.push({ name: decodeXml(name), grid: sheetGrid(xml, shared) });
    // A perimeter is never on the twelfth tab, and each one is a full parse.
    if (sheets.length >= 12) break;
  }
  return sheets;
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
      `Setup ${eur(fees.setup)} — one-off`,
      fees.service_fee_month
        ? `Service ${eur(fees.service_fee_month)}/month → ${eur(fees.service)} over the period (${fees.service_months_discounted ?? 0} months discounted, ${fees.service_months_full ?? 0} at full rate)`
        : `Service fee: ${fees.service_note ?? "on quotation"}`,
      `Activation ${eur(fees.activation)}`,
      `Total AION fees ${eur(fees.total)}`,
    ] },

    // Per piece is the RECURRING cost. Setup is one-off and is shown on its own
    // line, so this slide reconciles with "total cost to the brand" when someone
    // multiplies it out in the meeting.
    { title: "Cost per piece", bullets: pp.total ? [
      `Insurer ${eur(pp.insurer_fee)} per piece`,
      `AION ${eur(pp.aion_fee)} per piece`,
      `Recurring total ${eur(pp.total)} per piece`,
      `${pct(pp.total_pct_of_price)} of the retail price, ${pct(pp.total_pct_of_price_incl_vat)} of the price including VAT`,
      `Setup spread over the perimeter adds ${eur(pp.setup)} per piece → ${eur(pp.total_with_setup)} all-in`,
    ] : ["Average price not supplied — add an average price per segment for per-piece figures"] },

    { title: "Summary", bullets: [
      `Total cost to ${brand.name}: ${eur(c.total_cost_to_brand)}`,
      `of which insurance ${eur(c.gross_premium)} and AION ${eur(fees.total)}`,
      `AION revenue over the period ${eur(c.aion_total_revenue)}`,
      ...(c.volume_band_mismatch ? ["Rates were quoted at a different volume than this perimeter declares"] : []),
      "Figures are a model, not an offer — the formal insurer quotation governs",
    ] },

    // Provenance is the slide that keeps this honest: what the rate covers, who
    // it was quoted for, and at what volume.
    { title: "Where these rates come from", bullets: (c.rates_used ?? []).map((r: any) => {
      const cover = r.coverage === "theft" ? "theft only"
        : `theft + accidental damage${r.damage_scope ? ` (${r.damage_scope})` : ""}`;
      const band = r.gmv_from != null
        ? `, quoted at ${eur(r.gmv_from)}–${r.gmv_to != null ? eur(r.gmv_to) : "no cap"} volume` : "";
      return `${r.category} — ${cover}: ${pct(r.rate_of_cogs)} of COGS. ${r.insurer}, quoted for ${r.quoted_for ?? "—"}` +
        `${r.quoted_at ? ` (${r.quoted_at})` : ""}${band}${r.own_quote ? "" : " — INDICATIVE"}`;
    }) },
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
        ...((c.notes ?? []) as string[]),
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
  if (error || !file) {
    throw new Error(
      `the AION teaser is not in storage, and both decks are generated into it for their styling — ` +
      `upload it to the '${BUCKET}' bucket at ${STYLE_TEMPLATE} (${error?.message ?? "not found"})`,
    );
  }
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
