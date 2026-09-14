// ==============================|| THE COMMERCIAL CYCLE ||============================== //
// The five steps from first meeting to operations review, the background stages that
// produce their collateral, and the mapping between them.
//
// This file exists because there were THREE copies of this knowledge and they had already
// drifted: a ten-entry PIPELINE list in CommercialCycle.tsx, a seven-entry STAGES list in
// BrandOnboarding.tsx with the same keys and the same labels, and ALL_STAGES in the
// onboard-brand function. Adding a stage server-side meant remembering two client lists,
// and the screen showed the same work twice with different subsets of it.
//
// The keys here MUST match ALL_STAGES in supabase/functions/onboard-brand/index.ts. That is
// the one duplication left, and it is unavoidable — the function is deployed separately and
// cannot import from src/ — so `pipelineStageKeys` below is asserted against a literal copy
// of that list in the tests, which fails the moment the two drift.

export type StepNumber = 1 | 2 | 3 | 4 | 5;

export type CycleStep = {
  n: StepNumber;
  title: string;
  blurb: string;
  produces: string;
  /** The imperative for this step's build button, and for the next-action card. */
  action: string;
  /** `brand_deck_outputs.template_key` this step hands over, when it produces a file. */
  artifact: string | null;
};

// The order is a DEFAULT, not a rule. Pricing regularly precedes the demo and the ops
// review sometimes comes early, so nothing built on this list may gate anything on it.
export const CYCLE_STEPS: readonly CycleStep[] = [
  {
    n: 1,
    title: "First meeting",
    blurb:
      "Intro to the service — objective, value, cost, how it works. Thirty minutes with one or two stakeholders, and it repeats with the others.",
    produces: "A teaser deck rebranded with their own pieces.",
    action: "Build the intro deck",
    artifact: "intro_teaser",
  },
  {
    n: 2,
    title: "NDA & data request",
    blurb:
      "They share an indicative pilot and roll-out perimeter so AION can go to Chubb for a formal quotation.",
    produces: "The data-request workbook, in their name.",
    action: "Build the data request",
    artifact: "data_request",
  },
  {
    n: 3,
    title: "Platform demo",
    blurb:
      "The platform on their own catalogue, brand side and client side, with a book of business that looks real.",
    produces: "A demo-ready account and logins for both portals.",
    action: "Set the demo up",
    artifact: null,
  },
  {
    n: 4,
    title: "Pricing",
    blurb:
      "The business case, on the quotes received so far. A formal Chubb quotation takes one to two months and supersedes it.",
    produces: "The pricing model and a deck built from it.",
    action: "Build the business case",
    artifact: "business_case",
  },
  {
    n: 5,
    title: "Operations review",
    blurb: "How the service works step by step, from the blueprint built across clients.",
    produces: "The ops deck, in the intro deck's own style.",
    action: "Build the ops deck",
    artifact: "operations",
  },
] as const;

export type StepState = "not_started" | "in_progress" | "done" | "skipped";

export const STEP_STATES: readonly { value: StepState; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
] as const;

export const stepStateLabel = (state: string | null | undefined): string =>
  STEP_STATES.find((s) => s.value === state)?.label ?? "Not started";

// ── The background pipeline ─────────────────────────────────────────────────────────── //

export type PipelineStage = {
  key: string;
  label: string;
  hint: string;
  /** Which step of the cycle this stage delivers the material for. */
  step: StepNumber;
  /** Fabricates clients, covers or logins. Only runs where that is allowed. */
  demo?: boolean;
};

// Queue order, which encodes the dependencies: nothing can be branded before the site is
// read, no deck can be built before the catalogue is pulled.
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { key: "branding", label: "Brand identity", step: 3, hint: "Logo, colours, description and hero imagery from their own site" },
  { key: "sources", label: "Website & news", step: 3, hint: "Register the site, discover pages, start the crawl" },
  { key: "storefront", label: "Catalogue", step: 3, hint: "Detect the e-commerce feed and pull the products" },
  { key: "intro_deck", label: "Intro deck", step: 1, hint: "The teaser, rebranded, with their most valuable pieces swapped in" },
  { key: "demo_data", label: "Demo book of business", step: 3, demo: true, hint: "Clients, covers, boutiques, claims and feedback" },
  { key: "demo_users", label: "Demo logins", step: 3, demo: true, hint: "Brand admin, sales associate and a client account" },
  { key: "documents", label: "Client documents", step: 3, hint: "FAQ, sales one-pager, cover summary, activation email, proposal — drafted in their voice" },
  { key: "assistant", label: "Assistant", step: 3, hint: "Confirm there is enough indexed to answer questions" },
  { key: "ops_deck", label: "Ops deck", step: 5, hint: "The operations booklet as a deck, in the intro deck's style" },
  { key: "data_request", label: "Data request", step: 2, hint: "The pilot workbook, in the prospect's own name" },
] as const;

export const pipelineStageKeys: readonly string[] = PIPELINE_STAGES.map((s) => s.key);

export const DEMO_STAGE_KEYS: readonly string[] = PIPELINE_STAGES.filter((s) => s.demo).map((s) => s.key);

export const stageByKey = (key: string): PipelineStage | undefined =>
  PIPELINE_STAGES.find((s) => s.key === key);

export const stagesForStep = (step: StepNumber): PipelineStage[] =>
  PIPELINE_STAGES.filter((s) => s.step === step);

export const stepByNumber = (n: number): CycleStep | undefined =>
  CYCLE_STEPS.find((s) => s.n === n);

/** The single stage that builds a step's file, when exactly one does. */
export const soleStageForStep = (step: StepNumber): PipelineStage | null => {
  const stages = stagesForStep(step);
  return stages.length === 1 ? stages[0] : null;
};

// ── Reading stage rows ──────────────────────────────────────────────────────────────── //

export type StageState = {
  status: string;
  queued?: boolean;
  attempts?: number | null;
  error?: string | null;
  detail?: Record<string, unknown> | null;
  finished_at?: string | null;
  started_at?: string | null;
};

export type StageDisplayState =
  | "done" | "failed" | "skipped" | "needs_input" | "running" | "working" | "stalled" | "queued" | "pending";

// How long a stage may claim to be running before nobody believes it.
//
// A stage sets status='running' and is only moved off it by the code that finishes. When an
// invocation is killed instead — a wall clock, an unbounded fetch, a deploy landing mid-run
// — the row stays 'running' with nothing to move it, and the server-side sweeper only looks
// every so often. In between, the screen was saying "Running now. It will land here when it
// finishes" about a stage that had already died, with its Run button disabled.
export const STALE_AFTER_MS = 15 * 60_000;

// `brand_onboarding` has no 'queued' status — a stage waiting for the cron tick is
// 'pending' WITH queued_at set, which the overview reports as `queued: true`. Reading the
// status alone made a queued run look exactly like one nobody had started, right down to an
// enabled Run button that queued it a second time.
export function stageDisplayState(state: StageState | null | undefined, optimistic = false): StageDisplayState {
  if (optimistic) return "queued";
  if (!state) return "pending";
  // Re-queueing is how a long stage carries its work across invocations: the catalogue read
  // hands back after a batch of pages and asks for the next one, once a minute, for as long
  // as the site takes. Between those batches the row is 'pending' with queued_at set — the
  // same shape as a stage nobody has ever run, and the screen said the same words about
  // both. Half an hour of "1 step waiting to start" is indistinguishable from a freeze.
  if (state.queued === true) return state.detail?.continue === true ? "working" : "queued";
  if (state.status === "pending") return "pending";
  if (state.status === "running") return isStalled(state) ? "stalled" : "running";
  // A stage that stopped to ask a question is not the same as one that was passed over.
  if (state.status === "skipped") return state.detail?.needs ? "needs_input" : "skipped";
  if (state.status === "done" || state.status === "failed") return state.status;
  return "pending";
}

/** A claim older than any invocation could live is abandoned, not in progress. */
export function isStalled(state: StageState | null | undefined): boolean {
  if (!state || state.status !== "running" || !state.started_at) return false;
  const started = new Date(state.started_at).getTime();
  return Number.isFinite(started) && Date.now() - started > STALE_AFTER_MS;
}

// A stalled stage is deliberately NOT busy: the step it feeds must stop waiting on it,
// and its own Run button has to come back.
export const isStageBusy = (s: StageDisplayState): boolean =>
  s === "running" || s === "working" || s === "queued";

/** Whether the pipeline currently owns a step, and pressing its build button would race it. */
export function stepIsBuilding(step: StepNumber, stages: Record<string, StageState> | undefined): boolean {
  return stagesForStep(step).some((s) => isStageBusy(stageDisplayState(stages?.[s.key])));
}

export type PipelineSummary = {
  total: number;
  done: number;
  failed: PipelineStage[];
  /** Stopped to ask something a person has to answer. Not a failure. */
  asking: PipelineStage[];
  running: PipelineStage | null;
  queued: number;
  active: boolean;
};

/**
 * What the pipeline is doing, from the stage rows the overview returns.
 *
 * Only stages that HAVE a row are counted: a brand onboarded before the pipeline existed
 * has none, and reporting "0 of 10 done" for a house with a full catalogue and an indexed
 * site is worse than reporting nothing.
 */
export function summarisePipeline(
  stages: Record<string, StageState> | undefined,
  visible: readonly PipelineStage[] = PIPELINE_STAGES,
): PipelineSummary {
  const known = visible.filter((s) => stages?.[s.key]);
  const at = (s: PipelineStage) => stageDisplayState(stages?.[s.key]);
  // A stage mid-batch is running as far as anyone reading this is concerned; the fact that
  // it is between invocations at this exact instant is an implementation detail.
  const running = known.find((s) => at(s) === "running" || at(s) === "working") ?? null;
  const queued = known.filter((s) => at(s) === "queued").length;
  return {
    total: known.length,
    // A stage that was passed over, or that cannot ever run here, is settled — counting it
    // as outstanding leaves a healthy brand stuck at "7 of 10" for good.
    done: known.filter((s) => ["done", "skipped"].includes(at(s))).length,
    failed: known.filter((s) => at(s) === "failed"),
    asking: known.filter((s) => at(s) === "needs_input"),
    running,
    queued,
    active: !!running || queued > 0,
  };
}

// ── The one thing to do next ────────────────────────────────────────────────────────── //
//
// The cycle screen could answer "where is this deal" in three different places at once — a
// stage banner, a row of dots, and a status line inside each of five collapsed steps — and
// none of them answered the question anyone actually arrives with, which is what to do now.
// Working it out meant opening all five.
//
// This is that answer, as one sentence and one button. It is a pure function of what the
// overview already returns, so it cannot drift from what the rest of the screen shows.

export type NextActionKind = "blocked" | "waiting" | "build" | "open" | "record" | "done";

export type NextAction = {
  kind: NextActionKind;
  /** The step it belongs to, when it belongs to one. */
  step: StepNumber | null;
  /** The imperative, in one short line. */
  title: string;
  /** Why, or what it is waiting for. */
  detail: string;
};

export type CycleFacts = {
  website: string | null | undefined;
  pipeline: PipelineSummary;
  /** Step number as a string -> its recorded state, as the overview returns it. */
  progress: Record<string, { state: string }> | undefined;
  /** `brand_deck_outputs.template_key` -> the artefact. Presence is all that matters here. */
  artifacts: Record<string, unknown> | undefined;
  /** Whether a pilot perimeter has been declared for the business case. */
  perimeterDeclared: boolean;
  /** Whether demo tooling may run for this brand at all. */
  demoAllowed: boolean;
  /** Products in the catalogue. The deck and the demo are both built from them. */
  products: number;
};

const built = (facts: CycleFacts, key: string | null): boolean =>
  !!key && !!facts.artifacts?.[key];

export function nextAction(facts: CycleFacts): NextAction {
  // Nothing at all can be built from a brand with no site, so it outranks everything.
  if (!String(facts.website ?? "").trim()) {
    return {
      kind: "blocked", step: null,
      title: "Add a website to the brand record",
      detail: "The deck, the catalogue and the demo are all built from the house's own site.",
    };
  }

  // A failure is louder than work in flight: the rest of the pipeline may be moving, but
  // this one is not going to move again on its own.
  const failed = facts.pipeline.failed[0];
  if (failed) {
    return {
      kind: "blocked", step: failed.step,
      title: `${failed.label} failed`,
      detail: "Open it in the pipeline above to see why, and run it again.",
    };
  }

  const asking = facts.pipeline.asking[0];
  if (asking) {
    return {
      kind: "blocked", step: asking.step,
      title: `${asking.label} is waiting on you`,
      detail: "It stopped to ask something. Open it in the pipeline above.",
    };
  }

  if (facts.pipeline.active) {
    const { done, total } = facts.pipeline;
    return {
      kind: "waiting", step: facts.pipeline.running?.step ?? null,
      title: facts.pipeline.running ? `Building ${facts.pipeline.running.label.toLowerCase()}` : "The pipeline is working",
      detail: `${done} of ${total} stages done. This runs on the server — you can leave the page.`,
    };
  }

  // Then the first step with nothing to hand over. In cycle order, because that is the
  // order a deal moves in even though any one step may be taken out of turn.
  for (const step of CYCLE_STEPS) {
    if (step.n === 3) {
      // Step 3 hands over an account rather than a file.
      if (!facts.demoAllowed || facts.products > 0) continue;
      return {
        kind: "blocked", step: 3,
        title: "No catalogue to demo",
        detail: "The demo shows their own pieces. Run the Catalogue stage, or add a feed URL on the catalogue source.",
      };
    }
    if (built(facts, step.artifact)) continue;
    if (step.n === 4 && !facts.perimeterDeclared) {
      // Not a build: there is nothing to build from yet. The work is in the panel.
      return {
        kind: "open", step: 4,
        title: "Declare the pilot perimeter",
        detail: "Upload the data request they sent back and the segments are read out of it.",
      };
    }
    return { kind: "build", step: step.n, title: step.action, detail: step.produces };
  }

  // Everything that can be built has been. What is left is what happened in the room.
  const unrecorded = CYCLE_STEPS.filter((s) => {
    const state = facts.progress?.[String(s.n)]?.state ?? "not_started";
    return state !== "done" && state !== "skipped";
  });
  if (unrecorded.length) {
    const first = unrecorded[0];
    return {
      kind: "record", step: first.n,
      title: `Record where "${first.title}" got to`,
      detail: "Every file is built. Marking a step is the only thing the platform cannot see for itself.",
    };
  }

  return {
    kind: "done", step: null,
    title: "All five steps are behind you",
    detail: "Go-live is the next tab.",
  };
}
