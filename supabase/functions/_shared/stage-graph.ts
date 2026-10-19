// ==============================|| WHAT A FAILURE ACTUALLY STOPS ||============================== //
// When an onboarding stage fails, which of the others can no longer run?
//
// The answer used to be "all of them". Everything still queued behind a failure had its
// queue slot cleared, whatever it was and whether or not it needed the stage that failed.
//
// That is right for a handful of pairs and wrong for everything else, and the case it gets
// wrong is the common one. `intro_deck` fails whenever a site has no detectable product
// feed — the deck is built from the brand's own pieces — and it was taking the client
// documents, the assistant check, the ops deck and the DATA REQUEST down with it. None of
// those need a catalogue. The data request is step 2 of the commercial cycle and is built
// from a template and three fields on the brand record.
//
// Ferragamo sat in exactly that state: `intro_deck` failed, and five unrelated stages were
// left pending-and-unqueued forever while the brand read as finished.

export const PIPELINE_ORDER = [
  "branding", "sources", "storefront",
  "intro_deck",
  "demo_data", "demo_users", "documents", "assistant",
  "ops_deck", "data_request",
] as const;

export type StageName = (typeof PIPELINE_ORDER)[number];

/**
 * Stage -> the stages that genuinely cannot proceed without it.
 *
 * Deliberately sparse. A pair belongs here only when the second stage reads something the
 * first one produces; "runs later" is not a dependency. Anything absent keeps its place in
 * the queue when something else fails.
 */
export const BLOCKS: Partial<Record<StageName, StageName[]>> = {
  // Nothing can be written about, or answered from, a site that was never crawled.
  sources: ["documents", "assistant"],
  // The teaser deck and the demo book are both built out of the catalogue.
  storefront: ["intro_deck", "demo_data"],
  // Logins with no book of business behind them have nothing to show.
  demo_data: ["demo_users"],
};

/** Everything downstream of a failure, following the chain. */
export function blockedBy(stage: StageName): StageName[] {
  const out = new Set<StageName>();
  const walk = (s: StageName) => {
    for (const next of BLOCKS[s] ?? []) {
      if (out.has(next)) continue;
      out.add(next);
      walk(next);
    }
  };
  walk(stage);
  return [...out];
}

/** A skipped row, as much of it as the revive decision needs. */
export type SkippedRow = { stage: string; detail?: Record<string, unknown> | null };

/**
 * Of the stages that could not run without `after`, which skipped ones may go back in the
 * queue now that it has landed.
 *
 * Two different things wear the same "skipped" badge. One is "it could not run yet": no
 * catalogue, nothing indexed, the thing it reads was not there. That one is waiting, and
 * when the input arrives it should run. The other is "it must not run for this house" —
 * the demo stages on a brand that is a client rather than a prospect — and it is not
 * waiting for anything. Reviving that kind would invent a book of customers and covers on
 * a real client's account the first time its catalogue synced, which is why policy skips
 * are marked and excluded here rather than sorted out by reading their reason text.
 */
export function revivableStages(after: StageName, rows: SkippedRow[]): string[] {
  const downstream = new Set<string>(blockedBy(after));
  return rows
    .filter((r) => downstream.has(r.stage))
    .filter((r) => (r.detail ?? {}).policy !== true)
    .map((r) => r.stage);
}
