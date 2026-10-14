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

// The second film went back with two notes: it scrolled unnaturally — worst when a product
// grid or a table arrived — and the product photos were not there. Both were real, and
// neither was the recorder's fault alone, so both ends are held here as well.
describe("how the film reads an answer", () => {
  it("finds the conversation and its turns by attributes the page states", () => {
    // The recorder pans the conversation itself and starts each pan from the question.
    // If these move, it pans nothing and nobody is told — the same silent rot as above.
    expect(recorder).toContain(`const SCROLLER = "[data-assistant-scroll]";`);
    expect(recorder).toContain(`const QUESTION = '[data-chat-turn="user"]';`);
    expect(recorder).toContain(`const ANSWER = '[data-chat-turn="assistant"]';`);
    expect(composer).toContain("data-assistant-scroll");
    expect(composer).toContain(`data-chat-turn="user"`);
    expect(composer).toContain(`data-chat-turn="assistant"`);
  });

  it("reads every answer through after it finishes, not just waits on it", () => {
    expect(recorder).toContain("async function presentAnswer(page, index)");
    expect(recorder).toMatch(/await settled\(page\);\s*\n(\s*\/\/.*\n)*\s*photos\.push\(await presentAnswer\(page, i\)\);/);
  });

  it("paces the reading on film, so --speed compresses the waiting and not the reading", () => {
    expect(recorder).toContain("const film = (ms) => ms * speed;");
  });

  it("waits for the photos to draw before panning, and says when they did not", () => {
    expect(recorder).toContain(`img.loading = "eager"`);
    expect(recorder).toContain("i.naturalWidth > 0");
    expect(recorder).toContain("WARNING: product photos missing from the film");
  });

  it("does not announce itself as headless to the house's CDN", () => {
    // Prada's Akamai never answers an image request from "HeadlessChrome": the grid filmed
    // as grey squares. Reproduced, and fixed by the one word.
    expect(recorder).toMatch(/replace\(\/HeadlessChrome\/g, "Chrome"\)/);
    expect(recorder).toMatch(/newContext\(\{[\s\S]*?userAgent,[\s\S]*?recordVideo/);
  });

  it("the page no longer chases the bottom on every streamed word", () => {
    // The old one-liner: a smooth scroll to the very bottom on every change, which flew
    // past the answer the moment the photo grid mounted, and dragged a reader who had
    // scrolled up back down.
    expect(composer).not.toContain(`scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })`);
    expect(composer).toContain("if (!el || !followRef.current) return;");
    expect(composer).toContain("if (distance <= 1) return;");
    expect(composer).toContain("onWheel={letGo}");
  });
});
