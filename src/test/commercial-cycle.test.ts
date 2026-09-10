import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CYCLE_STEPS, PIPELINE_STAGES, pipelineStageKeys, DEMO_STAGE_KEYS,
  stageDisplayState, stepIsBuilding, summarisePipeline, stagesForStep, stepStateLabel,
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
