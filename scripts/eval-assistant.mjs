#!/usr/bin/env node
//
// Retrieval eval for the brand assistant.
//
//   node scripts/eval-assistant.mjs
//
// Every serious bug in this system has been a SILENT retrieval failure: a
// document indexed but unfindable by name, a search that returned "permission
// denied" and was read as "no results", a deleted document that kept answering,
// a gap list full of questions the assistant answers perfectly. None of them
// threw. All of them were found by someone happening to look.
//
// This asks the deployed assistant real questions and asserts on what comes
// back — the sources it retrieved and phrases the answer must or must not
// contain. It is deliberately about RETRIEVAL, not prose: it does not care how
// the answer is worded, only that the right knowledge reached it.
//
// Requires: SUPABASE_URL, SUPABASE_ANON_KEY, and a brand user's credentials
// (EVAL_EMAIL / EVAL_PASSWORD) or a ready access token in EVAL_TOKEN.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://tlmdlskiubfdhywmzgzb.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const TOKEN = process.env.EVAL_TOKEN ?? "";
const EMAIL = process.env.EVAL_EMAIL ?? "";
const PASSWORD = process.env.EVAL_PASSWORD ?? "";

// Each case states what the assistant MUST have found, in terms that survive
// rewording. `sources` matches retrieved document titles; `says` / `avoids`
// match the answer text case-insensitively.
const CASES = [
  {
    name: "policy — answers from the indexed returns document",
    ask: "What is our return and exchange policy?",
    sources: [/returns and refunds/i],
    says: [/15|fifteen/],
  },
  {
    name: "proper noun — finds an uploaded document BY NAME",
    // Regression guard: vector search alone scores this below the floor. It is
    // why the lexical pass exists.
    ask: "What is the Zafferano Protocol?",
    sources: [/zafferano/i],
    says: [/72|seventy-two/],
  },
  {
    name: "paraphrase — finds the same document by meaning",
    ask: "What do we do when a VIC client cannot attend a trunk show in person?",
    sources: [/zafferano/i],
  },
  {
    name: "brand story — reaches editorial, not product pages",
    ask: "Tell me our brand story and where the house was founded.",
    sources: [/about our exclusive brand/i],
    says: [/1984/, /brera/i],
  },
  {
    name: "catalogue — counts the whole collection, not the page it showed",
    // Regression guard: quoting the range of a LIMIT 6 told associates
    // bridesmaids start at EUR 5,850 when they start at 1,470.
    ask: "How many Bridesmaids dresses do we have and what is the price range?",
    says: [/26/, /1[.,]470/],
    avoids: [/5[.,]850\s*(to|–|-)\s*8[.,]500/i],
  },
  {
    name: "ranking is real, and labelled for what it is",
    // Regression guard: it once crowned the 7th-biggest client (Eleanor Dejoux,
    // EUR 65k) as the top spender, from five cards a similarity search happened
    // to return out of 146.
    //
    // The first version of this case banned her name outright and failed a
    // GOOD answer — one that correctly said no per-event attribution exists,
    // then gave the real lifetime ranking in the right order. Naming her is
    // fine. Crowning her is the bug, and that is what this asserts.
    ask: "Which of our clients spent the most at the New York trunk show?",
    says: [/neapolitan|jane lauder/i],
    avoids: [
      /eleanor dejoux[^.]{0,60}(top|highest|most|biggest)/i,
      /(top|highest|biggest)[^.]{0,40}eleanor dejoux/i,
    ],
  },
  {
    name: "brand isolation",
    ask: "Show me the Roberto Coin rings and compare their prices with ours.",
    avoids: [/roberto coin (ring|collection|piece)/i],
  },
  {
    name: "says it doesn't have something, rather than inventing it",
    // Also a fragile-assertion lesson: banning the phrase "Aurora Boreale is"
    // failed answers that said "Aurora Boreale is NOT a line we carry". Assert
    // the denial is present, not that a substring is absent.
    ask: "Tell me about our Aurora Boreale capsule collection.",
    says: [/(don't|do not|doesn't|not) (have|appear|carry|in our|a )|isn't|no .{0,20}record/i],
    avoids: [/aurora boreale (capsule )?(collection )?(is|was) (a|our) (new|beautiful|romantic|signature)/i],
  },
];

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;

async function getToken() {
  if (TOKEN) return TOKEN;
  if (!EMAIL || !PASSWORD) {
    console.error("Set EVAL_TOKEN, or EVAL_EMAIL and EVAL_PASSWORD.");
    process.exit(2);
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) { console.error("Login failed:", body); process.exit(2); }
  return body.access_token;
}

async function ask(token, question) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/brand-assistant`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question, locale: "en", history: [] }),
  });
  const raw = await res.text();

  let text = "";
  const sources = [];
  for (const block of raw.split("\n\n")) {
    const ev = block.match(/^event: (\S+)/m)?.[1];
    const dataLine = block.match(/^data: (.*)$/m)?.[1];
    if (!ev || !dataLine) continue;
    let data; try { data = JSON.parse(dataLine); } catch { continue; }
    if (ev === "text_delta") text += data.text ?? "";
    if (ev === "knowledge") for (const s of data.sources ?? []) sources.push(s.doc_title ?? "");
    if (ev === "sql_result") for (const r of data.rows ?? []) if (r?.name) sources.push(String(r.name));
  }
  return { text, sources };
}

const token = await getToken();
let failures = 0;

for (const c of CASES) {
  const { text, sources } = await ask(token, c.ask);
  const problems = [];

  for (const re of c.sources ?? []) {
    if (!sources.some((s) => re.test(s))) problems.push(`never retrieved ${re}`);
  }
  for (const re of c.says ?? []) {
    if (!re.test(text)) problems.push(`answer missing ${re}`);
  }
  for (const re of c.avoids ?? []) {
    if (re.test(text)) problems.push(`answer contains ${re} — it should not`);
  }
  if (!text.trim()) problems.push("empty answer");

  if (problems.length) {
    failures++;
    console.log(`${bad("FAIL")}  ${c.name}`);
    console.log(`      Q: ${c.ask}`);
    for (const p of problems) console.log(`      · ${p}`);
    console.log(`      retrieved: ${[...new Set(sources)].slice(0, 5).join(" | ") || "(nothing)"}`);
  } else {
    console.log(`${ok("pass")}  ${c.name}`);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
process.exit(failures ? 1 : 0);
