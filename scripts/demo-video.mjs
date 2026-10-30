#!/usr/bin/env node
/**
 * A two-minute film of the demo, recorded off the real product.
 *
 *   node scripts/demo-video.mjs --slug prada --email … --password … [--mode portal|assistant] [--out film.mp4]
 *
 * TWO FILMS, BECAUSE THERE ARE TWO DEMOS. Step 3 of the commercial cycle shows a prospect
 * either the whole platform or, for a meeting that is only about the assistant, the
 * assistant and its knowledge base alone (`brands.demo_assistant_only`). The film follows:
 *
 *  - portal (the default, "Full portal"): a tour of the platform. The brand side — home,
 *    clients and one client, covers and one cover, claims and one claim, boutiques,
 *    insights — and then the client side with the demo client's own login: their home,
 *    their covers, one cover, and the claim form they would open from it. "Platform Demo —
 *    Full Portal shall focus on the whole platform (AI assistant is not core at all)." The
 *    first film was two minutes of the assistant even for a brand being shown the
 *    insurance programme, which demonstrated the one part that was not being sold. The
 *    assistant appears here only if asked for (`--cameo`), as one question at the end of
 *    the brand side.
 *  - assistant ("Assistant + knowledge only"): the assistant answering three of the
 *    brand's own opening questions. In that mode the other screens are not reachable, so a
 *    tour of them would film redirects. It opens on titles (scripts/demo-intro.mjs): the
 *    places a house's data lives drawing into one, the eleven agents, the house's mark —
 *    then dissolves into the login. `--no-intro` leaves them out.
 *
 * The mode is decided, in order, by `--mode` / AION_DEMO_MODE, by build-collateral's
 * demo_login if it says, and otherwise by the portal itself: after logging in, the sidebar
 * either has Covers in it or it does not. That last one is the product's own answer to
 * "which demo is this", so a film cannot be recorded in the wrong mode by a caller who did
 * not pass one.
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
import { playIntro } from "./demo-intro.mjs";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
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

// ── The platform tour ────────────────────────────────────────────────────────
//
// WHAT IT SHOWS, AND IN WHAT ORDER. The order a brand's day goes in, not the sidebar's:
// home, where it starts; the clients, and one of them in full, because the book of business
// is the thing the platform is built around; the covers that book holds, and one cover; the
// claims, and one claim, which is the moment the programme earns its keep; the boutiques
// that registered them; and insights last, as the summary of everything just shown. Then
// the other side of the same programme: the demo client logs in and sees their own covers,
// opens one, and opens the claim form from it — the form, not a claim, and the film ends
// there. Submitting one would write a row into a demo the prospect is about to be handed,
// and the form is the point.
//
// HOW IT IS PACED. The way the assistant answers are: a beat on arrival, a steady pan at
// reading speed through anything longer than the screen, a hold at the end. Lists are panned
// a screen or so, not to the bottom — five hundred covers is a fact the count states, and
// the film is two minutes. Every duration is on-film (see `film`), so --speed compresses the
// loading and not the looking.
//
// NOTHING IS FILMED HALF-LOADED. Each screen is waited on until its skeletons and spinners
// are gone, its content has stopped changing, and its photos have drawn — the covers carry
// the house's own product photos, hotlinked like the assistant's, and a cover list of grey
// squares is the film Giulio sent back the first time.
//
// Moves happen through the product: the sidebar is hovered and clicked, a row is hovered
// and clicked. Headless video has no cursor, so the hover is what tells the viewer where the
// next screen came from — the row lights up before it opens.

/** Brand portal. `open` is the one record of the list the film goes into. */
const BRAND_TOUR = [
  { path: "/dashboard", label: "home", hold: 1800, run: 900 },
  {
    path: "/customers", label: "clients", hold: 1400, run: 700,
    open: { rows: "main tr.cursor-pointer", url: /\/customers\/[^/]+$/, label: "a client", hold: 1600, run: 1400 },
  },
  {
    path: "/covers", label: "covers", hold: 1400, run: 800,
    open: { rows: "main .glass-card.cursor-pointer", url: /\/covers\/[^/]+$/, label: "a cover", hold: 1600, run: 1100 },
  },
  {
    path: "/claims", label: "claims", hold: 1400, run: 700,
    open: { rows: "main tr.cursor-pointer", url: /\/claims\/[^/]+$/, label: "a claim", hold: 1600, run: 1100 },
  },
  { path: "/shops", label: "boutiques", hold: 1600, run: 700 },
  { path: "/insights", label: "insights", hold: 1800, run: 1400 },
];

/** Client portal, on the demo client's own login. */
const CLIENT_TOUR = [
  { path: "/home", label: "client home", hold: 1600, run: 700 },
  {
    path: "/covers", label: "client covers", hold: 1400, run: 500,
    open: { rows: "main .glass-card.cursor-pointer", url: /\/covers\/[^/]+\/view$/, label: "their cover", hold: 1600, run: 900 },
  },
  // Back to the list, and into the claim form from the cover's own button — the path a
  // client actually takes. A cover that already has a claim offers "Manage Claim" instead,
  // which is the other half of the same story, so that is filmed if it is what is there.
  {
    path: "/covers", label: "client covers", hold: 600, run: 0,
    open: { rows: 'main a[href*="/claims/new"], main a[href*="/claims?edit="]', url: /\/claims(\/new|\?edit=|$)/, label: "the claim form", hold: 2000, run: 900 },
  },
  // It ends on the form. A demo client's claims list is empty by design — the claim is the
  // one they are about to open — and "No claims yet" is a flat last frame for a film.
];

/** A link in the portal's sidebar, not one of the same href on the page. */
const SIDEBAR_LINK = (path) => `[data-sidebar="sidebar"] a[href="/${slug}${path}"]`;

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
// The same, for a brand with no client book: questions the site alone can answer.
const FALLBACK_NO_BOOK = [
  "Parlami del nostro pezzo iconico — materiali, lavorazione e cura.",
  "Mi daresti la policy di reso per un cliente che vive in Polonia e ha acquistato in Brasile?",
  "Raccontami la storia del brand, i valori e il tone of voice.",
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
// The client side of the tour needs the demo client's own login. Onboarding makes one with
// the other two (it owns the generated client with the fullest book); demo_login hands it
// back as `client` once build-collateral passes it, and these flags cover the meantime.
let clientEmail = arg("client-email", process.env.AION_DEMO_CLIENT_EMAIL ?? "");
let clientPassword = arg("client-password", process.env.AION_DEMO_CLIENT_PASSWORD ?? "");
const base = arg("base", "https://dev.app.aioncover.com");
// portal | assistant. Empty means "find out" — see the header.
let mode = normaliseMode(arg("mode", process.env.AION_DEMO_MODE ?? ""));
// One assistant question at the end of the brand side of the tour. Off unless asked: in a
// full-portal demo the assistant is not the point, and a minute of answer is a minute of
// the film spent on it.
const cameo = process.argv.includes("--cameo");
// Named after what it is a film of, which is only known once the mode is.
const outArg = arg("out", "");
// Three answers was a shade over ninety seconds at this speed; reading each one through at
// a person's pace (presentAnswer) adds ten seconds or so apiece, which puts three at about
// two minutes. Four would be longer than a demo video earns.
const count = Number(arg("questions", 3));
const asked = (arg("ask", "") || "").split("|").map((q) => q.trim()).filter(Boolean);
// 1×: what moves on screen — the titles, the typing, the reading pans — plays at the speed
// it happened. It was 1.5×, from when the whole film was sped up uniformly to keep it short;
// now the length comes from the waits alone (maxSeconds, below), and the speed-up had a
// cost: the CI runner's Chrome paints about thirty frames a second, a 1.5× cut needs
// forty-five, and the difference was one repeated frame in three — the stutter Giulio saw
// in the titles (2026-10-30, measured: steps of "5 5 0 8 0 11 9 0" in a pan that should
// glide). A smaller number here is the fix; the flag stays for a film that wants otherwise.
const speed = Number(arg("speed", 1));
// The film's longest. The titles, the typing and the reading of each answer keep their pace;
// what gives is the wait while an answer streams, which is sped up as much as it takes to
// fit — and no more. "Make them max 2 minutes" (Giulio, 2026-10-30): three answers at a flat
// 1.5× ran to four. 0 turns the cap off.
const maxSeconds = Number(arg("max-seconds", 120));
/** On-film milliseconds → real ones. Every hold and pan below is written as the viewer sees it. */
const film = (ms) => ms * speed;
// The opening titles (scripts/demo-intro.mjs): the data wall, the eleven agents, the house.
// On for an assistant film unless --no-intro; --intro forces it on a film whose mode the
// recorder could not know before the login (see logIn), where it would otherwise be left out
// rather than risk opening a platform tour with the assistant's titles.
const introFlag = process.argv.includes("--no-intro") ? false : process.argv.includes("--intro") ? true : null;
// The titles' language. Empty means the login page's own — the portal's toggle, not the
// browser's locale, decides which the prospect will see.
const langArg = (arg("lang", process.env.AION_DEMO_LANG ?? "") || "").toLowerCase();

function normaliseMode(v) {
  const m = String(v ?? "").trim().toLowerCase();
  if (m === "portal" || m === "full" || m === "full_portal") return "portal";
  if (m === "assistant" || m === "assistant_only") return "assistant";
  return "";
}

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
/** The demo book's size, from demo_login: { clients, covers, products }. Null when not known. */
let book = null;

if ((!email || !password) && canCallBack) {
  const login = await callCollateral({ brand_id: Number(brandId), kind: "demo_login" });
  email = login.email;
  password = login.password;
  // Both optional: an older build-collateral returns neither, and the recorder then reads
  // the mode off the portal and films the brand side alone.
  if (!clientEmail && login.client?.email) {
    clientEmail = login.client.email;
    clientPassword = login.client.password;
  }
  if (!mode && typeof login.assistant_only === "boolean") mode = login.assistant_only ? "assistant" : "portal";
  if (login.book) book = login.book;
  console.log(`using the demo login for ${login.brand}`);
}
// No clients or no covers: the brand's demo book has not been built (or was purged). Unknown —
// a login given by hand, an older build-collateral — is not taken as empty.
const noBook = book ? !(book.clients > 0 && book.covers > 0) : false;
if (book) console.log(`book: ${book.clients} clients, ${book.covers} covers, ${book.products} products`);

if (!slug || !email || !password) {
  console.error(
    "usage: demo-video.mjs --slug <brand> (--email … --password … | --brand-id N with\n" +
    "       --functions-base/--batch-secret, or AION_FUNCTIONS_BASE/AION_BATCH_SECRET)\n" +
    "       [--mode portal|assistant] [--client-email … --client-password …] [--cameo]\n" +
    "       [--base url] [--ask \"q1|q2\"] [--questions 3] [--speed 1.5] [--out file.mp4] [--upload]\n" +
    "       [--intro | --no-intro] [--lang en|it] [--max-seconds 120]",
  );
  process.exit(2);
}
const chromePath = LOCAL_CHROME.find((p) => existsSync(p));

const work = mkdtempSync(join(tmpdir(), "aion-demo-"));
console.log(`recording ${slug}${mode ? ` (${mode})` : ""}`);

// No executablePath means Playwright's own download, which is the CI case.
// The forced scale factor is what makes the screencast 2×. The context's deviceScaleFactor
// renders the page at 2× but the screencast still hands back 1440-wide frames; with the
// flag they are 2880×1800. Measured, both ways.
// 1.5, not 2. The page is rasterised on the CPU on a two-core runner, and at 2× (2880×1800
// per frame) it managed about twenty frames a second — one repeated frame in three, which
// is a stutter on anything that glides. At 1.5× (2160×1350) it is 56% of the pixels, still
// above the film's own 1920, so the text stays sharp and the frames arrive on time.
const SCALE = Number(arg("scale", 1.5));
const launchArgs = [`--force-device-scale-factor=${SCALE}`];
const browser = await chromium.launch(chromePath
  ? { executablePath: chromePath, headless: true, args: launchArgs }
  : { headless: true, args: launchArgs })
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
  deviceScaleFactor: SCALE,
  locale: "it-IT",
});
const page = await context.newPage();

// THE PICTURE. Not Playwright's recordVideo: that takes its frames at the CSS size, 1440×900,
// whatever the device scale, and writes them as realtime VP8 at about a megabit — so the page
// was rendered at 2× and the film kept none of it, and no re-encode afterwards can put back
// what was never captured. "Qualità dell'MP4 troppo bassa" was that. The same screencast
// Playwright uses underneath, taken here at 2880×1800 (see launchArgs).
//
// Streamed, not kept: the first version wrote every frame to disk as a still, and Chrome
// paints about sixty a second while text streams — 8,900 stills, 1.3 GB, in under three
// minutes, which filled the Mac it ran on. So a clock at 30 fps hands the latest frame to an
// ffmpeg that is already running, and what lands on disk is one near-lossless 1920-wide
// file, mostly a static screen and so small. The speed-up and the real encode come after.
// 30 fps TIMES THE SPEED, so that after the cut's setpts the film is exactly 30 fps with no
// frame thrown away. At a flat 30 the 1.5× cut had to drop every third frame — two steps and
// a skip, two steps and a skip — which was invisible on a chat that mostly sits still and
// was the "scattery" look of the titles, where everything moves (Giulio, 2026-10-30).
const RATE = Math.round(30 * speed);
const raw = join(work, "raw.mp4");
const capture = spawn("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(RATE), "-c:v", "mjpeg", "-i", "-",
  "-vf", `scale=1920:${Math.round((1920 * SIZE.height) / SIZE.width / 2) * 2}:flags=lanczos`,
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", raw,
], { stdio: ["pipe", "ignore", "inherit"] });
const captureDone = new Promise((res, rej) => {
  capture.on("error", rej);
  capture.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg capture exited ${code}`))));
});
let latest = null;
let startedAt = 0;
let written = 0;
/** Off until the first login page has drawn (see logIn): the frames before it are the SPA's
 *  loading spinner, and a film should not open on one. */
let rolling = false;
const roll = () => { if (!rolling) { rolling = true; startedAt = Date.now(); } };
/** Where the waits are, in seconds of recording: each entry opens or closes a stretch of
 *  waiting for an answer. The cut speeds those stretches up on their own (see maxSeconds). */
const waits = [];
const mark = (waiting) => { if (rolling) waits.push({ at: (Date.now() - startedAt) / 1000, waiting }); };
/** Frames owed by the wall clock, not by the timer: setInterval runs late under load, and a
 *  film counted in ticks would come out shorter than what happened. */
const tick = () => {
  if (!latest || !rolling) return;
  const due = Math.floor(((Date.now() - startedAt) / 1000) * RATE) + 1;
  for (; written < due; written++) capture.stdin.write(latest);
};
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  // The first frames are painted before the viewport is applied — 1440×813, not ×900 — and
  // the pipe takes its size from the first frame it gets, so one of those squashed the whole
  // film by a tenth. Only full-viewport frames go in.
  if (metadata.deviceWidth !== SIZE.width || metadata.deviceHeight !== SIZE.height) return;
  latest = Buffer.from(data, "base64");
});
// Handed over at 1920 wide, not 2880: the page is still rendered at 2× (the flag above),
// Chrome scales each frame down before encoding it, and the film is 1920 wide at the end in
// any case. Encoding 2.25× fewer pixels per frame is what lets a two-core runner keep up
// with its own compositor; at 2880 it painted unevenly and the film stuttered.
await cdp.send("Page.startScreencast", {
  format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: Math.round((1920 * SIZE.height) / SIZE.width), everyNthFrame: 1,
});
const clock = setInterval(tick, 1000 / RATE);
/** Per answer, or per screen of the tour: how many photos it had and how many actually drew. */
const photos = [];

/** The SPA mounts after domcontentloaded, so every wait is for a thing, never for a timeout. */
const gotoAndSettle = async (url, selector) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(selector, { timeout: 45_000 });
};

try {
  await logIn(page, email, password);

  // ── Which film ───────────────────────────────────────────────────────────
  if (!mode) mode = await modeFromPortal(page);
  console.log(`mode: ${mode}${mode === "portal" ? (clientEmail ? " (brand side + client side)" : " (brand side only — no client login given)") : ""}`);

  // The tour IS the book — clients, covers, claims — so without one it films empty tables.
  // Refused rather than recorded: a film like that gets sent.
  if (mode === "portal" && noBook) {
    throw new Error(
      "this brand has no client book yet, and the platform tour is a tour of it. " +
      "Build the demo book (Demo book of business), then record.",
    );
  }

  // A clean slate. Every recording leaves its three chats on the demo login, and by the
  // fourth film the sidebar was nine copies of "Tell me about Gilet OPERA…" — odd on camera,
  // and odd for the prospect who signs in with the same login afterwards. Cleared here,
  // after the login and before the camera reaches the chat, so the film's own chats are the
  // only ones there.
  await clearDemoChats(page);

  if (mode === "assistant") {
    await filmAssistant(page, { count });
  } else {
    await tourPortal(page);
  }
} catch (e) {
  console.error("recording failed:", e instanceof Error ? e.message : e);
  clearInterval(clock);
  capture.kill();
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

tick();
const stoppedAt = Date.now();
clearInterval(clock);
await cdp.send("Page.stopScreencast").catch(() => {});
capture.stdin.end();
await context.close();
await browser.close();

if (!written) { console.error("no video was recorded"); process.exit(1); }
await captureDone;

// ── Cut ────────────────────────────────────────────────────────────────────
// Sped up, not trimmed. Cutting the waits out would be the same lie as rendering the thing:
// what it takes to answer is part of what is being shown. The frame rate is raised to match
// so the result does not stutter.
// The recording is the expensive part — two minutes of driving a live assistant — and ffmpeg
// will not create a missing directory, so a `--out` pointing somewhere that has since been
// tidied away throws it all away at the last step. It happened.
const out = outArg || `AION-${slug}-${mode === "assistant" ? "assistant" : "platform"}.mp4`;
mkdirSync(dirname(out) || ".", { recursive: true });

console.log("encoding…");
// 1920 wide: the 2× capture scaled down is sharper text than 1440 ever was, and still plays
// on any laptop or phone. CRF 18 because the picture is mostly flat colour and small type,
// which is exactly what a higher CRF smears.
//
// TWO SPEEDS, NOT ONE. Everything plays at `speed` except the stretches where the film is
// waiting for an answer to stream, which play at whatever speed brings the whole film inside
// `maxSeconds` — between `speed` (no cap needed) and 8× (past which the stream is a smear
// and the saving is pennies). The answer is still read through at a person's pace
// afterwards, so nothing the viewer is meant to read goes by fast. If the cap cannot be met
// even so, the film is cut at 8× for the waits and the log says by how much it misses.
const recorded = (stoppedAt - startedAt) / 1000;
const segments = [];
{
  let at = 0, waiting = false;
  for (const w of waits) {
    if (w.at > at + 0.05) segments.push({ from: at, to: w.at, waiting });
    at = Math.max(at, w.at); waiting = w.waiting;
  }
  if (recorded > at + 0.05) segments.push({ from: at, to: recorded, waiting });
}
const waitSec = segments.filter((s) => s.waiting).reduce((n, s) => n + (s.to - s.from), 0);
const restSec = segments.filter((s) => !s.waiting).reduce((n, s) => n + (s.to - s.from), 0);
let waitSpeed = speed;
if (maxSeconds > 0 && waitSec > 0) {
  // Aimed a little under the cap, so the rounded length is under it too.
  const room = (maxSeconds - 2) - restSec / speed;
  waitSpeed = room > 0 ? Math.min(8, Math.max(speed, waitSec / room)) : 8;
  const length = restSec / speed + waitSec / waitSpeed;
  if (length > maxSeconds + 1) {
    console.warn(`WARNING: the film runs ${Math.round(length)}s against a cap of ${maxSeconds}s even with the waits at 8× — fewer questions (--questions) is the lever left.`);
  } else if (waitSpeed > speed) {
    console.log(`the waits for answers (${Math.round(waitSec)}s recorded) play at ${waitSpeed.toFixed(1)}× to fit ${maxSeconds}s; everything else at ${speed}×`);
  }
}
const filter = segments.length > 1 || waitSpeed !== speed
  ? segments.map((s, i) =>
    `[0:v]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=(PTS-STARTPTS)/${(s.waiting ? waitSpeed : speed).toFixed(4)}[v${i}]`,
  ).join(";") + `;${segments.map((_, i) => `[v${i}]`).join("")}concat=n=${segments.length}:v=1:a=0,fps=30[out]`
  : null;
execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error", "-i", raw,
  ...(filter
    ? ["-filter_complex", filter, "-map", "[out]"]
    : ["-filter:v", `setpts=${(1 / speed).toFixed(4)}*PTS,fps=30`]),
  "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
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
      .map((p) => `${p.label ?? `answer ${p.answer}`}: ${p.loaded}/${p.total} (${p.hosts.join(", ") || "?"})`)
      .join("; ")}. Watch it before sending it.`,
  );
}
const stood_in = [...new Set(photos.flatMap((p) => p.fellBack ?? []))];
if (stood_in.length) {
  console.warn(
    `WARNING: the brand's own imagery did not load, so the film shows AION's default in its place — ` +
    `${stood_in.join(" ")}. Fix the brand record (Brand → Appearance) and film again.`,
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

/** Log in as the prospect would — or as their client would; it is the same page. */
async function logIn(page, who, secret) {
  await gotoAndSettle(`${base}/${slug}/login`, 'input[type="email"]');
  // The login is the first frame of the film and the brand's own background is half of it,
  // so it is waited for and counted like any other screen's photos. It used not to be: the
  // camera ran from domcontentloaded, and Brunello's film opened on "Brunello Cucinelli" in
  // alt text over a grey half-screen without the log saying a word.
  await photosDrawn(page, who === clientEmail ? "client login" : "login");
  roll();
  // The titles, over the login and before anything is typed — the film opens on them and
  // dissolves into the house's own sign-in. Only the brand's login, only an assistant film.
  if (who !== clientEmail) {
    const wanted = introFlag ?? (mode === "assistant");
    if (wanted) {
      const house = await page.evaluate(() => {
        // The form's logo (SmartLogo, alt = the house's name); the hero photo has the same
        // alt but is a photograph.
        const img = document.querySelector(".max-w-md img") ?? document.querySelector('img[alt]:not([src*="unsplash"])');
        const accedi = [...document.querySelectorAll("button")].some((b) => /accedi/i.test(b.textContent ?? ""));
        const src = img?.currentSrc || img?.src || "";
        // A house with no logo of its own signs in under AION's, and "AION × AION" is not a
        // title card. Its name is set in type instead.
        const own = src && !/aion[_-]?(dark|light)?[_-]?(logo|icon)|\/aion\.(png|svg)/i.test(src);
        return { name: img?.alt ?? document.title ?? "", logo: own ? src : "", lang: accedi ? "it" : "en" };
      });
      const lang = langArg === "it" || langArg === "en" ? langArg : house.lang;
      console.log(`intro: ${lang}${house.name ? ` for ${house.name}` : ""}`);
      await playIntro(page, { film, lang, brand: house.name, logoUrl: house.logo });
    } else if (introFlag === null && !mode) {
      console.log("intro: skipped — the film's mode is not known before the login; pass --mode assistant or --intro to open on the titles");
    }
  }
  await page.fill('input[type="email"]', who);
  await page.fill('input[type="password"]', secret);
  // BY ITS NAME, not by button[type="submit"]. The login page has three submit buttons and
  // the first of them is invisible, so a type selector clicks something that can never be
  // clicked and Playwright retries until it times out. Both languages, because the portal's
  // toggle is independent of the browser locale.
  const button = page.getByRole("button", { name: /log\s?in|accedi/i }).first();
  await button.waitFor({ state: "visible", timeout: 30_000 });
  await curtainDown(page);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 60_000 }),
    button.click(),
  ]);
  await screenReady(page, "landing");
  await curtainUp(page);
}

/**
 * Delete the demo login's previous chats, as the user it is signed in as.
 *
 * Through PostgREST with the session the portal just opened (the Supabase auth token the
 * SPA keeps in localStorage), under the table's own owner-delete policy — so it can only
 * ever remove this login's chats, the same ones the trash icon in the sidebar removes one
 * at a time. The anon key is the gateway's apikey when the caller has it; failing that the
 * user's own token is accepted there too. Anything that goes wrong is said and skipped:
 * a film with a crowded sidebar beats no film.
 */
async function clearDemoChats(page) {
  const session = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const m = key.match(/^sb-([a-z0-9]+)-auth-token$/);
      if (!m) continue;
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? "null");
        const token = v?.access_token ?? v?.currentSession?.access_token ?? null;
        if (token) return { ref: m[1], token };
      } catch { /* not ours */ }
    }
    return null;
  }).catch(() => null);
  if (!session) { console.warn("WARNING: no session found to clear the demo login's previous chats; the sidebar will show them"); return; }
  try {
    const res = await fetch(`https://${session.ref}.supabase.co/rest/v1/ai_chats_brand?id=not.is.null`, {
      method: "DELETE",
      headers: {
        apikey: anonKey || session.token,
        Authorization: `Bearer ${session.token}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const removed = (res.headers.get("content-range") ?? "").split("/")[1] ?? "?";
    console.log(`cleared ${removed} previous chat(s) from the demo login`);
    // The sidebar read its list on mount; the page is loaded again below in every path that
    // films it, except an assistant-only demo that is already there — so refresh that one.
    if (new URL(page.url()).pathname === `/${slug}/assistant`) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(COMPOSER, { timeout: 45_000 });
    }
  } catch (e) {
    console.warn(`WARNING: could not clear the demo login's previous chats (${e instanceof Error ? e.message : e}); the sidebar will show them`);
  }
}

/**
 * Which demo this brand is set up for, read off the portal rather than assumed.
 *
 * In an assistant-only demo the sidebar keeps Assistant and Knowledge and drops everything
 * else (AppSidebar's assistantOnlyPaths), so a brand sidebar with no Covers link is an
 * assistant demo. Waited on the Assistant link first, which both modes have: the sidebar
 * mounts after the redirect, and reading it a frame early would see no Covers in a full
 * portal too.
 */
async function modeFromPortal(page) {
  const sidebar = SIDEBAR_LINK("/assistant");
  await page.waitForSelector(sidebar, { timeout: 30_000 }).catch(() => {});
  const covers = await page.locator(SIDEBAR_LINK("/covers")).count();
  return covers > 0 ? "portal" : "assistant";
}

/** The assistant film: the brand's own opening questions, each answered and read through. */
async function filmAssistant(page, { count, arrive = "url" }) {
  // Into the assistant the way a person gets there: from the sidebar mid-tour, by URL when
  // it is the whole film (where the login has landed on a page the film is not about).
  if (arrive === "sidebar" && await viaSidebar(page, "/assistant", "assistant")) {
    await page.waitForSelector(COMPOSER, { timeout: 45_000 });
  } else if (new URL(page.url()).pathname === `/${slug}/assistant`) {
    // An assistant-only demo lands here from the login. Loading it again only filmed the
    // SPA's spinner between the login's dissolve and the same screen.
    await page.waitForSelector(COMPOSER, { timeout: 45_000 });
  } else {
    await gotoAndSettle(`${base}/${slug}/assistant`, COMPOSER);
  }
  await page.waitForTimeout(film(1500));

  const composer = page.locator(COMPOSER).first();

  // The opening screen is quiet now — a greeting and the composer — and the brand's prompts
  // sit behind one button ("See what you can ask", data-assistant-examples). Opened here the
  // way a person would, and on camera: the viewer sees the empty screen, then the examples,
  // then the first one typed. An older bundle without the button shows the prompts outright,
  // and is read as before.
  const reveal = page.locator("[data-assistant-examples]").first();
  if (!asked.length && await reveal.count().catch(() => 0)) {
    await reveal.hover().catch(() => {});
    await page.waitForTimeout(film(600));
    await reveal.click().catch(() => {});
    await page.waitForSelector("main button[data-assistant-prompt]", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(film(1100));
  }

  // The brand's own opening prompts, before anything is typed — they disappear with the first
  // answer. Marked as such (data-assistant-prompt); failing that, anything long enough to be a
  // question, since the screen also carries short UI labels.
  // A prompt only the client book can answer says so (data-needs="clients"), and with no book
  // it is left out: the alternative is filming "no client data is connected" — Ferragamo's
  // first film, recorded seven hours before its book was built.
  const onScreen = asked.length ? [] : await page
    .locator("main button, [role='main'] button")
    .evaluateAll((els) => els.map((el) => ({
      text: (el.innerText ?? "").replace(/\s+/g, " ").trim(),
      needs: el.getAttribute("data-needs"),
      prompt: el.hasAttribute("data-assistant-prompt"),
    })))
    .then((all) => {
      const marked = all.filter((b) => b.prompt);
      return (marked.length ? marked : all.filter((b) => b.text.length > 40))
        .filter((b) => !(b.needs === "clients" && noBook))
        .map((b) => b.text);
    })
    .catch(() => []);
  if (noBook && !asked.length) {
    console.warn(
      "WARNING: this brand has no client book yet, so the film skips the client questions. " +
      "Build the demo book (Demo book of business) and record it again — that is the film to send.",
    );
  }

  // Spread across the list, not the first three off the top. The opening prompts are grouped
  // by kind — the product ones first, then the client and planning ones — so taking the top
  // three films two variations on the same handbag. Evenly spaced gives the range the
  // assistant actually has, which is the thing being demonstrated.
  const pool = asked.length ? asked : onScreen.length ? onScreen : noBook ? FALLBACK_NO_BOOK : FALLBACK_QUESTIONS;
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
    mark(true);
    await settled(page);
    mark(false);
    // Then read it, which is what a person does with an answer and what the film is for.
    photos.push(await presentAnswer(page, i));
  }
}

async function tourPortal(page) {
  for (const scene of BRAND_TOUR) await playScene(page, scene);

  if (cameo) {
    // One question, from the brand's own opening prompts, read through like the assistant
    // film's. At the end of the brand side because that is where it is least in the way.
    await filmAssistant(page, { count: 1, arrive: "sidebar" });
  }

  if (!clientEmail || !clientPassword) {
    console.warn("  (no client login — the film shows the brand side only. Pass --client-email/--client-password.)");
    return;
  }

  // Signed out by forgetting the session, not through the profile menu: the menu is a
  // sheet with a confirmation in it, and filming somebody hunting for "Sign out" says
  // nothing about the product. The reload lands on the brand's own login, which is where a
  // client starts.
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
  await logIn(page, clientEmail, clientPassword);
  for (const scene of CLIENT_TOUR) await playScene(page, scene);
}

/** One screen: arrive, wait for it, look at it — and, if it has one, open a record and look at that. */
async function playScene(page, scene) {
  const here = new URL(page.url()).pathname;
  // A screen that is going to have a row opened is not ready until that row is there. A
  // list can draw its empty state before its query has even started — BrandCovers shows
  // "No covers found." while the profile loads — and stay quiet long enough to pass for
  // finished; the first recording skipped the cover detail on exactly that.
  const expect = scene.open?.rows;
  if (here !== `/${slug}${scene.path}`) {
    if (!(await viaSidebar(page, scene.path, scene.label, expect))) return;
  } else {
    await screenReady(page, scene.label, expect);
  }
  console.log(`  ${scene.label}`);
  await look(page, scene);

  if (scene.open && (await openOne(page, scene.open))) {
    console.log(`  ${scene.open.label}`);
    await look(page, scene.open);
  }
}

/** Through the sidebar, with the hover that shows where the click came from. */
async function viaSidebar(page, path, label, expect) {
  const link = page.locator(SIDEBAR_LINK(path)).first();
  if (!(await link.count())) {
    console.warn(`  (no ${label} in the sidebar — skipped)`);
    return false;
  }
  await link.hover();
  await page.waitForTimeout(film(450));
  await curtainDown(page);
  await Promise.all([
    page.waitForURL((u) => new URL(u).pathname === `/${slug}${path}`, { timeout: 30_000 }),
    link.click(),
  ]);
  await screenReady(page, label, expect);
  await curtainUp(page);
  return true;
}

/**
 * Open one record off the list — one that is on screen, so the click is not preceded by a
 * jump. Playwright scrolls a target into view before clicking it, instantly; after a pan
 * that would be a lurch, and the film has spent the whole of the assistant's rework getting
 * rid of those.
 *
 * Clicked near its left edge. A cover row carries the client's name as its own link, which
 * goes to the client — clicked in the middle, the film would open the wrong thing.
 */
async function openOne(page, { rows, url, label }) {
  const picked = await page.evaluate((sel) => {
    const main = document.querySelector("main");
    const box = (main ?? document.body).getBoundingClientRect();
    const all = [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0);
    const inView = all.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= box.top + 8 && r.bottom <= box.bottom - 8;
    }) ?? all[0];
    document.querySelectorAll("[data-demo-pick]").forEach((e) => e.removeAttribute("data-demo-pick"));
    if (!inView) return null;
    inView.setAttribute("data-demo-pick", "");
    const r = inView.getBoundingClientRect();
    return { w: r.width, h: r.height, link: inView.tagName === "A" };
  }, rows);
  if (!picked) {
    console.warn(`  (nothing to open for ${label} — skipped)`);
    return false;
  }
  const row = page.locator("[data-demo-pick]").first();
  // A link is clicked where it is; a row at its left edge, clear of the links inside it.
  const position = picked.link ? undefined : { x: Math.min(28, picked.w / 2), y: Math.min(24, picked.h / 2) };
  await row.hover({ position });
  await page.waitForTimeout(film(600));
  await curtainDown(page);
  try {
    await Promise.all([
      page.waitForURL((u) => url.test(new URL(u).pathname + new URL(u).search), { timeout: 20_000 }),
      row.click({ position }),
    ]);
  } catch {
    await curtainUp(page);
    console.warn(`  (opening ${label} did not navigate — skipped)`);
    return false;
  }
  await screenReady(page, label);
  await curtainUp(page);
  return true;
}

/**
 * THE CURTAIN. Between a click and the next screen being ready the portal shows what any
 * SPA shows — skeleton bars, a spinner, a list arriving row by row — and filmed, at 1.5×,
 * that is a flicker of grey on every move. Waiting for the screen to be ready (screenReady)
 * decides when the camera looks; it cannot stop the recording seeing the wait.
 *
 * So the moment before a move is photographed and laid over the page — a still of exactly
 * what was on screen, the hovered row still lit — while the app navigates and loads
 * underneath it, and is faded off once the new screen is finished. The viewer sees the
 * click land, a held frame, and a short dissolve into a complete screen. The wait is still
 * in the film, held rather than cut, like the assistant's answers; only the half-drawn
 * frames are not.
 *
 * It lives on <body>, outside React's root, so a route change does not take it away, and
 * it lets the pointer through, so the click it covers still reaches the row beneath it. A
 * full page load (the sign-in) replaces the document, and the curtain with it — which is
 * why the client's half starts on its own login page, as a client's would.
 */
async function curtainDown(page) {
  const shot = await page.screenshot({ type: "jpeg", quality: 85 }).catch(() => null);
  if (!shot) return;
  await page.evaluate((src) => {
    document.getElementById("demo-curtain")?.remove();
    const c = document.createElement("div");
    c.id = "demo-curtain";
    c.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:1;" +
      `background:#fff url(${src}) 0 0/100% 100% no-repeat`;
    document.body.appendChild(c);
  }, `data:image/jpeg;base64,${shot.toString("base64")}`);
}

async function curtainUp(page) {
  await page.evaluate(async (ms) => {
    // Every screen starts at its top. The portal scrolls one <main> for every route, so
    // without this a screen opens wherever the last one's pan left off — the first cut
    // arrived on the covers list halfway down it.
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
    const c = document.getElementById("demo-curtain");
    if (!c) return;
    c.style.transition = `opacity ${ms}ms ease`;
    requestAnimationFrame(() => { c.style.opacity = "0"; });
    await new Promise((r) => setTimeout(r, ms + 60));
    c.remove();
  }, film(380)).catch(() => {});
}

/**
 * Wait for a screen to be finished: no skeleton or spinner showing, content no longer
 * changing, every photo drawn. Bounded throughout — a screen that never settles is filmed as
 * it is and said so, rather than holding the run until the job times out.
 */
async function screenReady(page, label, expect) {
  const t0 = Date.now();
  const took = {};
  if (expect) {
    await page.waitForSelector(expect, { state: "visible", timeout: 20_000 })
      .catch(() => console.warn(`  (${label}: nothing matching ${expect} after 20s)`));
  }
  // Skeletons are `animate-pulse` and spinners `animate-spin`, here and in every page of the
  // portal; visible ones only, since a hidden button's spinner is not a loading screen.
  await page.waitForFunction(() => {
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    return ![...document.querySelectorAll(".animate-pulse, .animate-spin")].some(shown);
  }, null, { timeout: 30_000 }).catch(() => console.warn(`  (${label}: still loading after 30s — filmed what there was)`));
  took.loaders = Date.now() - t0;

  // A page can be spinner-free and still be filling in — a second query, a list whose rows
  // stagger in. Quiet for 700ms is "done".
  await page.evaluate(async () => {
    const root = document.querySelector("main") ?? document.body;
    const sig = () => `${root.innerText.length}:${root.querySelectorAll("*").length}`;
    const t0 = performance.now();
    let last = sig(), since = performance.now();
    while (performance.now() - t0 < 10_000) {
      await new Promise((r) => setTimeout(r, 150));
      const now = sig();
      if (now !== last) { last = now; since = performance.now(); }
      else if (performance.now() - since >= 700) return;
    }
  });
  took.content = Date.now() - t0 - took.loaders;

  await photosDrawn(page, label, { settle: false });
  took.photos = Date.now() - t0 - took.loaders - took.content;
  // Every wait here is held on film under the curtain, so a slow screen is a long still.
  // Said, so the log explains a film that drags.
  const all = Date.now() - t0;
  if (all > 4000) {
    console.log(`  (${label}: ready in ${(all / 1000).toFixed(1)}s — loaders ${(took.loaders / 1000).toFixed(1)}s, ` +
      `content ${(took.content / 1000).toFixed(1)}s, photos ${(took.photos / 1000).toFixed(1)}s)`);
  }
  // One frame for the decoded photos to paint before the camera moves.
  await page.waitForTimeout(film(250));
}

/**
 * The photos on screen, as for an answer: eager, waited for, counted. A broken one is
 * reported with the host it came from — and the URL itself, because "brunellocucinelli.com"
 * does not say that the address stops at `/upload/f_auto`.
 */
async function photosDrawn(page, label, { settle = true } = {}) {
  const total = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    for (const img of imgs) img.loading = "eager";
    return imgs.length;
  });
  if (total > 0) {
    await page.waitForFunction(
      () => [...document.querySelectorAll("img")].every((i) => i.complete),
      null, { timeout: 20_000 },
    ).catch(() => {});
  }
  // A beat for an onError fallback (AuthPanel's, the client banner's) to swap and load.
  await page.waitForTimeout(300);
  const health = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    const bad = imgs.filter((i) => !(i.complete && i.naturalWidth > 0));
    return {
      total: imgs.length,
      loaded: imgs.length - bad.length,
      hosts: [...new Set(bad.map((i) => { try { return new URL(i.src).host; } catch { return "?"; } }))],
      urls: bad.map((i) => i.src).slice(0, 3),
      // Drew, but AION's picture in place of the brand's (data-fell-back holds the one that failed).
      fellBack: [...document.querySelectorAll("img[data-fell-back]")].map((i) => i.dataset.fellBack),
    };
  });
  if (health.total > health.loaded) {
    console.warn(`  (${label}: ${health.loaded}/${health.total} photos drew — ${health.urls.join(" ")})`);
  }
  if (health.fellBack.length) {
    console.warn(`  (${label}: the brand's own image would not load, AION's default is showing — ${health.fellBack.join(" ")})`);
  }
  photos.push({ label, ...health });
  if (settle) await page.waitForTimeout(film(250));
}

/**
 * Look at a screen: a beat, a steady pan down through up to `run` pixels of it, a hold.
 * The same reading curve as an answer's pan (presentAnswer) — level speed, eased only at
 * the ends — and the same ~110px a second on film.
 */
async function look(page, { hold = 1500, run = 0 }) {
  await page.waitForTimeout(film(hold));
  if (run > 0) {
    await page.evaluate(async ({ max, perPx, minMs, maxMs }) => {
      const el = document.querySelector("main");
      if (!el) return;
      const read = (t) => {
        const a = 0.15, v = 1 / (1 - a);
        if (t < a) return (v * t * t) / (2 * a);
        if (t > 1 - a) return 1 - (v * (1 - t) * (1 - t)) / (2 * a);
        return v * (t - a / 2);
      };
      const from = el.scrollTop;
      const to = Math.min(from + max, Math.max(0, el.scrollHeight - el.clientHeight));
      if (to - from < 24) return; // a page that fits is looked at, not twitched
      const ms = Math.max(minMs, Math.min(maxMs, (to - from) * perPx));
      await new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + (to - from) * read(t);
          if (t < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
    }, { max: run, perPx: film(9), minMs: film(1500), maxMs: film(8000) });
    await page.waitForTimeout(film(1200));
  }
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


