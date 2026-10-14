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
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

/** The composer, which carries the assistant's state on itself. */
const COMPOSER = "textarea[data-assistant-state]";
/** The conversation's own scroller, and the turns inside it. */
const SCROLLER = "[data-assistant-scroll]";
const QUESTION = '[data-chat-turn="user"]';
const ANSWER = '[data-chat-turn="assistant"]';

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
// Three answers was a shade over ninety seconds at this speed; reading each one through at
// a person's pace (presentAnswer) adds ten seconds or so apiece, which puts three at about
// two minutes. Four would be longer than a demo video earns.
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
// THE PHOTOS. A headless Chrome says so in its user agent — "HeadlessChrome/155" — and
// Prada's CDN (Akamai) does not refuse that request, it never answers it: the connection
// hangs, the <img> eventually errors, the card hides it, and the film showed a grid of
// empty grey squares under every product answer. Reproduced: the same two Prada photos
// load at 2400px with the user agent below and at 0px with the headless one; Ferragamo's
// and Roberto Coin's CDNs serve both. The Sec-CH-UA client hints already name plain
// "Google Chrome", so the user agent string is the only tell to take away. It is the
// browser's own, with one word removed — not a disguise as some other browser.
const userAgent = await (async () => {
  const probe = await browser.newPage();
  const ua = await probe.evaluate(() => navigator.userAgent);
  await probe.close();
  return ua.replace(/HeadlessChrome/g, "Chrome");
})();
const context = await browser.newContext({
  viewport: SIZE,
  userAgent,
  // Playwright writes one webm per page, closed when the context closes.
  recordVideo: { dir: work, size: SIZE },
  deviceScaleFactor: 2,
  locale: "it-IT",
});
const page = await context.newPage();
/** Per answer: how many product photos it had and how many actually drew. */
const photos = [];

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
  await gotoAndSettle(`${base}/${slug}/assistant`, COMPOSER);
  await page.waitForTimeout(1500);

  const composer = page.locator(COMPOSER).first();

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

  for (const [i, question] of questions.entries()) {
    // Never type over an answer that is still arriving. Before typing as well as after,
    // because the first question can arrive while the page is still settling.
    await waitComposerReady(page);
    await composer.click();
    // Anything left in the box from a refused send would be prefixed to this question, and
    // two questions run together is not a question. Nothing normally is; this is the belt.
    await composer.fill("");
    // Typed, not pasted. The film is about a person using this.
    await composer.type(question, { delay: 18 });
    await page.waitForTimeout(400);
    await composer.press("Enter");

    // Enter is not a send. `send()` returns without doing anything while an answer is still
    // generating, and it does NOT clear the draft — so an empty composer is the product's own
    // confirmation that the question was accepted, and a composer that still holds the
    // question is a question that was thrown away. This is the exact failure that shipped a
    // three-question film with one answer in it, so it is checked rather than assumed.
    if (!(await sent(page))) {
      throw new Error(
        `question ${i + 1} of ${questions.length} was typed but not accepted — the assistant ` +
        `was still answering the one before it. The film would have shown one answer.`,
      );
    }

    // Wait for the answer to finish rather than for a fixed time: these vary from eight
    // seconds to the better part of a minute, and a fixed wait either cuts an answer in half
    // or films a still frame.
    await settled(page);
    // Then read it, which is what a person does with an answer and what the film is for.
    photos.push(await presentAnswer(page, i));
  }
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
// The recording is the expensive part — two minutes of driving a live assistant — and ffmpeg
// will not create a missing directory, so a `--out` pointing somewhere that has since been
// tidied away throws it all away at the last step. It happened.
mkdirSync(dirname(out) || ".", { recursive: true });

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

// Said at the end as well as as it happened, because the end is the part of a CI log that
// gets read. A film whose photos did not draw is the film Giulio sent back.
const missing = photos.filter((p) => p.total > p.loaded);
if (missing.length) {
  console.warn(
    `WARNING: product photos missing from the film — ${missing
      .map((p) => `answer ${p.answer}: ${p.loaded}/${p.total} (${p.hosts.join(", ") || "?"})`)
      .join("; ")}. Watch it before sending it.`,
  );
}

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
 * By asking the product, not by guessing — but by asking it something it has SAID it will
 * answer. This used to read `textarea.disabled`, on the reasoning that the composer is dead
 * while an answer generates. That was true when it was written and stopped being true the
 * day the composer was deliberately left alive so a user could write the next question while
 * the assistant thinks. Nothing failed: the wait returned instantly, every question after the
 * first was typed over a streaming answer, `send()` refused it, and the film went out with
 * one answer in it. So the page now states `data-assistant-state` outright, and this reads
 * that. A signal that exists for this is a signal that gets changed WITH this.
 *
 * Two earlier versions were wrong in opposite directions. Watching the page for a fixed quiet
 * period returned BEFORE the answer began — nine seconds of login, question and the word
 * "Thinking…". Watching for the transcript to stop growing returned in the middle of one,
 * because an answer that stops to query the CRM is quiet for several seconds and then carries
 * on.
 */
async function waitComposerReady(page, timeoutMs = 180_000) {
  // The `null` is not decoration. waitForFunction's signature is (fn, arg, options), so
  // passing the options object second makes it the function's ARGUMENT and leaves the
  // timeout at Playwright's 30-second default. That is how a 180-second cap silently became
  // 30, and two of three answers were reported as "did not finish inside the cap".
  await page.waitForFunction((sel) => {
    const t = document.querySelector(sel);
    // An older build with no state attribute would never match the selector, so this waits
    // and then times out loudly, rather than racing ahead and filming one answer.
    return Boolean(t) && t.dataset.assistantState === "idle" && !t.disabled && !t.readOnly;
  }, COMPOSER, { timeout: timeoutMs });
}

/** Did the product take the question? An accepted question leaves the box empty. */
async function sent(page, timeoutMs = 8000) {
  return await page.waitForFunction((sel) => {
    const t = document.querySelector(sel);
    return Boolean(t) && t.value.trim() === "";
  }, COMPOSER, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function settled(page, { capMs = 180_000, settleMs = 900 } = {}) {
  // It can take a moment for the state to go to "thinking" after Enter; if it never does, the
  // idle wait below returns immediately and the pause covers a short answer.
  await page.waitForFunction((sel) => {
    const t = document.querySelector(sel);
    return Boolean(t) && t.dataset.assistantState === "thinking";
  }, COMPOSER, { timeout: 15_000 }).catch(() => {});

  try {
    await waitComposerReady(page, capMs);
  } catch {
    console.warn("  (an answer did not finish inside the cap — filmed what there was)");
  }
  // Let the last of the answer paint before the next question starts typing over it.
  await page.waitForTimeout(settleMs);
}

/**
 * Show the finished answer the way a person reads one: from its question, down, at a pace.
 *
 * WHY THE RECORDER SCROLLS AND NOT THE PAGE. While an answer streams the page follows it
 * down until the question reaches the top, then lets the rest arrive below the fold — the
 * right thing for a person, who scrolls on when they are ready. The film has no hand on the
 * wheel, so without this it showed the top of every answer and never its photos, or (before
 * the page stopped doing it) a lurch to the bottom as the product grid mounted, which 1.5×
 * made worse. So once the product says the answer is done, the recorder takes the scroll:
 * back to the question if the view has left it, a beat to read the opening, a steady eased
 * pan down through the rest, and a hold on the end.
 *
 * WHY THE PHOTOS ARE WAITED FOR FIRST. They are hotlinked from the house's CDN, a few
 * hundred kilobytes each (Prada's are 2400px), and lazy: an image below the fold of a
 * scrolling div is not even requested until it is scrolled to. Panning straight away filmed
 * cards filling in one by one as they went past, or not at all. So they are switched to
 * eager, given up to twenty seconds, and counted — a photo that never drew is reported, not
 * filmed quietly as a grey square.
 *
 * WHY THE PACE IS SET HERE AND NOT IN FFMPEG. "Show the answer more slowly" could mean
 * cutting the film into pieces and playing these at 1× and the rest at 1.5×. It need not:
 * during the pan nothing on the page moves but the scroll, so a pan recorded 1.5× slower
 * and played at 1.5× is the same frames as a pan played at 1×. Every duration below is the
 * one the VIEWER sees, multiplied by `speed` for the recording, so the reading pace holds
 * whatever --speed the film is cut at — and the waiting for an answer is still the only
 * thing compressed. Splicing by timestamp would instead depend on lining up the page's clock
 * with the recording's, which Playwright does not promise.
 */
async function presentAnswer(page, index) {
  const film = (ms) => ms * speed; // on-film milliseconds → real ones

  // ── The photos ─────────────────────────────────────────────────────────────
  const total = await page.evaluate((sel) => {
    const answers = document.querySelectorAll(sel);
    const answer = answers[answers.length - 1];
    if (!answer) return 0;
    const imgs = [...answer.querySelectorAll("img")];
    for (const img of imgs) img.loading = "eager";
    return imgs.length;
  }, ANSWER);
  if (total > 0) {
    await page.waitForFunction((sel) => {
      const answers = document.querySelectorAll(sel);
      const answer = answers[answers.length - 1];
      return !answer || [...answer.querySelectorAll("img")].every((i) => i.complete);
    }, ANSWER, { timeout: 20_000 }).catch(() => {});
  }
  const health = await page.evaluate((sel) => {
    const answers = document.querySelectorAll(sel);
    const imgs = [...(answers[answers.length - 1]?.querySelectorAll("img") ?? [])];
    const bad = imgs.filter((i) => !(i.complete && i.naturalWidth > 0));
    return {
      loaded: imgs.length - bad.length,
      hosts: [...new Set(bad.map((i) => { try { return new URL(i.src).host; } catch { return "?"; } }))],
    };
  }, ANSWER);
  const report = { answer: index + 1, total, ...health };
  if (total) {
    console.log(`  answer ${index + 1}: ${health.loaded}/${total} photos drew`);
    if (health.loaded < total) {
      console.warn(`  (photos that did not draw came from ${health.hosts.join(", ")})`);
    }
  }
  // One frame for the decoded photos to paint before the camera moves.
  await page.waitForTimeout(film(250));

  // ── The pan ────────────────────────────────────────────────────────────────
  await page.evaluate(async ({ scroller, question, timing }) => {
    const el = document.querySelector(scroller);
    if (!el) return;
    // Two shapes of movement. Finding the question is a quick ease in and out. Reading is
    // not: an ease-in-out over a nine-second pan peaks at three times its average speed,
    // which is the middle of the answer going past too fast to read. So the pan speeds up
    // over its first seventh, holds one steady speed, and settles over its last — barely
    // faster than average anywhere.
    const find = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const read = (t) => {
      const a = 0.15, v = 1 / (1 - a);
      if (t < a) return (v * t * t) / (2 * a);
      if (t > 1 - a) return 1 - (v * (1 - t) * (1 - t)) / (2 * a);
      return v * (t - a / 2);
    };
    const glide = (to, ms, ease) => new Promise((resolve) => {
      const from = el.scrollTop;
      if (Math.abs(to - from) < 2 || ms <= 0) { el.scrollTop = to; resolve(); return; }
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        el.scrollTop = from + (to - from) * ease(t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    const hold = (ms) => new Promise((r) => setTimeout(r, ms));

    const qs = el.querySelectorAll(question);
    const q = qs[qs.length - 1];
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    const start = q
      ? Math.min(bottom, Math.max(0, el.scrollTop + q.getBoundingClientRect().top - el.getBoundingClientRect().top - 16))
      : el.scrollTop;

    // Back to the question if the page has left it, quickly — this is the camera finding
    // its place, not part of the reading.
    if (Math.abs(el.scrollTop - start) > 2) {
      await glide(start, Math.min(timing.findMax, Math.abs(el.scrollTop - start) * timing.findPerPx), find);
    }
    await hold(timing.openingHold);
    const run = bottom - start;
    if (run > 2) {
      // A reading pace, not a fixed time: a three-line answer should not crawl and a
      // product grid should not fly. Bounded both ways so one long answer does not eat the
      // film and a short scroll is still a movement rather than a twitch.
      const ms = Math.max(timing.panMin, Math.min(timing.panMax, run * timing.panPerPx));
      await glide(bottom, ms, read);
    }
    await hold(timing.endHold);
  }, {
    scroller: SCROLLER,
    question: QUESTION,
    // All as the viewer sees them; `film()` stretches each for the recording.
    timing: {
      findPerPx: film(0.6), findMax: film(700),
      openingHold: film(1200),
      // ~110px a second on film: the speed you scroll a page you are reading.
      panPerPx: film(9), panMin: film(1500), panMax: film(8000),
      endHold: film(2200),
    },
  });
  return report;
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


