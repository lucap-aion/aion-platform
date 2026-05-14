// Daily Chubb export generator.
// TypeScript port of aion_services/aion_cronjobs/chubb.run_daily_policies_report
// and run_daily_claims_report — generates the CSV/XLSX that the cron normally
// pushes to Chubb's SFTP, BUT does not upload to SFTP. Instead it uploads to
// the existing `policies_daily_reports` / `claims_daily_reports` Storage
// buckets, signs a download URL, and adds a row to `reports`.
//
// kinds:
//  - new_policies        → policies WHERE status='live' AND created_at on date
//  - cancelled_policies  → policies WHERE status='cancelled' AND cancelled_at on date
//  - claims              → claims WHERE status='open' AND created_at on date
//
// SFTP push stays on cron / `upload_ready_sales_file_from_url` in aion_services.

import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const POLICIES_BUCKET = "policies_daily_reports";
const CLAIMS_BUCKET = "claims_daily_reports";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Kind = "new_policies" | "cancelled_policies" | "claims";

// ─── Helpers (port of chubb.py utilities) ────────────────────────────────────

const LINEBREAK_RE = /[\r\n\t\v\f\u0085\u2028\u2029]+/g;

const normalizeOneLine = (s: unknown): string => {
  if (s === null || s === undefined) return "";
  return String(s).replace(LINEBREAK_RE, " ").replace(/\s+/g, " ").trim();
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

const formatDate = (
  s: string | null | undefined,
  separator: "-" | "/",
): string => {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}${separator}${mm}${separator}${yyyy}`;
};

const dayWindowUtc = (yyyymmdd: string) => {
  const start = `${yyyymmdd}T00:00:00Z`;
  const end = `${yyyymmdd}T23:59:59Z`;
  return { start, end };
};

const yesterdayUtc = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const isValidDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ─── Chubb formatters (ports of parse_policy_data + parse_claim_data) ────────

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
  row.Date_of_call = formatDate(
    policy.status === "live" ? policy.start_date : policy.cancelled_at,
    "-",
  );
  row.Effective_from = formatDate(policy.start_date, "-");
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

const parseClaimToChubbRow = (
  claim: any,
  categories: any[],
  brandName: string,
  brandChubbPrefix: string,
): Record<string, any> => {
  const policy = claim.policy_id ?? {};
  const brand = policy.brand_id ?? {};
  const shop = policy.shop_id ?? {};
  const item = policy.item_id ?? {};
  const row: Record<string, any> = {};
  row["Company"] = brandName || brand.name || "";
  row["Company Claim Number"] = claim.id;
  row["Chubb Policy Number"] = generateChubbPolicyNumber(
    brandChubbPrefix || brand.chubb_policy_prefix || "",
    Number(policy.id),
  );
  row["Item Sale ID"] = policy.brand_sale_id ?? "";
  row["Sale Country"] = shop.country ?? "";
  row["Sale Store Location"] = shop.name ?? "";
  row["Item Serial Number"] = policy.brand_row_id ?? "";
  row["Proof of Sale?"] = "Y";
  row["Item Sale Date"] = formatDate(policy.start_date, "/");
  row["Claim Event Date"] = formatDate(claim.incident_date, "/");
  row["Claim Reported Date"] = formatDate(claim.created_at, "/");
  row["Claim Status"] = String(claim.status ?? "").toUpperCase();
  row["Claim Status Specific"] = policy.id;
  row["Event Type"] = String(claim.type ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  row["Item Category"] = mapCategoryToChubb(item.category, categories);
  row["Item Model"] = item.name ?? "";
  const sp = Number(policy.selling_price);
  const cg = Number(policy.cogs);
  const qty = Number(claim.quantity ?? policy.quantity ?? 1);
  row["Retail Price"] = Number.isFinite(sp) ? sp * qty : "";
  row["Manufacturing cost"] = Number.isFinite(cg) ? cg * qty : "";
  row["AION Claim Contact"] = "Giulio Rossi Prodi";
  return row;
};

// ─── Column lists (mirror constants.CHUBB_SALES_FILE_COLS / CLAIMS_FILE_COLS)

const CHUBB_SALES_FILE_COLS = [
  "Transaction_type","Canc_type","Client_No","Caller_code","Date_of_call",
  "System6_Number","Effective_from","Policy_Number","Campaign_No","Title",
  "First_Name","Middle_Name","Last_Name","Address_Line_1","Address_Line_2",
  "Address_Line_3","Address_Line_4","Town/City","PostCode","Province",
  "Home_Telephone","Work_Telephone","Mobile_Telephone","Email_Address",
  "Fulfillment","Personal_ID","Date_of_birth","Sex","Language","Reference_No",
  "Profession","DataP","DataS","DataC1","DataC2","DataC3","DataC4",
  "Payment_Type","Credit_Card_Number","Card_Expiry_Date","Credit_Card_type",
  "Bank_code","Bank_Account_Num","Account_Name","Payment_Frequency",
  "MI_ProductA_Code","MI_ProductA_option","MI_ProductB_Code","MI_ProductB_option",
  "MI_ProductC_Code","MI_ProductC_option","SP_First_Name","SP_Middle_Name",
  "SP_Last_Name","SP_Personal_ID","SP_Date_of_birth","SP_Sex","SP_ProductA_Code",
  "SP_ProductA_option","SP_ProductB_Code","SP_ProductB_option","SP_ProductC_Code",
  "SP_ProductC_option",
  ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap((d) => [
    `DP${d}_First_Name`,`DP${d}_Middle_Name`,`DP${d}_Last_Name`,`DP${d}_Personal_ID`,
    `DP${d}_Date_of_birth`,`DP${d}_Sex`,`DP${d}_ProductA_Code`,`DP${d}_ProductA_option`,
    `DP${d}_ProductB_Code`,`DP${d}_ProductB_option`,`DP${d}_ProductC_Code`,`DP${d}_ProductC_option`,
  ]),
  "Reference_1","Reference_2","Reference_3",
  "MI_Beneficiary_Details","SP_Beneficiary_Details",
  ...Array.from({ length: 8 }, (_, i) => i + 1).map((d) => `DP${d}_Beneficiary_Details`),
  "From_Date","To_Date","Destination",
  ...Array.from({ length: 20 }, (_, i) => `Detail_${i + 1}`),
];

const CHUBB_CLAIMS_FILE_COLS = [
  "Company","Company Claim Number","Chubb Policy Number","Item Sale ID",
  "Sale Country","Sale Store Location","Item Serial Number","Proof of Sale?",
  "Item Sale Date","Claim Event Date","Claim Reported Date","Claim Status",
  "Claim Status Specific","Event Type","Item Category","Item Model",
  "Retail Price","Manufacturing cost","Deductible","Proposed Action",
  "Company Pecuniary Loss","THEFT/ROBBERY Claim per item & Cov. Period",
  "THR - Theft Report?","THR - Theft Report Number","THR - Theft Report Date",
  "THR - Theft Report to:","THR - Theft in any Property without breaking?",
  "THR - Theft from vehicle?","THR - Unattended in public place?",
  "THR - Item entrusted to third parties?",
  "THR - Item not worn/monitored theft outside Property?",
  "DAMAGE Claim per item & Cov. Period","DAM - Accidental Damage?",
  "DAM - Intentional Damage?","DAM - Client Neglicence?",
  "DAM - Accessories/Consumable parts Damage?","DAM - Item entrusted to third parties?",
  "DAM - Aesthetic damage caused by wear?","DAM - Manufacturing defect?",
  "DAM - Damaged Item Collection?","Comments","AION Claim Contact",
  "Chubb Claim Approval","Chubb Audit on claim date","Chubb Claim Approval Date",
  "Reason for No Payment","Claim Closure Date","Chubb Bulk Claim",
];

// ─── CSV writer (matches pandas.to_csv with QUOTE_NONNUMERIC + escapechar="\\")

const isNumeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const escapeCsvField = (v: unknown): string => {
  if (v === null || v === undefined) return '""';
  if (isNumeric(v)) return String(v);
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // pandas escapechar='\\' replaces embedded " with \" (instead of doubling)
  s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${s}"`;
};

const rowsToCsv = (
  columns: readonly string[],
  rows: Record<string, unknown>[],
): string => {
  const header = columns.map((c) => `"${c}"`).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCsvField(r[c])).join(","))
    .join("\n");
  return rows.length === 0 ? header + "\n" : header + "\n" + body + "\n";
};

// ─── Claims XLSX writer (the cron job produces .xlsx for claims) ─────────────

const rowsToClaimsXlsx = async (
  columns: readonly string[],
  rows: Record<string, unknown>[],
): Promise<ArrayBuffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AION Cover";
  wb.created = new Date();
  const ws = wb.addWorksheet("Claims");
  ws.columns = columns.map((c) => ({
    header: c,
    key: c,
    width: Math.min(40, Math.max(12, c.length + 4)),
  }));
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  return await wb.xlsx.writeBuffer();
};

// ─── Data fetchers ───────────────────────────────────────────────────────────

const fetchBrands = async (admin: any, brandId: number | null) => {
  let q = admin
    .from("brands")
    .select(
      "id, name, chubb_policy_prefix, enable_chubb_reporting",
    )
    .eq("enable_chubb_reporting", true);
  if (brandId) q = q.eq("id", brandId);
  const { data, error } = await q;
  if (error) throw new Error(`fetchBrands: ${error.message}`);
  return data ?? [];
};

const fetchCategories = async (admin: any, brandId: number) => {
  const { data } = await admin
    .from("manufacturing_costs")
    .select("category, chubb_category")
    .eq("brand_id", brandId);
  return data ?? [];
};

const FOREIGN_POLICY =
  "brand_id: brands(*), shop_id: shops(*), profile_id: profiles(*), item_id: catalogues(*)";

const fetchNewPolicies = async (
  admin: any,
  brandId: number,
  dayIso: string,
) => {
  const { start, end } = dayWindowUtc(dayIso);
  const { data, error } = await admin
    .from("policies")
    .select(`*, ${FOREIGN_POLICY}`)
    .eq("brand_id", brandId)
    .gte("created_at", start)
    .lte("created_at", end)
    .eq("status", "live");
  if (error) throw new Error(`fetchNewPolicies: ${error.message}`);
  return data ?? [];
};

const fetchCancelledPolicies = async (
  admin: any,
  brandId: number,
  dayIso: string,
) => {
  const { start, end } = dayWindowUtc(dayIso);
  const { data, error } = await admin
    .from("policies")
    .select(`*, ${FOREIGN_POLICY}`)
    .eq("brand_id", brandId)
    .gte("cancelled_at", start)
    .lte("cancelled_at", end)
    .eq("status", "cancelled");
  if (error) throw new Error(`fetchCancelledPolicies: ${error.message}`);
  return data ?? [];
};

const fetchClaims = async (admin: any, brandId: number, dayIso: string) => {
  const { start, end } = dayWindowUtc(dayIso);
  const { data, error } = await admin
    .from("claims")
    .select(
      `*, policy_id: policies(*, ${FOREIGN_POLICY})`,
    )
    .gte("created_at", start)
    .lte("created_at", end)
    .eq("status", "open");
  if (error) throw new Error(`fetchClaims: ${error.message}`);
  // Filter to brand client-side because the FK lives on the embedded policy.
  return (data ?? []).filter((c: any) => c.policy_id?.brand_id?.id === brandId);
};

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  const startedAt = Date.now();
  const jsonResp = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp(401, { error: "missing bearer token" });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResp(401, { error: "invalid session" });
    const { data: adminRow } = await userClient.from("admins")
      .select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return jsonResp(403, { error: "admin role required" });

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind ?? "new_policies") as Kind;
    if (
      kind !== "new_policies" &&
      kind !== "cancelled_policies" &&
      kind !== "claims"
    ) {
      return jsonResp(400, {
        error:
          'kind must be one of: "new_policies", "cancelled_policies", "claims"',
      });
    }
    const date = body.date ? String(body.date) : yesterdayUtc();
    if (!isValidDate(date)) {
      return jsonResp(400, { error: "date must be YYYY-MM-DD" });
    }
    const brandId = body.brand_id != null ? Number(body.brand_id) : null;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const brands = await fetchBrands(admin, brandId);
    if (brands.length === 0) {
      return jsonResp(400, {
        error: brandId
          ? `Brand ${brandId} is not configured for Chubb reporting`
          : "No Chubb-enabled brands found",
      });
    }

    const isClaims = kind === "claims";
    const bucket = isClaims ? CLAIMS_BUCKET : POLICIES_BUCKET;
    const ext = isClaims ? "xlsx" : "csv";
    const contentType = isClaims
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv;charset=utf-8";

    const reports: Array<{
      brand_id: number;
      brand_name: string;
      kind: Kind;
      date: string;
      filename: string;
      url: string;
      storage_path: string;
      row_count: number;
    }> = [];

    for (const brand of brands) {
      const categories = await fetchCategories(admin, brand.id);
      const raw = kind === "new_policies"
        ? await fetchNewPolicies(admin, brand.id, date)
        : kind === "cancelled_policies"
        ? await fetchCancelledPolicies(admin, brand.id, date)
        : await fetchClaims(admin, brand.id, date);

      // Map raw rows to Chubb-formatted records
      const records = isClaims
        ? raw.map((c: any) =>
            parseClaimToChubbRow(
              c,
              categories,
              brand.name,
              brand.chubb_policy_prefix ?? "",
            ),
          )
        : raw.map((p: any) =>
            parsePolicyToChubbRow(
              p,
              brand.name,
              brand.chubb_policy_prefix ?? "",
              categories,
            ),
          );

      // Serialize
      let body: Uint8Array | ArrayBuffer;
      if (isClaims) {
        body = await rowsToClaimsXlsx(CHUBB_CLAIMS_FILE_COLS, records);
      } else {
        body = new TextEncoder().encode(
          rowsToCsv(CHUBB_SALES_FILE_COLS, records),
        );
      }

      const safeBrand = brand.name.replace(/[\/\\]/g, "-").trim();
      const filePrefix = isClaims
        ? "Claims"
        : kind === "cancelled_policies"
        ? "SalesFile_Cancelled"
        : "SalesFile";
      const filename = `${filePrefix}_${safeBrand}_${date.replace(/-/g, "")}.${ext}`;
      const storagePath = `${date.slice(0, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}/${filename}`;

      const { error: upErr } = await admin.storage.from(bucket).upload(
        storagePath,
        body,
        { upsert: true, contentType },
      );
      if (upErr) {
        throw new Error(
          `Failed to upload ${kind} report for ${brand.name}: ${upErr.message}`,
        );
      }
      const { data: signed } = await admin.storage.from(bucket)
        .createSignedUrl(storagePath, SIGNED_URL_TTL);
      const url = signed?.signedUrl ?? "";

      // reports table row (best-effort)
      try {
        await admin.from("reports").insert({
          brand_id: brand.id,
          name: filename,
          url,
          type: kind === "claims"
            ? "daily_claims"
            : kind === "cancelled_policies"
            ? "daily_cancelled_policies"
            : "daily_new_policies",
          direction: "outgoing",
          source: "ai_chat",
          start_date: date,
          end_date: date,
        });
      } catch (e) {
        console.warn("[generate-daily-chubb-export] reports insert failed", e);
      }

      reports.push({
        brand_id: brand.id,
        brand_name: brand.name,
        kind,
        date,
        filename,
        url,
        storage_path: storagePath,
        row_count: records.length,
      });
    }

    return jsonResp(200, {
      reports,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err: any) {
    console.error("[generate-daily-chubb-export]", err);
    return jsonResp(500, { error: err?.message ?? "internal error" });
  }
});
