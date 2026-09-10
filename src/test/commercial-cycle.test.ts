import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CYCLE_STEPS, PIPELINE_STAGES, pipelineStageKeys, DEMO_STAGE_KEYS,
  stageDisplayState, stepIsBuilding, summarisePipeline, stagesForStep, stepStateLabel, isStalled,
  type StageState,
} from "@/lib/commercialCycle";

describe("the stage list is one list", () => {
  // The client cannot import from a Deno function, so this is the one place the stage keys
  // are duplicated. Reading the real file means the duplication cannot drift silently:
  // adding a stage server-side fails here until the shared definition learns about it.
  it("matches ALL_STAGES in the onboard-brand function, in order", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/onboard-brand/index.ts"), "utf8");
    const block = /const ALL_STAGES = \[([\s\S]*?)\] as const;/.exec(src);
    expect(block, "ALL_STAGES not found — has onboard-brand been restructured?").toBeTruthy();
    const keys = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(pipelineStageKeys).toEqual(keys);
  });

  it("agrees with the function about which stages fabricate data", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/onboard-brand/index.ts"), "utf8");
    const block = /const DEMO_STAGES = \[([\s\S]*?)\] as const;/.exec(src);
    const keys = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(DEMO_STAGE_KEYS).toEqual(keys);
  });

  it("gives every stage a step that exists", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(CYCLE_STEPS.some((s) => s.n === stage.step), `${stage.key} -> step ${stage.step}`).toBe(true);
    }
  });

  it("hands each artifact kind to exactly one step", () => {
    const kinds = CYCLE_STEPS.map((s) => s.artifact).filter(Boolean);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("reading a stage row", () => {
  const row = (over: Partial<StageState>): StageState =>
    ({ status: "pending", queued: false, attempts: 0, error: null, detail: {}, finished_at: null, ...over });

  it("tells a queued stage from one nobody ever started", () => {
    // brand_onboarding has no 'queued' status: a stage waiting for the cron tick is
    // 'pending' WITH queued_at set. Reading the status alone made a run that was
    // progressing fine look idle, with an enabled Run button that queued it a second time.
    expect(stageDisplayState(row({ status: "pending", queued: true }))).toBe("queued");
    expect(stageDisplayState(row({ status: "pending", queued: false }))).toBe("pending");
    expect(stageDisplayState(undefined)).toBe("pending");
  });

  it("shows the optimistic queue immediately after a click", () => {
    expect(stageDisplayState(undefined, true)).toBe("queued");
  });

  it("tells a stage carrying work across batches from one that has not begun", () => {
    // The catalogue read hands back after a batch of pages and re-queues itself, once a
    // minute, until the site is read. Both are 'pending' with queued_at set, so Ferragamo
    // spent half an hour reporting "1 step waiting to start" while it was in fact on page
    // sixty of a hundred and thirty-five — indistinguishable from a frozen pipeline.
    const mid = row({ status: "pending", queued: true, detail: { continue: true, pages_done: 60, pages_total: 135 } });
    expect(stageDisplayState(mid)).toBe("working");
    expect(stageDisplayState(row({ status: "pending", queued: true, detail: { continue: false } }))).toBe("queued");
  });

  it("counts a stage mid-batch as the one that is running", () => {
    // Otherwise the header falls through to "N steps waiting to start" and, worse, the
    // whole panel reads as idle-but-blocked: "Re-run everything" is disabled while
    // summary.active is true, so there is no way out and nothing to watch.
    const summary = summarisePipeline({
      branding: row({ status: "done" }),
      storefront: row({ status: "pending", queued: true, detail: { continue: true, pages_done: 60, pages_total: 135 } }),
    });
    expect(summary.running?.key).toBe("storefront");
    expect(summary.queued).toBe(0);
    expect(summary.active).toBe(true);
  });
});

describe("a stage that stopped reporting", () => {
  const running = (minutesAgo: number): StageState => ({
    status: "running",
    started_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });

  it("believes a claim that is still plausible", () => {
    expect(stageDisplayState(running(2))).toBe("running");
    expect(isStalled(running(2))).toBe(false);
  });

  it("stops believing one that outlived any invocation", () => {
    // Nothing moves a row off 'running' except the code that finishes it, so a killed run
    // leaves the claim standing. The screen used to say "Running now. It will land here
    // when it finishes" about a stage that had died twenty minutes earlier, with its Run
    // button disabled — and after three such deaths the server gave up too, which froze
    // every OTHER stage of that brand as well.
    expect(stageDisplayState(running(20))).toBe("stalled");
    expect(isStalled(running(20))).toBe(true);
  });

  it("does not hold the step it feeds hostage once it has stalled", () => {
    // stepIsBuilding keeps a step's build button disabled while the pipeline owns it. A
    // stage nobody is running must give the button back.
    expect(stepIsBuilding(1, { intro_deck: running(2) })).toBe(true);
    expect(stepIsBuilding(1, { intro_deck: running(20) })).toBe(false);
  });

  it("says nothing about a row with no start time", () => {
    expect(isStalled({ status: "running" })).toBe(false);
    expect(isStalled({ status: "done", started_at: new Date(0).toISOString() })).toBe(false);
    expect(isStalled(undefined)).toBe(false);
  });
});

describe("not everything unfinished is broken", () => {
  it("tells a stage that asked a question from one that broke", () => {
    // The demo book stops to ask for a typical retail price when a site renders its prices
    // in JavaScript. That is a question for the admin, and showing it as a failure puts a
    // red mark on a healthy brand and sends someone to fix a site with nothing wrong.
    expect(stageDisplayState({ status: "skipped", detail: { needs: "avg_ticket" } })).toBe("needs_input");
    expect(stageDisplayState({ status: "skipped", detail: {} })).toBe("skipped");
    expect(stageDisplayState({ status: "failed", error: "boom" })).toBe("failed");
  });

  it("counts a settled stage as settled, not as outstanding", () => {
    // ferragamo.com publishes no catalogue, so its intro deck can never be built. Leaving it
    // outstanding pins the brand at "7 of 10 done" for ever.
    const summary = summarisePipeline({
      branding: { status: "done" },
      sources: { status: "done" },
      intro_deck: { status: "skipped", detail: { reason: "no catalogue on this site" } },
    });
    expect(summary.done).toBe(3);
    expect(summary.total).toBe(3);
    expect(summary.failed).toEqual([]);
  });

  it("keeps a question out of the failure count and in its own", () => {
    const summary = summarisePipeline({
      demo_data: { status: "skipped", detail: { needs: "avg_ticket" } },
      storefront: { status: "failed", error: "timed out" },
    });
    expect(summary.asking.map((s) => s.key)).toEqual(["demo_data"]);
    expect(summary.failed.map((s) => s.key)).toEqual(["storefront"]);
    // A question is not progress either — it is not counted as done.
    expect(summary.done).toBe(0);
  });
});

describe("summarising the pipeline", () => {
  it("counts only the stages that have actually got a row", () => {
    // A brand onboarded before the pipeline existed has no stage rows at all — Luisa
    // Beccaria has 1,013 products and no storefront row. Reporting "0 of 10 done" for a
    // house with a full catalogue and an indexed site is worse than reporting nothing.
    const summary = summarisePipeline({
      branding: { status: "done" },
      sources: { status: "running" },
    });
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.running?.key).toBe("sources");
    expect(summary.active).toBe(true);
  });

  it("is not active once everything has landed", () => {
    const summary = summarisePipeline({ branding: { status: "done" }, sources: { status: "done" } });
    expect(summary.active).toBe(false);
    expect(summary.failed).toEqual([]);
  });

  it("reports failures so the screen can lead with them", () => {
    const summary = summarisePipeline({ storefront: { status: "failed", error: "no feed" } });
    expect(summary.failed.map((f) => f.key)).toEqual(["storefront"]);
    expect(summary.active).toBe(false);
  });

  it("ignores stages the caller is not showing", () => {
    // Demo stages are hidden entirely where they cannot run, so counting them would make
    // the progress bar stall at 8/10 forever on a live brand.
    const stages = { branding: { status: "done" }, demo_data: { status: "skipped" } };
    const visible = PIPELINE_STAGES.filter((s) => !s.demo);
    expect(summarisePipeline(stages, visible).total).toBe(1);
  });
});

describe("which step the pipeline owns", () => {
  it("knows a step is building while its stage is queued or running", () => {
    expect(stepIsBuilding(1, { intro_deck: { status: "pending", queued: true } })).toBe(true);
    expect(stepIsBuilding(2, { data_request: { status: "running" } })).toBe(true);
    expect(stepIsBuilding(5, { ops_deck: { status: "done" } })).toBe(false);
    expect(stepIsBuilding(1, undefined)).toBe(false);
  });

  it("routes each collateral stage to the step that shows it", () => {
    expect(stagesForStep(1).map((s) => s.key)).toEqual(["intro_deck"]);
    expect(stagesForStep(2).map((s) => s.key)).toEqual(["data_request"]);
    expect(stagesForStep(5).map((s) => s.key)).toEqual(["ops_deck"]);
    // Step 4 is a perimeter only a human can declare, so no stage builds it.
    expect(stagesForStep(4)).toEqual([]);
  });
});

describe("step state labels", () => {
  it("reads an absent state as not started rather than blank", () => {
    expect(stepStateLabel(undefined)).toBe("Not started");
    expect(stepStateLabel(null)).toBe("Not started");
    expect(stepStateLabel("in_progress")).toBe("In progress");
  });
});
