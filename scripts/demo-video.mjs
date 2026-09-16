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
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Playwright's own Chromium when it is installed (`npx playwright install chromium`), which
// is what a CI runner has; a local Chrome otherwise, which is what a laptop has. Nothing here
// is tied to a particular machine — the point is that this runs unattended.
const LOCAL_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];
const SIZE = { width: 1440, height: 900 };

/**
 * What the film asks.
 *
 * Read off the assistant's own opening screen, which is already per-brand: those prompts are
 * built from a real product, a real client and the house's name, so Ferragamo's film asks
 * about a Ferragamo piece and Prada's about a Prada one. Filming a question the product
 * itself offers is also the honest version — it is a path a user has, not one invented for
 * the camera.
 *
 * `--ask "one|two"` overrides, for a film that has to make a particular point.
 */
const FALLBACK_QUESTIONS = [
  "Chi sono i 10 top client dell'ultimo trimestre e cosa consiglieresti di comprare a ciascuno?",
  "Devo scrivere una newsletter: a chi scriveresti e perché proprio a loro?",
  "Mi daresti la policy di reso per un cliente che vive in Polonia e ha acquistato in Brasile?",
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const slug = arg("slug");
// The login can be given, or fetched. Fetching is what lets this run unattended: the demo
// accounts are created by onboarding and live in the stage row, and build-collateral hands
// them back to an admin or a batch caller — the same audience that already reads them off
// the screen to give to a prospect.
const brandId = arg("brand-id");
const functionsBase = arg("functions-base", process.env.AION_FUNCTIONS_BASE ?? "");
const batchSecret = arg("batch-secret", process.env.AION_BATCH_SECRET ?? "");
const anonKey = arg("anon-key", process.env.AION_ANON_KEY ?? "");
let email = arg("email");
let password = arg("password");
const base = arg("base", "https://dev.app.aioncover.com");
const out = arg("out", `AION-${slug}-assistant.mp4`);
// Three answers is a shade over ninety seconds at this speed. Four ran to two minutes, which
// is longer than a demo video earns.
const count = Number(arg("questions", 3));
const asked = (arg("ask", "") || "").split("|").map((q) => q.trim()).filter(Boolean);
// 1.5×, not 2×. Fast enough not to be a wait, slow enough to read an answer as it arrives —
// at 2× the streaming text was a blur, which defeats the point of filming it.
const speed = Number(arg("speed", 1.5));

/** build-collateral, as a batch caller. */
async function callCollateral(payload) {
  const res = await fetch(`${functionsBase}/build-collateral`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { Authorization: `Bearer ${anonKey}` } : {}),
      ...(batchSecret ? { "x-batch-secret": batchSecret } : {}),
    },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error || out.ok === false) {
    throw new Error(out.error ?? out.reason ?? `HTTP ${res.status}`);
  }
  return out;
}

const canCallBack = Boolean(functionsBase && batchSecret && brandId);

if ((!email || !password) && canCallBack) {
  const login = await callCollateral({ brand_id: Number(brandId), kind: "demo_login" });
  email = login.email;
  password = login.password;
  console.log(`using the demo login for ${login.brand}`);
}

if (!slug || !email || !password) {
  console.error(
    "usage: demo-video.mjs --slug <brand> (--email … --password … | --brand-id N with\n" +
    "       --functions-base/--batch-secret, or AION_FUNCTIONS_BASE/AION_BATCH_SECRET)\n" +
    "       [--base url] [--ask \"q1|q2\"] [--questions 3] [--speed 1.5] [--out file.mp4] [--upload]",
  );
  process.exit(2);
}
const chromePath = LOCAL_CHROME.find((p) => existsSync(p));

const work = mkdtempSync(join(tmpdir(), "aion-demo-"));
console.log(`recording ${slug} → ${out}`);

// No executablePath means Playwright's own download, which is the CI case.
const browser = await chromium.launch(chromePath ? { executablePath: chromePath, headless: true } : { headless: true })
  .catch((e) => {
    console.error(
      "could not start a browser. Install one with `npx playwright install chromium`, " +
      `or put Chrome somewhere this looks (${LOCAL_CHROME[0]}).\n${e.message}`,
    );
    process.exit(2);
  });
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

  // The brand's own opening prompts, before anything is typed — they disappear with the first
  // answer. Anything long enough to be a question; the screen also carries short UI labels.
  const onScreen = asked.length ? [] : await page
    .locator("main button, [role='main'] button")
    .allInnerTexts()
    .then((all) => all.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 40))
    .catch(() => []);

  // Spread across the list, not the first three off the top. The opening prompts are grouped
  // by kind — the product ones first, then the client and planning ones — so taking the top
  // three films two variations on the same handbag. Evenly spaced gives the range the
  // assistant actually has, which is the thing being demonstrated.
  const pool = asked.length ? asked : onScreen.length ? onScreen : FALLBACK_QUESTIONS;
  const questions = asked.length ? pool.slice(0, count) : spread(pool, count);
  console.log(`asking ${questions.length}: ${questions.map((q) => q.slice(0, 48) + "…").join(" / ")}`);

  for (const question of questions) {
    // The composer is disabled while an answer is generating, so waiting for it to come back
    // IS waiting for the assistant to finish. Before typing as well as after, because the
    // first question can arrive while the page is still settling.
    await waitComposerReady(page);
    await composer.click();
    // Typed, not pasted. The film is about a person using this.
    await composer.type(question, { delay: 18 });
    await page.waitForTimeout(400);
    await composer.press("Enter");

    // Wait for the answer to finish rather than for a fixed time: these vary from eight
    // seconds to the better part of a minute, and a fixed wait either cuts an answer in half
    // or films a still frame.
    await settled(page);
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
// what it takes to answer is part of what is being shown. The frame rate is raised to match
// so the result does not stutter.
console.log("encoding…");
execFileSync("ffmpeg", [
  "-y", "-i", webm,
  "-filter:v", `setpts=${(1 / speed).toFixed(4)}*PTS,fps=30,scale=1440:-2:flags=lanczos`,
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

// Put it where the rest of the commercial pack lives, so it appears in the cycle's artefact
// list with a working link rather than on whichever machine happened to make it.
if (process.argv.includes("--upload")) {
  if (!canCallBack) {
    console.error("--upload needs --brand-id and the functions base + batch secret");
    process.exit(2);
  }
  const stored = await callCollateral({
    brand_id: Number(brandId),
    kind: "upload_demo_video",
    seconds: Math.round(seconds),
    file_base64: readFileSync(out).toString("base64"),
  });
  console.log(`uploaded → ${stored.storage_path}`);
}

/**
 * Wait until the assistant has finished answering.
 *
 * By asking the product, not by guessing. The composer carries `disabled={loading || …}`, so
 * it is disabled for exactly as long as an answer is being generated and enabled again the
 * moment it is not. That is the authoritative signal and it costs nothing to read.
 *
 * Two earlier versions of this were wrong in opposite directions. Watching the page for a
 * fixed quiet period returned BEFORE the answer began — nine seconds of login, question and
 * the word "Thinking…". Watching for the transcript to stop growing returned in the middle of
 * one, because an answer that stops to query the CRM is quiet for several seconds and then
 * carries on; the next question then hit a disabled composer and the run died with a click
 * timeout after filming two thirds of a film.
 */
async function waitComposerReady(page, timeoutMs = 180_000) {
  // The `null` is not decoration. waitForFunction's signature is (fn, arg, options), so
  // passing the options object second makes it the function's ARGUMENT and leaves the
  // timeout at Playwright's 30-second default. That is how a 180-second cap silently became
  // 30, and two of three answers were reported as "did not finish inside the cap".
  await page.waitForFunction(() => {
    const t = document.querySelector("textarea");
    return Boolean(t) && !t.disabled && !t.readOnly;
  }, null, { timeout: timeoutMs });
}

async function settled(page, { capMs = 180_000, settleMs = 900 } = {}) {
  // It can take a moment for `loading` to go true after Enter; if it never does, the enabled
  // wait below returns immediately and the pause covers a short answer.
  await page.waitForFunction(() => {
    const t = document.querySelector("textarea");
    return Boolean(t) && t.disabled;
  }, null, { timeout: 15_000 }).catch(() => {});

  try {
    await waitComposerReady(page, capMs);
  } catch {
    console.warn("  (an answer did not finish inside the cap — filmed what there was)");
  }
  // Let the last of the answer paint before the next question starts typing over it.
  await page.waitForTimeout(settleMs);
}

/** `count` items spread evenly across a list, in order, without repeats. */
function spread(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  const picked = [];
  for (let i = 0; i < count; i++) {
    const item = items[Math.min(items.length - 1, Math.floor(i * step))];
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}


