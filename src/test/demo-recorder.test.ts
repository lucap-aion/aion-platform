import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The demo film is recorded by driving the real portal, which means the recorder holds an
// opinion about the portal's DOM — and the portal does not know it. That gap has already cost
// a film: the recorder waited for the composer to be re-enabled between questions, because
// `disabled={loading || …}` made that a perfect signal for "the assistant has finished". Then
// the composer was deliberately left alive while the assistant thinks, so a person could
// write their next question during an answer. Nothing threw. The wait returned instantly,
// questions two and three were typed over a streaming answer, `send()` refused them without
// clearing the draft, and a three-question film went out with one answer in it and the other
// two sitting unsent in the text box.
//
// So the signal is now stated on the element — `data-assistant-state` — and this is the test
// that keeps the two ends of it together. It reads source rather than rendering, because what
// broke was not behaviour in a component, it was an agreement between two files that nothing
// held.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const composer = read("src/pages/brand/BrandAssistant.tsx");
const recorder = read("scripts/demo-video.mjs");

describe("the demo recorder and the assistant it films", () => {
  it("states the assistant's state on the composer, both ways round", () => {
    expect(composer).toContain(`data-assistant-state={loading ? "thinking" : "idle"}`);
  });

  it("is what the recorder waits on", () => {
    expect(recorder).toContain(`const COMPOSER = "textarea[data-assistant-state]";`);
    expect(recorder).toContain(`dataset.assistantState === "idle"`);
    expect(recorder).toContain(`dataset.assistantState === "thinking"`);
  });

  it("never goes back to reading `disabled` as \"the answer has finished\"", () => {
    // `disabled` on that textarea means the microphone is recording, and has meant that
    // since voice notes shipped. A recorder that reads it is a recorder that films one
    // answer.
    expect(recorder).not.toMatch(/t\.disabled\s*(\)|&&\s*!t\.readOnly\s*\))\s*;?\s*$/m);
    expect(recorder).not.toContain("Boolean(t) && t.disabled");
  });

  it("checks that each question was actually taken before waiting for its answer", () => {
    // An empty composer is the product's own confirmation: `send()` clears the box when it
    // accepts a question and leaves it alone when it refuses one.
    expect(recorder).toContain("async function sent(page");
    expect(recorder).toMatch(/if \(!\(await sent\(page\)\)\) \{/);
  });
});
