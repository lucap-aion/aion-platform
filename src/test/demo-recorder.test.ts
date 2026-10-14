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

// "Platform Demo — Full Portal shall focus on the whole platform (AI assistant is not core
// at all)." The film used to be the assistant whatever the demo was, so a brand being shown
// the insurance programme was sent two minutes of the one screen that was not being sold.
// The recorder now films the demo the brand is set up for, and these hold the three things
// that make that true: how it decides, what the tour visits, and that every screen it
// visits is one the portal actually has — routes and sidebar both, since it moves by the
// sidebar and a renamed path would otherwise drop a scene with nothing but a log line.
const app = read("src/App.tsx");
const sidebar = read("src/components/layout/AppSidebar.tsx");
const sidebarUi = read("src/components/ui/sidebar.tsx");
const panel = read("src/pages/admin/_components/DemoPanel.tsx");

/** The `path: "…"` entries of one of the recorder's tour arrays, in order. */
function tour(name: string): string[] {
  const start = recorder.indexOf(`const ${name} = [`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const body = recorder.slice(start, recorder.indexOf("\n];", start));
  return [...body.matchAll(/^\s*\{?\s*path: "([^"]+)"/gm)].map((m) => m[1]);
}
function block(name: string): string {
  const start = recorder.indexOf(`const ${name} = [`);
  return recorder.slice(start, recorder.indexOf("\n];", start));
}

describe("which film the recorder makes", () => {
  it("films the platform for a full-portal demo and the assistant only for an assistant-only one", () => {
    expect(recorder).toMatch(/if \(mode === "assistant"\) \{\s*await filmAssistant\(page, \{ count \}\);\s*\} else \{\s*await tourPortal\(page\);\s*\}/);
  });

  it("is told the mode, or asks build-collateral, or reads it off the portal — in that order", () => {
    expect(recorder).toContain(`let mode = normaliseMode(arg("mode", process.env.AION_DEMO_MODE ?? ""));`);
    expect(recorder).toContain(`if (!mode && typeof login.assistant_only === "boolean") mode = login.assistant_only ? "assistant" : "portal";`);
    expect(recorder).toContain("if (!mode) mode = await modeFromPortal(page);");
  });

  it("reads the mode off the same sidebar rule that hides the programme", () => {
    // An assistant-only sidebar keeps exactly these two, so "no Covers link" means
    // assistant-only. If that rule changes, this is where the recorder learns of it.
    expect(sidebar).toContain(`const assistantOnlyPaths = new Set(["/assistant", "/knowledge"]);`);
    expect(recorder).toMatch(/async function modeFromPortal[\s\S]*?SIDEBAR_LINK\("\/covers"\)[\s\S]*?"portal" : "assistant"/);
    expect(sidebarUi).toContain(`data-sidebar="sidebar"`);
    expect(recorder).toContain(`const SIDEBAR_LINK = (path) => \`[data-sidebar="sidebar"] a[href="/\${slug}\${path}"]\`;`);
  });

  it("keeps the assistant out of the tour unless a cameo is asked for", () => {
    expect(tour("BRAND_TOUR")).not.toContain("/assistant");
    expect(tour("CLIENT_TOUR")).not.toContain("/assistant");
    expect(recorder).toContain(`const cameo = process.argv.includes("--cameo");`);
    expect(recorder).toMatch(/if \(cameo\) \{[\s\S]*?filmAssistant\(page, \{ count: 1, arrive: "sidebar" \}\)/);
  });
});

describe("the platform tour", () => {
  it("visits the brand side in a day's order: home, clients, covers, claims, boutiques, insights", () => {
    expect(tour("BRAND_TOUR")).toEqual(["/dashboard", "/customers", "/covers", "/claims", "/shops", "/insights"]);
  });

  it("then the client side: home, their covers, one cover, and the claim form it ends on", () => {
    expect(tour("CLIENT_TOUR")).toEqual(["/home", "/covers", "/covers"]);
    expect(block("CLIENT_TOUR")).toContain(`main a[href*="/claims/new"]`);
    // The form, not a claim: submitting would write into the demo the prospect is handed.
    expect(block("CLIENT_TOUR")).not.toMatch(/submit/i);
    expect(recorder).toMatch(/if \(!clientEmail \|\| !clientPassword\) \{[\s\S]*?brand side only/);
  });

  it("only goes where the portal goes — every scene is a sidebar entry and a route", () => {
    for (const path of new Set(tour("BRAND_TOUR"))) {
      expect(sidebar, `brand sidebar has ${path}`).toMatch(new RegExp(`const brandPaths = \\[[\\s\\S]*?path: "${path}"[\\s\\S]*?\\];`));
      expect(app, `route for ${path}`).toContain(`path="/:slug${path}"`);
    }
    for (const path of new Set(tour("CLIENT_TOUR"))) {
      expect(sidebar, `client sidebar has ${path}`).toMatch(new RegExp(`const customerPaths = \\[[\\s\\S]*?path: "${path}"[\\s\\S]*?\\];`));
      expect(app, `route for ${path}`).toContain(`path="/:slug${path}"`);
    }
  });

  it("opens one client, one cover and one claim, through routes that exist", () => {
    const brand = block("BRAND_TOUR");
    expect(brand).toContain(String.raw`url: /\/customers\/[^/]+$/`);
    expect(brand).toContain(String.raw`url: /\/covers\/[^/]+$/`);
    expect(brand).toContain(String.raw`url: /\/claims\/[^/]+$/`);
    expect(app).toContain(`path="/:slug/customers/:customerId"`);
    expect(app).toContain(`path="/:slug/covers/:coverId"`);
    expect(app).toContain(`path="/:slug/claims/:claimId"`);
    expect(app).toContain(`path="/:slug/covers/:coverId/view"`);
    expect(app).toContain(`path="/:slug/claims/new"`);
  });

  it("clicks the rows the pages actually render", () => {
    expect(read("src/pages/brand/BrandCustomers.tsx")).toMatch(/<tr[^>]*className="[^"]*cursor-pointer"[^>]*\n?\s*onClick=\{\(\) => navigate\(`\$\{slugPrefix\}\/customers\//);
    expect(read("src/pages/brand/BrandClaims.tsx")).toMatch(/className="[^"]*cursor-pointer"\s*\n\s*onClick=\{\(\) => navigate\(`\$\{slugPrefix\}\/claims\/\$\{claim\.id\}`\)\}/);
    expect(read("src/pages/brand/BrandCovers.tsx")).toMatch(/className="glass-card [^"]*cursor-pointer"\s*\n\s*onClick=\{\(\) => navigate\(`\$\{slugPrefix\}\/covers\/\$\{cover\.id\}`\)\}/);
    expect(read("src/pages/customer/CustomerCovers.tsx")).toContain("claims/new?cover=${cover.id}");
  });

  it("never films a half-loaded screen: a still covers every move until the next screen is ready", () => {
    // The portal's skeletons and spinners are these two classes; screenReady waits them out.
    expect(read("src/components/ui/skeleton.tsx")).toContain("animate-pulse");
    expect(recorder).toContain(`document.querySelectorAll(".animate-pulse, .animate-spin")`);
    // And the curtain is down for the whole of each move, lifted only after the wait.
    for (const fn of ["viaSidebar", "openOne", "logIn"]) {
      const start = recorder.indexOf(`async function ${fn}(`);
      const body = recorder.slice(start, recorder.indexOf("\n}\n", start));
      expect(body, fn).toMatch(/await curtainDown\(page\);[\s\S]*?\.click\([\s\S]*?await screenReady\(page, [^)]+\);\s*\n\s*await curtainUp\(page\);/);
    }
    // It must let the click through to the row beneath it, and lift on the new screen's top.
    expect(recorder).toContain("pointer-events:none");
    expect(recorder).toMatch(/async function curtainUp[\s\S]*?main\.scrollTop = 0/);
  });

  it("paces the screens on film, like the answers", () => {
    expect(recorder).toMatch(/async function look\(page[\s\S]*?film\(hold\)[\s\S]*?perPx: film\(9\)/);
  });
});

describe("what step 3 says the demo is", () => {
  it("says Full portal is the whole platform, and the assistant is not the point of it", () => {
    expect(panel).toContain("the assistant is one screen among them");
    expect(panel).toContain("The assistant is there, but it is not the demo.");
  });

  it("describes the film the toggle will actually produce", () => {
    expect(panel).toMatch(/assistantOnly\s*\n?\s*\? "Two minutes of this brand's own assistant/);
    expect(panel).toContain("A two-minute tour of the platform");
  });
});
