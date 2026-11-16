// ==============================|| WHAT A FINISHED ONBOARDING LEFT FOR A PERSON ||============================== //
//
// A brand is built by ten stages over half an hour, and every one of them writes down what
// it could not decide on its own: "the description came from SEO metadata — worth
// rewriting", "no legal entity could be established", "read the booklet's SLA figures
// before sending". All of it was on the screen, one stage at a time, behind a click on each
// chip — so the person who created the brand did not know when it had finished, or what
// it wanted from them, without asking whoever could read the database.
//
// This is that list, once, in the order a person would work through it. It is pure (no
// Deno, no DOM) so the finish email and the pipeline panel read the same thing.

export type ReviewStageRow = {
  stage: string;
  status: string;
  error?: string | null;
  detail?: Record<string, unknown> | null;
  queued_at?: string | null;
};

export type ReviewBrand = {
  legal_name?: string | null;
  registered_address?: string | null;
  description?: string | null;
};

export type ReviewItem = { stage: string; label: string; text: string };

// Kept in pipeline order; the labels are the ones the admin screen uses
// (PIPELINE_STAGES in src/lib/commercialCycle.ts).
export const STAGE_LABELS: Record<string, string> = {
  branding: "Brand identity",
  sources: "Website & news",
  storefront: "Catalogue",
  intro_deck: "Intro deck",
  demo_data: "Demo book of business",
  demo_users: "Demo logins",
  documents: "Client documents",
  assistant: "Assistant",
  ops_deck: "Ops deck",
  data_request: "Data request",
};

const ORDER = Object.keys(STAGE_LABELS);
const labelOf = (stage: string) => STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
const byOrder = (a: string, b: string) =>
  (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b));

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];

// Every stage writes notes, and most of them are a record of what it did ("7 images are now
// held in AION storage", "Cropped to the frame: slide 4 (34%…)"). These are the ones that
// ask a person for something. Shaft's first email carried 18 lines; a third were reports.
const ASKS = /worth|check|confirm|by hand|need(s)? doing|fill (it|them)|before (a client|publishing|the first|sending|it goes)|still pointing|monogram|rewrit|run this again|open each|read it through|add the/i;

// The legal entity and the registered office are read from the brand RECORD below, because
// a stage's note about them goes stale the moment either is filled in or a later stage
// finds it — and the data request and ops deck each repeat it in their own words.
const ABOUT_THE_RECORD = /legal entity|registered (office|address)|product focus left blank/i;

/** The things a person has to look at before the brand is shown to anyone. */
export function reviewItems(rows: ReviewStageRow[], brand?: ReviewBrand | null): ReviewItem[] {
  const out: ReviewItem[] = [];
  const add = (stage: string, text: string) => {
    const t = text.trim();
    if (t && !out.some((o) => o.text === t)) out.push({ stage, label: labelOf(stage), text: t });
  };

  // Failures first: nothing else on the list matters as much as a stage that did not run.
  for (const r of [...rows].sort((a, b) => byOrder(a.stage, b.stage))) {
    if (r.status === "failed") {
      add(r.stage, `Did not complete: ${r.error || "no reason recorded"}. Run it again from the pipeline panel.`);
    } else if (r.status === "skipped" && !r.detail?.policy) {
      const why = typeof r.detail?.reason === "string" ? r.detail.reason : r.error;
      add(r.stage, `Skipped${why ? `: ${why}` : ""}.`);
    }
  }

  if (brand) {
    if (!String(brand.legal_name ?? "").trim()) {
      add("branding", "No legal entity on the brand record — the data request and the ops deck use the trading name until it is filled in.");
    }
    if (!String(brand.registered_address ?? "").trim()) {
      add("branding", "No registered office on the brand record — the data request goes out with it blank.");
    }
  }

  for (const r of [...rows].sort((a, b) => byOrder(a.stage, b.stage))) {
    if (r.status !== "done") continue;
    const d = (r.detail ?? {}) as Record<string, unknown>;
    if (r.stage === "branding") {
      for (const n of strings(d.notes)) if (ASKS.test(n) && !ABOUT_THE_RECORD.test(n)) add(r.stage, n);
    } else if (r.stage === "documents") {
      const written = typeof d.written === "number" ? d.written : 0;
      if (written > 0) add(r.stage, `${written} drafted in the house's voice — read them on the Documents tab before they go anywhere.`);
      const failed = strings(d.failed);
      if (failed.length) add(r.stage, `Could not draft: ${failed.join(", ")}.`);
    } else {
      for (const n of strings(d.review)) if (ASKS.test(n) && !ABOUT_THE_RECORD.test(n)) add(r.stage, n);
    }
  }
  return out;
}

export type RunOutcome = {
  done: string[];
  failed: string[];
  /** Could not run — what it needed never arrived. Not a failure, not done either. */
  skipped: string[];
  /** Still queued or running — only when the run was closed by the time cap. */
  unfinished: string[];
  /** Passed over because they must not run here (demo stages of a live client). */
  notApplicable: string[];
};

export function runOutcome(rows: ReviewStageRow[]): RunOutcome {
  const sorted = [...rows].sort((a, b) => byOrder(a.stage, b.stage));
  const inFlight = (r: ReviewStageRow) => r.status === "running" || (r.status === "pending" && !!r.queued_at);
  return {
    done: sorted.filter((r) => r.status === "done").map((r) => r.stage),
    failed: sorted.filter((r) => r.status === "failed").map((r) => r.stage),
    skipped: sorted.filter((r) => r.status === "skipped" && !r.detail?.policy).map((r) => r.stage),
    unfinished: sorted.filter(inFlight).map((r) => r.stage),
    notApplicable: sorted.filter((r) => r.status === "skipped" && !!r.detail?.policy).map((r) => r.stage),
  };
}

/** One line of what a finished stage produced, for the email. Null when it has nothing to say. */
export function resultLine(row: ReviewStageRow): string | null {
  const d = (row.detail ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  if (row.status === "failed") return `failed — ${row.error || "no reason recorded"}`;
  if (row.status === "skipped") return d.policy ? "not for this brand" : `skipped${typeof d.reason === "string" ? ` — ${d.reason}` : ""}`;
  if (row.status !== "done") return row.queued_at || row.status === "running" ? "still running" : null;
  switch (row.stage) {
    case "branding": {
      const filled = strings(d.filled);
      return filled.length ? `${filled.length} fields filled from the site` : "nothing new to fill";
    }
    case "sources": {
      const s = (d.seeded ?? {}) as Record<string, unknown>;
      return typeof s.page_urls === "number" ? `${s.page_urls} pages queued for indexing` : null;
    }
    case "storefront":
      return d.platform === "none" || d.platform === "blocked"
        ? String(d.note ?? (d.platform === "blocked" ? "the shop blocks automated reads" : "no product feed on this site"))
        : `${n("products") ?? 0} products${typeof d.platform === "string" ? ` (${d.platform})` : ""}`;
    case "demo_data":
      return `${n("customers") ?? 0} clients · ${n("policies") ?? 0} covers · ${n("shops") ?? 0} boutiques`;
    case "demo_users":
      return d.accounts && typeof d.accounts === "object" ? `${Object.keys(d.accounts as object).length} logins created` : "logins ready";
    case "documents":
      return `${n("written") ?? 0} documents drafted`;
    case "assistant":
      return `${n("knowledge_chunks") ?? 0} knowledge chunks indexed`;
    case "intro_deck":
    case "ops_deck":
    case "data_request":
      return typeof d.file_name === "string" ? d.file_name : "built";
    default:
      return "done";
  }
}

export const stageLabel = labelOf;
export const stageOrder = byOrder;
