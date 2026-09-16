#!/usr/bin/env node
/**
 * A one-to-two minute film of the assistant answering, recorded off the real product.
 *
 *   node scripts/demo-video.mjs --slug prada --email … --password … [--out film.mp4]
 *
 * WHY A RECORDING AND NOT A RENDER.
 *
 * The obvious way to build this is to ask the assistant the questions over the API, draw the
 * conversation as HTML and film that. It would be faster, prettier and completely worthless:
 * a prospect watching a demo video is deciding whether to believe the product exists. A
 * dramatisation of a chat window proves nothing, and the first person to notice the render
 * does not match the platform has been told something untrue. So this drives the actual
 * portal, with the actual demo login, and films what happens — including the wait while the
 * answer streams, which is then compressed rather than cut, because how long it takes is part
 * of what is being shown.
 *
 * WHY IT IS A SCRIPT AND NOT A BUTTON.
 *
 * It needs a browser and a video encoder. Edge functions have neither, and putting a headless
 * Chrome behind a button is a piece of infrastructure, not an afternoon. Run it from a laptop
 * or a CI runner; if it earns its place, that is the moment to host it.
 *
 * NO THIRD PARTY IS NEEDED and that is deliberate. A voiceover would need one (ElevenLabs or
 * similar over the finished cut) and can be added — but nothing here depends on an external
 * service to produce the film, so nothing here can be broken by one.
 *
 * Requires: playwright-core + Chrome, and ffmpeg on the PATH.
 */

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZE = { width: 1440, height: 900 };

/**
 * What the film shows.
 *
 * The founder's own four, in the order that tells a story: who matters, what to say to them,
 * a policy question no CRM can answer on its own, and a plan. Each one needs the client data
 * and the knowledge base in the same answer, which is the thing worth filming.
 */
const QUESTIONS = [
  "Chi sono i 10 top client dell'ultimo trimestre e cosa consiglieresti di comprare a ciascuno?",
  "Devo scrivere una newsletter: a chi scriveresti e perché proprio a loro?",
  "Mi daresti la policy di reso per un cliente che vive in Polonia e ha acquistato in Brasile?",
  "Mi creeresti la struttura per un trunk show a Londra — chi invitare, cosa portare, come gestirlo?",
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const slug = arg("slug");
const email = arg("email");
const password = arg("password");
const base = arg("base", "https://dev.app.aioncover.com");
const out = arg("out", `AION-${slug}-assistant.mp4`);
// How many questions to ask. Four answers is about two minutes once compressed.
const count = Number(arg("questions", QUESTIONS.length));

if (!slug || !email || !password) {
  console.error("usage: demo-video.mjs --slug <brand> --email <demo login> --password <…> [--base url] [--out file.mp4]");
  process.exit(2);
}
if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME}`); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), "aion-demo-"));
console.log(`recording ${slug} → ${out}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: SIZE,
  // Playwright writes one webm per page, closed when the context closes.
  recordVideo: { dir: work, size: SIZE },
  deviceScaleFactor: 2,
  locale: "it-IT",
});
const page = await context.newPage();

/** The SPA mounts after domcontentloaded, so every wait is for a thing, never for a timeout. */
const gotoAndSettle = async (url, selector) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(selector, { timeout: 45_000 });
};

try {
  // ── Log in as the prospect would ─────────────────────────────────────────
  await gotoAndSettle(`${base}/${slug}/login`, 'input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  // BY ITS NAME, not by button[type="submit"]. The login page has three submit buttons and
  // the first of them is invisible, so a type selector clicks something that can never be
  // clicked and Playwright retries until it times out. Both languages, because the portal's
  // toggle is independent of the browser locale.
  const logIn = page.getByRole("button", { name: /log\s?in|accedi/i }).first();
  await logIn.waitFor({ state: "visible", timeout: 30_000 });
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 60_000 }),
    logIn.click(),
  ]);

  // ── The assistant ────────────────────────────────────────────────────────
  await gotoAndSettle(`${base}/${slug}/assistant`, "textarea");
  await page.waitForTimeout(1500);

  const composer = page.locator("textarea").first();

  for (const question of QUESTIONS.slice(0, count)) {
    await composer.click();
    // Typed, not pasted. The film is about a person using this.
    await composer.type(question, { delay: 18 });
    await page.waitForTimeout(400);
    // The transcript as it stands with the question in it and no answer yet. Everything the
    // wait below does is measured against this.
    const baseline = await transcriptLength(page);
    await composer.press("Enter");

    // Wait for the answer to finish rather than for a fixed time: these vary from eight
    // seconds to the better part of a minute, and a fixed wait either cuts an answer in half
    // or films a still frame.
    await settled(page, baseline);
    await page.waitForTimeout(1200);
  }

  await page.waitForTimeout(1500);
} catch (e) {
  console.error("recording failed:", e instanceof Error ? e.message : e);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

// The video is only written out when the context closes.
await context.close();
await browser.close();

const webm = readdirSync(work).filter((f) => f.endsWith(".webm")).map((f) => join(work, f))[0];
if (!webm) { console.error("no video was recorded"); process.exit(1); }

// ── Cut ────────────────────────────────────────────────────────────────────
// Sped up, not trimmed. Cutting the waits out would be the same lie as rendering the thing:
// what it takes to answer is part of what is being shown. 2× keeps it honest and watchable,
// and the frame rate is raised to match so the result does not stutter.
console.log("encoding…");
execFileSync("ffmpeg", [
  "-y", "-i", webm,
  "-filter:v", "setpts=0.5*PTS,fps=30,scale=1440:-2:flags=lanczos",
  "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  out,
], { stdio: ["ignore", "ignore", "inherit"] });

rmSync(work, { recursive: true, force: true });

const seconds = Number(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out,
]).toString().trim());
console.log(`${out} — ${Math.round(seconds)}s`);

/**
 * Wait until the assistant has finished answering.
 *
 * Two conditions, and the first is the one the first version was missing. "The page has not
 * changed for a couple of seconds" is true BEFORE the answer starts as well as after it ends:
 * the first attempt filmed the login, the question, the word "Thinking…", and stopped — nine
 * seconds of a demo video in which nothing is demonstrated.
 *
 * So: wait for the transcript to grow past where it was when the question was sent, and only
 * then start counting quiet. A spinner would not do instead — the answer streams, so the page
 * is "loading" for almost all of it.
 */
async function settled(page, baseline, { quietMs = 2500, capMs = 180_000, minGrowth = 120 } = {}) {
  const started = Date.now();
  let last = baseline;
  let lastChange = Date.now();
  let answering = false;

  while (Date.now() - started < capMs) {
    const length = await transcriptLength(page).catch(() => last);
    if (length !== last) {
      // "Thinking…" is a change too, and a short one. The threshold is what tells an answer
      // apart from a status word.
      if (length > baseline + minGrowth) answering = true;
      last = length;
      lastChange = Date.now();
    } else if (answering && Date.now() - lastChange > quietMs) {
      return;
    }
    await page.waitForTimeout(500);
  }
  console.warn(answering
    ? "  (an answer was still being written at the cap — filmed what there was)"
    : "  (no answer arrived inside the cap — the assistant may be failing)");
}

/**
 * How much text is on the page.
 *
 * A function declaration, not a const arrow: this file uses it in the recording loop above
 * and defines it down here with the other helpers, and `const` is not hoisted — the first run
 * died with "Cannot access 'transcriptLength' before initialization" after driving the whole
 * session, which is an expensive way to find a temporal dead zone.
 */
function transcriptLength(page) {
  return page.evaluate(() => document.body.innerText.length);
}
