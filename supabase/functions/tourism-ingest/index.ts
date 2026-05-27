// Tourism data ingest from ISTAT SDMX (public REST).
//
// Dataflow: 122_54_DF_DCSC_TUR_3 — "Movimento dei clienti negli esercizi
// ricettivi per tipo di esercizio - mensili". Province granularity for Veneto
// (NUTS-2006 codes ITD31..ITD37). Comune-level data is not in the free feed.
//
// Auth model:
//   - With service-role JWT (or no Authorization in local dev): proceeds.
//   - With a regular user JWT: must belong to an admin.
// Body (optional): { startPeriod: "YYYY-MM", endPeriod: "YYYY-MM", dryRun: bool }
// Default range: last 36 months ending current month.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VENETO_PROVINCES: { code: string; name: string }[] = [
  { code: "ITD31", name: "Verona" },
  { code: "ITD32", name: "Vicenza" },
  { code: "ITD33", name: "Belluno" },
  { code: "ITD34", name: "Treviso" },
  { code: "ITD35", name: "Venezia" },
  { code: "ITD36", name: "Padova" },
  { code: "ITD37", name: "Rovigo" },
];

const ISTAT_FLOW = "122_54_DF_DCSC_TUR_3";
// Dimension order in the dataflow key:
// FREQ.REF_AREA.DATA_TYPE.ADJUSTMENT.TYPE_ACCOMMODATION.ECON_ACTIVITY_NACE_2007
// .COUNTRY_RES_GUESTS.LOCALITY_TYPE.URBANIZ_DEGREE.COASTAL_AREA.SIZE_BY_NUMBER_ROOMS
// We fix:
//   FREQ = M, DATA_TYPE = AR or PR, ADJUSTMENT = N, TYPE_ACCOMMODATION = ALL,
//   ECON_ACTIVITY_NACE_2007 = 551_553 (alberghi + altri esercizi),
//   COUNTRY_RES_GUESTS = WORLD (totale), LOCALITY_TYPE/URBANIZ_DEGREE/COASTAL_AREA = ALL,
//   SIZE_BY_NUMBER_ROOMS = TOT.
function istatUrl(
  dataType: "AR" | "PR",
  startPeriod: string,
  endPeriod: string,
): string {
  const areas = VENETO_PROVINCES.map((p) => p.code).join("+");
  const key = [
    "M", areas, dataType, "N", "ALL", "551_553", "WORLD", "ALL", "ALL", "ALL", "TOT",
  ].join(".");
  const u = new URL(`https://esploradati.istat.it/SDMXWS/rest/data/${ISTAT_FLOW}/${key}/`);
  u.searchParams.set("startPeriod", startPeriod);
  u.searchParams.set("endPeriod", endPeriod);
  u.searchParams.set("format", "csv");
  return u.toString();
}

// CSV parser kept tiny on purpose: ISTAT CSV is comma-separated, no embedded
// commas in any field we read.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { headers, rows };
}

function monthShift(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodToDates(yyyymm: string): { start: string; end: string } {
  const [y, m] = yyyymm.split("-").map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  // Caller authentication: a service-role JWT (used by pg_cron / scheduler)
  // bypasses the admin lookup; user JWTs must map to an admin row.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing bearer token" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  const token = authHeader.slice("Bearer ".length);
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) {
      return new Response(JSON.stringify({ error: "invalid session" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    const { data: adminRow } = await userClient
      .from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "admin role required" }), {
        status: 403, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
  }

  const body = req.method === "POST"
    ? await req.json().catch(() => ({}))
    : Object.fromEntries(new URL(req.url).searchParams.entries());

  const today = new Date();
  const defaultEnd = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const endPeriod = String(body.endPeriod ?? defaultEnd);
  const startPeriod = String(body.startPeriod ?? monthShift(endPeriod, -36));
  const dryRun = Boolean(body.dryRun);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const provinceByCode = new Map(VENETO_PROVINCES.map((p) => [p.code, p.name]));
  const observations = new Map<string, {
    area_code: string;
    province: string;
    period_start: string;
    period_end: string;
    arrivals: number | null;
    presences: number | null;
  }>();

  const fetchWithRetry = async (url: string, attempts = 2, timeoutMs = 90_000): Promise<string> => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { headers: { "Accept": "text/csv" }, signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return await r.text();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
    }
    throw new Error(`ISTAT fetch failed after ${attempts} attempts: ${String((lastErr as Error)?.message ?? lastErr)}`);
  };

  const fetchType = async (dataType: "AR" | "PR") => {
    const url = istatUrl(dataType, startPeriod, endPeriod);
    const text = await fetchWithRetry(url);
    if (text.startsWith("NoRecordsFound")) {
      return { type: dataType, rows: 0 };
    }
    const { headers, rows } = parseCsv(text);
    const idx = {
      ref: headers.indexOf("REF_AREA"),
      dt:  headers.indexOf("DATA_TYPE"),
      tp:  headers.indexOf("TIME_PERIOD"),
      val: headers.indexOf("OBS_VALUE"),
    };
    if (idx.ref < 0 || idx.tp < 0 || idx.val < 0) {
      throw new Error(`ISTAT CSV missing required columns: ${headers.join(",")}`);
    }
    let count = 0;
    for (const row of rows) {
      const code = row[idx.ref];
      const province = provinceByCode.get(code);
      if (!province) continue;
      const period = row[idx.tp];
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const raw = row[idx.val];
      const val = raw === "" ? null : Number(raw);
      if (val !== null && !Number.isFinite(val)) continue;
      const { start, end } = periodToDates(period);
      const key = `${code}|${start}`;
      const prev = observations.get(key) ?? {
        area_code: code,
        province,
        period_start: start,
        period_end: end,
        arrivals: null,
        presences: null,
      };
      if (dataType === "AR") prev.arrivals = val;
      else                   prev.presences = val;
      observations.set(key, prev);
      count++;
    }
    return { type: dataType, rows: count };
  };

  let arResult, prResult;
  try {
    [arResult, prResult] = await Promise.all([fetchType("AR"), fetchType("PR")]);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const rowsToUpsert = Array.from(observations.values()).map((o) => ({
    region:       "Veneto",
    province:     o.province,
    area_code:    o.area_code,
    granularity:  "province",
    period_start: o.period_start,
    period_end:   o.period_end,
    arrivals:     o.arrivals,
    presences:    o.presences,
    source:       `ISTAT:${ISTAT_FLOW}`,
    scraped_at:   new Date().toISOString(),
  }));

  if (dryRun) {
    return new Response(JSON.stringify({
      dryRun: true,
      startPeriod, endPeriod,
      ar_rows: arResult.rows, pr_rows: prResult.rows,
      sample: rowsToUpsert.slice(0, 5),
      total_rows: rowsToUpsert.length,
    }), { headers: { "Content-Type": "application/json", ...CORS } });
  }

  // Chunked upsert to stay under Postgres parameter limits.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
    const chunk = rowsToUpsert.slice(i, i + CHUNK);
    const { error } = await admin
      .from("tourism_stats")
      .upsert(chunk, { onConflict: "area_code,granularity,period_start" });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, inserted }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    inserted += chunk.length;
  }

  return new Response(JSON.stringify({
    ok: true,
    startPeriod, endPeriod,
    ar_rows_parsed: arResult.rows,
    pr_rows_parsed: prResult.rows,
    upserted: inserted,
  }), { headers: { "Content-Type": "application/json", ...CORS } });
});
