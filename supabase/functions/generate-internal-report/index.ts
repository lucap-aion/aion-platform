// Monthly Internal Policies Report generator.
// TypeScript port of aion_services/aion_cronjobs/internal_reports.py +
// chubb.parse_policy_data. Generates one .xlsx per Chubb-reporting brand
// from the template stored in the `report_templates` bucket, uploads each
// file to `internal_reports`, returns signed download URLs, and inserts
// a row into the `reports` table.

import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TEMPLATE_BUCKET = "report_templates";
const TEMPLATE_FILE = "internal_premium_and_activation_template.xlsx";
const OUTPUT_BUCKET = "internal_reports";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Column layout (must match the template's Input header row 1) ────────────
const INTERNAL_COLS = [
  "Transaction_type",
  "Client_No",
  "Caller_code",
  "Date_of_call",
  "Effective_from",
  "Policy_Number",
  "Fulfillment",
  "Payment_Type",
  "Payment_Frequency",
  "MI_ProductA_Code",
  "MI_ProductA_option",
  "Recommended_Retail_Price",
  "Detail_2",
  "Detail_3",
  "Detail_4",
  "Detail_5",
  "Detail_6",
  "Detail_7",
  "Detail_8",
  "Detail_9",
  "Detail_10",
  "Customer_First_Name",
  "Customer_Last_Name",
  "Customer_Email",
  "Item_Code",
] as const;

const LINEBREAK_RE = /[\r\n\t\v\f\u0085\u2028\u2029]+/g;

const normalizeOneLine = (s: unknown): string => {
  if (s === null || s === undefined) return "";
  return String(s).replace(LINEBREAK_RE, " ").replace(/\s+/g, " ").trim();
};

const parseDateDdMmYyyy = (s: string | null | undefined): string => {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const generateChubbPolicyNumber = (prefix: string, n: number): string =>
  prefix + String(n).padStart(15 - prefix.length, "0");

const mapCategoryToChubb = (
  category: string | null | undefined,
  categories: { category: string | null; chubb_category: string | null }[],
): string => {
  if (!category) return "";
  const upper = category.toUpperCase();
  const found = categories.find(
    (c) => (c.category ?? "").toUpperCase() === upper,
  );
  return (found?.chubb_category ?? category) ?? "";
};

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s+/g, "");
  if (s.indexOf(",") !== -1 && s.indexOf(".") === -1) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const columnLetter = (idx: number): string => {
  let s = "";
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
};

// ─── Row mappers (port of parse_policy_data + _policy_to_internal_row) ───────

const parsePolicyToChubbRow = (
  policy: any,
  brandName: string,
  brandChubbPrefix: string,
  categories: any[],
): Record<string, any> => {
  const row: Record<string, any> = {};
  row.Transaction_type = policy.status === "live" ? "NEW" : "CAN";
  if (policy.status === "cancelled") row.Canc_type = "ANN";
  row.Client_No = policy.brand_sale_id;
  row.Caller_code = policy.shop_id?.brand_shop_id ?? "";
  row.Date_of_call = parseDateDdMmYyyy(
    policy.status === "live" ? policy.start_date : policy.cancelled_at,
  );
  row.Effective_from = parseDateDdMmYyyy(policy.start_date);
  row.Policy_Number = generateChubbPolicyNumber(
    brandChubbPrefix ?? "",
    Number(policy.id),
  );
  row.Fulfillment = "N";
  row.Payment_Type = "B";
  row.Payment_Frequency = "U";
  row.MI_ProductA_Code = "LUXURY";
  row.MI_ProductA_option = "FULL";
  const sp = Number(policy.selling_price);
  const cg = Number(policy.cogs);
  const qty = Number(policy.quantity ?? 1);
  row.Detail_2 = Number.isFinite(sp) && sp !== 0 ? String(sp * qty) : "";
  row.Detail_3 = Number.isFinite(cg) && cg !== 0 ? String(cg * qty) : "";
  row.Detail_4 = brandName;
  row.Detail_5 = normalizeOneLine(policy.item_id?.name);
  row.Detail_6 = policy.brand_row_id ?? "";
  row.Detail_7 = mapCategoryToChubb(policy.item_id?.category, categories);
  row.Detail_8 = "";
  row.Detail_9 = "";
  row.Detail_10 = "24";
  return row;
};

const policyToInternalRow = (
  policy: any,
  brand: any,
  categories: any[],
): Record<string, any> => {
  const chubbRow = parsePolicyToChubbRow(
    policy,
    brand.name,
    brand.chubb_policy_prefix,
    categories,
  );
  const out: Record<string, any> = {};
  for (const k of INTERNAL_COLS) out[k] = chubbRow[k] ?? "";

  const rrp = Number(policy.recommended_retail_price ?? 0) *
    Number(policy.quantity ?? 1);
  out.Recommended_Retail_Price =
    Number.isFinite(rrp) && rrp !== 0 ? rrp : null;
  out.Detail_2 = toNumber(out.Detail_2);
  out.Detail_3 = toNumber(out.Detail_3);
  out.Detail_5 = normalizeOneLine(out.Detail_5);
  out.Customer_First_Name = normalizeOneLine(policy.profile_id?.first_name);
  out.Customer_Last_Name = normalizeOneLine(policy.profile_id?.last_name);
  out.Customer_Email = normalizeOneLine(policy.profile_id?.email);
  out.Item_Code = normalizeOneLine(policy.item_id?.sku);
  return out;
};

const monthWindowUtc = (year: number, month: number) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = month === 12
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
};

const previousMonth = (): { year: number; month: number } => {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // 1-12
  if (m === 1) {
    m = 12;
    y -= 1;
  } else {
    m -= 1;
  }
  return { year: y, month: m };
};

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const startedAt = Date.now();
  try {
    // ── Auth: admin check via the caller's JWT ──────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "missing bearer token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...CORS },
        },
      );
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "invalid session" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...CORS },
        },
      );
    }
    const { data: adminRow } = await userClient.from("admins")
      .select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: "admin role required" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...CORS },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { year: pyYear, month: pyMonth } = previousMonth();
    const year = Number(body.year ?? pyYear);
    const month = Number(body.month ?? pyMonth);
    const brandId = body.brand_id != null ? Number(body.brand_id) : null;
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return new Response(
        JSON.stringify({ error: "month must be an integer 1-12" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        },
      );
    }

    // ── Service-role client for storage + cross-brand DB access ─────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Brands
    let brandsQ = admin.from("brands")
      .select(
        "id, name, chubb_policy_prefix, insurance_premium, activation_fee, enable_chubb_reporting",
      )
      .eq("enable_chubb_reporting", true);
    if (brandId) brandsQ = brandsQ.eq("id", brandId);
    const { data: brands, error: bErr } = await brandsQ;
    if (bErr) throw new Error(`Failed to fetch brands: ${bErr.message}`);
    if (!brands || brands.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            brandId
              ? `Brand ${brandId} is not configured for Chubb reporting`
              : "No Chubb-enabled brands found",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        },
      );
    }

    // Template (single download for all brands in the request)
    const { data: tplBlob, error: tplErr } = await admin.storage
      .from(TEMPLATE_BUCKET).download(TEMPLATE_FILE);
    if (tplErr || !tplBlob) {
      throw new Error(
        `Failed to fetch template: ${tplErr?.message ?? "no blob"}`,
      );
    }
    const tplBuf = await tplBlob.arrayBuffer();

    const { start, end } = monthWindowUtc(year, month);
    const reports: Array<{
      brand_id: number;
      brand_name: string;
      filename: string;
      url: string;
      storage_path: string;
      row_count: number;
      year: number;
      month: number;
    }> = [];

    for (const brand of brands) {
      // categories for this brand
      const { data: categories } = await admin.from("manufacturing_costs")
        .select("category, chubb_category").eq("brand_id", brand.id);

      // policies created in [start, end), status = 'live'
      const foreign =
        "brand_id: brands(*), shop_id: shops(*), profile_id: profiles(*), item_id: catalogues(*)";
      const { data: policies, error: pErr } = await admin.from("policies")
        .select(`*, ${foreign}`)
        .eq("brand_id", brand.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .eq("status", "live");
      if (pErr) {
        throw new Error(
          `Failed to fetch policies for ${brand.name}: ${pErr.message}`,
        );
      }

      const rows = (policies ?? [])
        .map((p) => policyToInternalRow(p, brand, categories ?? []));

      // Build the workbook from the template
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(tplBuf);
      const wsIn = wb.getWorksheet("Input");
      const wsOut = wb.getWorksheet("Output");
      if (!wsIn || !wsOut) {
        throw new Error("Template missing Input/Output sheets");
      }

      // Unmerge any cells in the data area so writes aren't swallowed
      const merges = (wsIn as any)._merges
        ? Object.keys((wsIn as any)._merges)
        : [];
      for (const range of merges) {
        try {
          wsIn.unMergeCells(range);
        } catch { /* ignore */ }
      }

      // Verify the header row matches what we expect
      for (let c = 1; c <= INTERNAL_COLS.length; c++) {
        const got = wsIn.getRow(1).getCell(c).value;
        const want = INTERNAL_COLS[c - 1];
        if (String(got ?? "") !== want) {
          throw new Error(
            `Template header mismatch col ${c}: got "${got}" want "${want}"`,
          );
        }
      }

      // Clear any pre-existing data rows in the table area
      const lastTplRow = wsIn.lastRow?.number ?? 1;
      for (let r = 2; r <= lastTplRow; r++) {
        for (let c = 1; c <= INTERNAL_COLS.length; c++) {
          wsIn.getRow(r).getCell(c).value = null;
        }
      }

      // Write data
      rows.forEach((row, idx) => {
        const r = 2 + idx;
        INTERNAL_COLS.forEach((col, ci) => {
          const cell = wsIn.getRow(r).getCell(ci + 1);
          const v = row[col];
          cell.value = v === undefined || v === null ? null : v;
        });
      });

      // Output sheet: premium / fee + sum formulas
      const lastDataRow = Math.max(2, 2 + rows.length - 1);
      wsOut.getCell("B2").value = brand.insurance_premium ?? 0;
      wsOut.getCell("B3").value = {
        formula: `SUM(Input!N2:N${lastDataRow})`,
      } as any;
      wsOut.getCell("B6").value = brand.activation_fee ?? 0;
      const rrpIdx = INTERNAL_COLS.indexOf("Recommended_Retail_Price") + 1;
      const rrpCol = columnLetter(rrpIdx);
      wsOut.getCell("B7").value = {
        formula: `SUM(Input!${rrpCol}2:${rrpCol}${lastDataRow})`,
      } as any;

      // Serialize + upload
      const buf = await wb.xlsx.writeBuffer();
      const safeBrand = brand.name.replace(/[\/\\]/g, "-").trim();
      const filename = `Internal_Policies_Report_${safeBrand}_${year}${
        String(month).padStart(2, "0")
      }.xlsx`;
      const storagePath = `${year}/${
        String(month).padStart(2, "0")
      }/${filename}`;
      const { error: upErr } = await admin.storage.from(OUTPUT_BUCKET).upload(
        storagePath,
        buf,
        {
          upsert: true,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
      if (upErr) {
        throw new Error(
          `Failed to upload report for ${brand.name}: ${upErr.message}`,
        );
      }

      const { data: signed } = await admin.storage.from(OUTPUT_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL);
      const url = signed?.signedUrl ?? "";

      // Best-effort row in `reports` so it shows up under /admin/reports
      try {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(
          0,
          10,
        );
        await admin.from("reports").insert({
          brand_id: brand.id,
          name: filename,
          url,
          type: "monthly_internal",
          direction: "outgoing",
          source: "ai_chat",
          start_date: startDate,
          end_date: endDate,
        });
      } catch (e) {
        console.warn("[generate-internal-report] reports insert failed", e);
      }

      reports.push({
        brand_id: brand.id,
        brand_name: brand.name,
        filename,
        url,
        storage_path: storagePath,
        row_count: rows.length,
        year,
        month,
      });
    }

    return new Response(
      JSON.stringify({
        reports,
        duration_ms: Date.now() - startedAt,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      },
    );
  } catch (err: any) {
    console.error("[generate-internal-report]", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "internal error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS },
      },
    );
  }
});
