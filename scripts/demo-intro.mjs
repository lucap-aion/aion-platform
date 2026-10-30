/**
 * The film's title work — everything drawn over the product rather than by it.
 *
 *   playIntro    four beats before the product appears: AION over the house's own
 *                photograph; "All your company data, in one place" with twelve sources on
 *                one ring drawing into a centre; "11 specialised agents" counting in; a cream
 *                wipe with the house's logo × AION.
 *   playChapter  a card before each question — "01 · The piece" — so three answers read as
 *                a story with room to breathe, not a chat log.
 *   showReading  a small card in the corner while an answer streams: what is being read
 *                (clients, covers, pieces), since that stretch of the film is sped up and the
 *                viewer should know why the text is racing.
 *   playEnding   the close: "Every answer came from your own data", then the house's mark and
 *                where its demo is waiting. A film that stops on its last answer has no end.
 *
 * WHY AN OVERLAY ON THE REAL PAGE and not cards spliced in afterwards: the film is one
 * screencast, cut once; a spliced card would need a second encode, a matching resolution and
 * a seam. Drawn in the page it inherits the house's typeface variables and primary colour
 * from TenantContext, so Prada's titles are Prada-accented and Oris's are Oris's without
 * anyone choosing, and every hand-over is a fade of one element.
 *
 * WHY DARK, when the product is light. A title sequence for a luxury house is a cinema
 * convention, not a dashboard one: ink, cream type, one accent, a hairline. The cream beats
 * exist so the house's logo — nearly always drawn dark — is shown on the ground it was
 * designed for, and so the cut into the light product is a dissolve, not a flash.
 *
 * WHAT IT MUST NOT COST. The runner's Chrome paints about twenty-four frames a second and
 * the film is cut at that rate, so nothing here may make a frame expensive: transforms and
 * opacity only, no blur filters, no blend modes, nothing that animates of its own accord in
 * the background. A still photograph moving by a transform is fine; a drifting gradient
 * was not (2026-10-30, measured).
 *
 * Every duration is ON-FILM milliseconds; `film()` stretches them for the recording so the
 * pacing holds whatever --speed the cut uses.
 */

import * as si from "simple-icons";

// ── What is on the ring ──────────────────────────────────────────────────────
//
// Twelve, on one ring, in the order a house would list them: CRM, ERP, e-commerce,
// spreadsheets, channels, documents, the site. A simple-icons slug where the project carries
// the mark; a lettermark in the brand's own colour where it does not (simple-icons dropped
// Salesforce, LinkedIn and Excel at the owners' request).
//
// HONESTY NOTE for whoever edits this list. The platform reads Shopify, spreadsheets, PDF /
// Word / PowerPoint uploads, the house's website and news today; a CRM arrives as an export
// (Excel / CSV), and the social and mail channels are where the assistant's drafts go, not
// feeds it reads. The screen says "in one place", which is what the knowledge base is; it
// does not say "live sync". Keep it that way.
export const INTRO_SOURCES = [
  { label: "Salesforce", mark: "sf", hex: "00A1E0" },
  { slug: "siHubspot", label: "HubSpot" },
  { slug: "siSap", label: "SAP" },
  { slug: "siShopify", label: "Shopify" },
  { label: "Excel", mark: "X", hex: "217346" },
  { slug: "siGooglesheets", label: "Google Sheets" },
  { slug: "siInstagram", label: "Instagram" },
  { slug: "siWhatsapp", label: "WhatsApp" },
  { label: "LinkedIn", mark: "in", hex: "0A66C2" },
  { slug: "siGmail", label: "Gmail" },
  { icon: "file-text", label: { en: "PDF · Word · PowerPoint", it: "PDF · Word · PowerPoint" } },
  { icon: "globe", label: { en: "Your website & news", it: "Sito e news" } },
];

// ── The eleven ───────────────────────────────────────────────────────────────
//
// One card per thing the assistant does for a brand user, in the words a sales associate
// would use for it. They map onto what is actually wired — the CRM query runner, knowledge
// search, visual search, visit notes, the events tables, shipping_estimate, generate_report,
// the document attachment and escalate_to_aion — so every card is a question the film could
// ask next. The three admin-only tools (charts, insurer exports, the monthly report) are not
// here because the viewer is being shown the floor, not the back office.
export const INTRO_AGENTS = [
  { icon: "users", en: ["Client intelligence", "Top clients, who buys what, who is due a visit."], it: ["Client intelligence", "Top client, chi compra cosa, chi è da richiamare."] },
  { icon: "gem", en: ["Product & craft", "Materials, making and care of every piece."], it: ["Prodotto e savoir-faire", "Materiali, lavorazione e cura di ogni pezzo."] },
  { icon: "image", en: ["Visual search", "A photo of a piece, and it names it."], it: ["Ricerca visiva", "La foto di un pezzo, e lo riconosce."] },
  { icon: "pen-line", en: ["Clienteling writer", "Messages and newsletters in the house's voice."], it: ["Clienteling writer", "Messaggi e newsletter con la voce della maison."] },
  { icon: "mic", en: ["Visit notes", "Say how a visit went; it is filed to the client."], it: ["Note di visita", "Racconta la visita a voce: finisce nella scheda cliente."] },
  { icon: "calendar-days", en: ["Event planner", "Trunk shows: whom to invite, what to bring."], it: ["Event planner", "Trunk show: chi invitare, cosa portare."] },
  { icon: "truck", en: ["Shipping & duties", "Freight, duty and VAT to any destination."], it: ["Spedizioni e dazi", "Trasporto, dazi e IVA verso ogni destinazione."] },
  { icon: "scroll-text", en: ["Policies & after-sales", "Returns, repairs and warranty, country by country."], it: ["Policy e after-sales", "Resi, riparazioni e garanzia, paese per paese."] },
  { icon: "file-spreadsheet", en: ["Reports", "Client and performance reports, ready to send."], it: ["Report", "Report cliente e performance, pronti da inviare."] },
  { icon: "file-text", en: ["Document reader", "Ask about any PDF, Excel or deck you attach."], it: ["Lettura documenti", "Domande su qualsiasi PDF, Excel o presentazione."] },
  { icon: "life-buoy", en: ["Ask AION", "Anything it cannot answer reaches a person."], it: ["Ask AION", "Ciò che non sa risolvere arriva a una persona."] },
];

// ── The chapters ─────────────────────────────────────────────────────────────
//
// A title for each kind of opening prompt, keyed on the lucide icon the prompt carries in
// the product (the recorder reads it off the button's class), so no second list has to be
// kept in step with buildSuggestions. An unknown kind is "Question N".
export const CHAPTERS = {
  "shopping-bag": { en: "The piece", it: "Il pezzo" },
  "sparkles": { en: "The look", it: "Il look" },
  "users": { en: "The clients", it: "I clienti" },
  "send": { en: "The newsletter", it: "La newsletter" },
  "scroll-text": { en: "The policy", it: "La policy" },
  "calendar-days": { en: "The trunk show", it: "Il trunk show" },
  "message-square-plus": { en: "The message", it: "Il messaggio" },
  "book-open": { en: "The house", it: "La maison" },
};

export const introCopy = (lang) => (lang === "it"
  ? {
    kicker0: "L'assistente di vendita in negozio",
    kicker1: "01 — I vostri dati",
    one: "Tutti i dati della maison, in un unico posto.",
    oneSub: "CRM, e-commerce, fogli di calcolo, canali, documenti, sito — l'assistente li legge tutti.",
    kicker2: "02 — Gli agenti",
    agents: "agenti specializzati.",
    agentsSub: "Ognuno addestrato su un lavoro preciso in negozio.",
    go: "Vediamolo in negozio.",
    question: (n) => `Domanda ${n}`,
    reading: "Sta leggendo i vostri dati",
    readingOf: ({ clients, covers, products }) => [clients && `${fmt(clients)} clienti`, covers && `${fmt(covers)} coperture`, products && `${fmt(products)} pezzi`].filter(Boolean).join(" · "),
    readingNoBook: "la knowledge base e il portafoglio clienti della maison",
    endLine: "Ogni risposta viene dai vostri dati.",
    endReady: "La vostra demo è pronta",
  }
  : {
    kicker0: "The in-store sales assistant",
    kicker1: "01 — Your data",
    one: "All your company data, in one place.",
    oneSub: "CRM, e-commerce, spreadsheets, channels, documents, website — the assistant reads them all.",
    kicker2: "02 — The agents",
    agents: "specialised agents.",
    agentsSub: "Each one trained on one job on the floor.",
    go: "Let's see it on the floor.",
    question: (n) => `Question ${n}`,
    reading: "Reading your data",
    readingOf: ({ clients, covers, products }) => [clients && `${fmt(clients)} clients`, covers && `${fmt(covers)} covers`, products && `${fmt(products)} pieces`].filter(Boolean).join(" · "),
    readingNoBook: "the house's knowledge base and client book",
    endLine: "Every answer came from your own data.",
    endReady: "Your demo is ready",
  });

const fmt = (n) => Number(n).toLocaleString("en-GB");

// Lucide (ISC) outlines, inlined so the overlay needs nothing from the page's bundle.
const LUCIDE = {
  "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "gem": '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  "image": '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  "mic": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  "truck": '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "calendar-days": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  "scroll-text": '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  "file-spreadsheet": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  "life-buoy": '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
  "sparkles": '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  "pen-line": '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  "globe": '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const lucide = (name, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[name] ?? ""}</svg>`;

/** A heading split into words, each in its own mask, so it can rise a word at a time. */
const words = (text) => text.split(" ").map((w) => `<span class="w"><span>${esc(w)}</span></span>`).join(" ");

/** One node on the ring: a tile with the mark, and the name beside it. */
function node(source, lang, i) {
  const label = typeof source.label === "string" ? source.label : source.label[lang] ?? source.label.en;
  let tile;
  if (source.slug && si[source.slug]) {
    const icon = si[source.slug];
    tile = `<span class="tile" style="color:#${icon.hex}"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="${icon.path}"/></svg></span>`;
  } else if (source.mark) {
    tile = `<span class="tile mark" style="background:#${source.hex}">${esc(source.mark)}</span>`;
  } else {
    tile = `<span class="tile line">${lucide(source.icon, 18)}</span>`;
  }
  return `<div class="node" data-i="${i}">${tile}<span class="name">${esc(label)}</span></div>`;
}

function card(agent, lang, n) {
  const [title, line] = agent[lang] ?? agent.en;
  return `<div class="card"><span class="ic">${lucide(agent.icon, 20)}</span><div class="body"><div class="t">${esc(title)}</div><div class="l">${esc(line)}</div></div><span class="num">${String(n).padStart(2, "0")}</span></div>`;
}

// A static grain: one SVG turbulence tile as a background image, drawn once by the
// compositor — not an animated filter, which would cost frames while the screencast runs.
const GRAIN = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .06 0"/></filter><rect width="220" height="220" filter="url(#n)"/></svg>',
);

/** The canvas every overlay shares: ink, cream type, the house's accent, a hairline. */
const CANVAS_CSS = (id) => `
#${id}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;
  background:#0d0b0a;color:#f3eee6;font-family:var(--body-font,"DM Sans",ui-sans-serif,system-ui,sans-serif);
  --cream:#f3eee6;--mute:rgba(243,238,230,.58);--hair:rgba(243,238,230,.12);--accent:var(--demo-accent,#CB9D4D);
  --serif:var(--heading-font,"Playfair Display",Georgia,serif)}
#${id} *{box-sizing:border-box;margin:0}
#${id} .bg{position:absolute;inset:0;background:
  radial-gradient(60% 50% at 50% 42%,color-mix(in srgb,var(--accent) 20%,transparent) 0%,transparent 70%),
  linear-gradient(180deg,#141110 0%,#0d0b0a 100%)}
#${id} .photo{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;will-change:transform;
  transform:scale(1.02);transition:opacity 1.4s ease,transform 9s linear}
#${id} .photo.on{opacity:.38;transform:scale(1.09)}
#${id} .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,11,10,.55),rgba(13,11,10,.78) 60%,#0d0b0a)}
#${id} .grain{position:absolute;inset:0;background:url("${GRAIN}") repeat;opacity:.35}
#${id} .vignette{position:absolute;inset:0;background:radial-gradient(90% 90% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%)}
#${id} .beat{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:56px 80px;opacity:0;transition:opacity .6s ease;will-change:opacity}
#${id} .beat.on{opacity:1}
#${id} .kicker{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--accent);opacity:0;transform:translateY(8px);
  transition:opacity .8s ease,transform .8s ease}
#${id} .in .kicker{opacity:1;transform:none}
#${id} h1{font-family:var(--serif);font-weight:400;font-size:58px;line-height:1.08;letter-spacing:-.005em;text-align:center;color:var(--cream);margin-top:18px}
#${id} h1 .w{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .06em}
#${id} h1 .w>span{display:inline-block;transform:translateY(110%);transition:transform .9s cubic-bezier(.2,.75,.2,1)}
#${id} .in h1 .w>span{transform:none}
#${id} .sub{margin-top:18px;font-size:18px;font-weight:300;color:var(--mute);text-align:center;max-width:960px;line-height:1.5;
  opacity:0;transform:translateY(10px);transition:opacity .9s ease .35s,transform .9s ease .35s}
#${id} .in .sub{opacity:1;transform:none}
#${id} .hair{height:1px;width:0;background:linear-gradient(90deg,transparent,var(--accent),transparent);transition:width 1.1s cubic-bezier(.2,.7,.2,1) .2s}
#${id} .in .hair{width:220px}
#${id} .mark0{font-family:var(--serif);font-size:96px;letter-spacing:.32em;padding-left:.32em;color:var(--cream);position:relative;
  opacity:0;transform:translateY(10px) scale(.985);transition:opacity 1.1s ease,transform 1.3s cubic-bezier(.2,.7,.2,1)}
#${id} .in .mark0{opacity:1;transform:none}
#${id} .mark0 .sheen{position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.95) 50%,transparent 65%);
  -webkit-background-clip:text;background-clip:text;color:transparent;background-size:260% 100%;background-position:120% 0}
#${id} .sweep .mark0 .sheen{animation:${id}-sheen 1.5s cubic-bezier(.4,0,.2,1) forwards}
@keyframes ${id}-sheen{from{background-position:120% 0}to{background-position:-40% 0}}
/* cream, and the house */
#${id} .cream{position:absolute;inset:0;background:#f7f4ee;color:#1c1917;display:flex;align-items:stretch;
  clip-path:circle(0% at 50% 50%);transition:clip-path 1.2s cubic-bezier(.65,0,.35,1)}
#${id} .cream.open{clip-path:circle(120% at 50% 50%)}
#${id} .cream .side{flex:0 0 44%;background-size:cover;background-position:center;opacity:0;transition:opacity 1.2s ease .4s}
#${id} .cream.open .side{opacity:1}
#${id} .cream .main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px}
#${id} .house{display:flex;align-items:center;gap:30px;opacity:0;transform:translateY(10px);transition:opacity .9s ease .5s,transform .9s ease .5s}
#${id} .cream.open .house{opacity:1;transform:none}
#${id} .house img{max-height:84px;max-width:300px;object-fit:contain}
#${id} .house .x{font-family:var(--serif);font-size:30px;color:rgba(28,25,23,.45)}
#${id} .house .aion{font-family:var(--serif);font-size:44px;letter-spacing:.26em;padding-left:.26em;color:#1c1917}
#${id} .cream .hair{margin-top:30px;transition-delay:.9s}
#${id} .cream.open .hair{width:200px}
#${id} .cream .go{margin-top:26px;font-size:20px;font-weight:300;color:rgba(28,25,23,.6);letter-spacing:.02em;text-align:center;
  opacity:0;transform:translateY(8px);transition:opacity .9s ease 1.1s,transform .9s ease 1.1s}
#${id} .cream.open .go{opacity:1;transform:none}
#${id} .cream .where{margin-top:10px;font-size:14px;letter-spacing:.08em;color:rgba(28,25,23,.5);opacity:0;transition:opacity .9s ease 1.4s}
#${id} .cream.open .where{opacity:1}
`;

const INTRO_CSS = `
/* beat 1: the ring */
#demo-intro .sky{position:relative;width:1180px;height:540px;margin-top:6px}
#demo-intro .sky svg.wires{position:absolute;inset:0;overflow:visible}
#demo-intro .sky .orbit{fill:none;stroke:var(--hair);stroke-width:1;opacity:0;transition:opacity 1.2s ease}
#demo-intro .sky.rings .orbit{opacity:1}
#demo-intro .node{position:absolute;display:flex;align-items:center;gap:10px;height:50px;padding:0 16px 0 6px;border-radius:999px;
  border:1px solid var(--hair);background:#1a1614;
  opacity:0;transform:translate(-50%,-50%) scale(.85);transition:opacity .6s ease,transform .7s cubic-bezier(.2,.7,.2,1);will-change:transform,opacity}
#demo-intro .node.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
#demo-intro .node.go{transition:opacity .7s ease,transform .9s cubic-bezier(.65,0,.35,1)}
#demo-intro .tile{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:#f7f3ec;flex:none}
#demo-intro .tile.mark{color:#fff;font-weight:700;font-size:14px;letter-spacing:-.02em}
#demo-intro .tile.line{background:rgba(255,255,255,.1);color:var(--cream)}
#demo-intro .name{font-size:14px;font-weight:500;color:var(--cream);white-space:nowrap;letter-spacing:.01em}
#demo-intro .core{position:absolute;left:50%;top:50%;width:120px;height:120px;transform:translate(-50%,-50%) scale(.5);border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);
  background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--accent) 22%,#121010),#0d0b0a 72%);opacity:0;
  transition:opacity .6s ease,transform .8s cubic-bezier(.2,.7,.2,1)}
#demo-intro .core.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
#demo-intro .core svg{width:46px;height:46px}
#demo-intro .core::after{content:"";position:absolute;inset:-1px;border-radius:50%;border:1px solid var(--accent);opacity:0}
#demo-intro .core.pulse::after{animation:demo-intro-pulse 1.6s ease-out 2}
@keyframes demo-intro-pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.6);opacity:0}}
/* beat 2: the eleven */
#demo-intro h1 .count{display:inline-block;min-width:1.25em;text-align:right;color:var(--accent);font-variant-numeric:tabular-nums}
#demo-intro .grid{position:relative;margin-top:40px;display:flex;flex-wrap:wrap;justify-content:center;gap:12px;max-width:1260px;overflow:hidden;padding:4px}
#demo-intro .card{position:relative;display:flex;align-items:flex-start;gap:14px;width:300px;padding:16px 16px 16px 14px;border-radius:14px;
  border:1px solid var(--hair);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));
  clip-path:inset(100% 0 0 0 round 14px);transform:translateY(16px);transition:clip-path .75s cubic-bezier(.2,.7,.2,1),transform .75s cubic-bezier(.2,.7,.2,1)}
#demo-intro .card.on{clip-path:inset(0 0 0 0 round 14px);transform:none}
#demo-intro .card .ic{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;flex:none;
  background:color-mix(in srgb,var(--accent) 16%,transparent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);color:var(--accent)}
#demo-intro .card .t{font-family:var(--serif);font-size:18px;color:var(--cream);line-height:1.2}
#demo-intro .card .l{margin-top:5px;font-size:13px;font-weight:300;color:var(--mute);line-height:1.45}
#demo-intro .card .num{position:absolute;right:14px;top:12px;font-size:10.5px;letter-spacing:.2em;color:var(--mute)}
#demo-intro .grid .light{position:absolute;top:-20%;bottom:-20%;left:0;width:34%;transform:translateX(-140%) skewX(-18deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.085),transparent);pointer-events:none}
#demo-intro .grid.sweep .light{animation:demo-intro-light 1.4s cubic-bezier(.4,0,.2,1) forwards}
@keyframes demo-intro-light{to{transform:translateX(420%) skewX(-18deg)}}
`;

const CHAPTER_CSS = `
#demo-chapter .num{font-family:var(--serif);font-size:150px;line-height:1;color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:-.02em;
  opacity:0;transform:translateY(14px);transition:opacity .7s ease,transform .9s cubic-bezier(.2,.75,.2,1)}
#demo-chapter .in .num{opacity:1;transform:none}
#demo-chapter h1{margin-top:6px;font-size:54px}
#demo-chapter .hair{margin-top:26px}
`;

const READING_CSS = `
#demo-reading{position:fixed;right:28px;bottom:112px;z-index:2147483645;pointer-events:none;
  font-family:var(--body-font,"DM Sans",ui-sans-serif,system-ui,sans-serif);
  --accent:var(--demo-accent,#CB9D4D);
  background:#141110;color:#f3eee6;border:1px solid rgba(243,238,230,.12);border-radius:14px;padding:14px 18px 16px;min-width:300px;
  box-shadow:0 18px 50px rgba(0,0,0,.28);opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease}
#demo-reading.on{opacity:1;transform:none}
#demo-reading *{margin:0}
#demo-reading .k{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--accent)}
#demo-reading .of{margin-top:6px;font-size:15px;color:rgba(243,238,230,.85)}
#demo-reading .bar{position:relative;margin-top:12px;height:1px;background:rgba(243,238,230,.12);overflow:hidden}
#demo-reading .bar i{position:absolute;top:0;bottom:0;left:0;width:36%;background:var(--accent);animation:demo-reading-slide 2.4s ease-in-out infinite}
@keyframes demo-reading-slide{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}
`;

const ENDING_CSS = `
#demo-ending h1{font-size:54px}
`;

const canvas = (photo) => `<div class="bg"></div>${photo ? `<div class="photo" style="background-image:url('${esc(photo)}')"></div><div class="shade"></div>` : ""}<div class="grain"></div><div class="vignette"></div>`;

/**
 * In-page: mount an overlay root with the house's accent read off the page (TenantContext's
 * --primary, lifted so it reads on ink), its styles and markup, and the fonts waited for so
 * the first title is not drawn in a fallback face and swapped on camera. Passed to
 * page.evaluate as a function — Playwright serialises it — so nothing is evaluated from a
 * string, which a Content-Security-Policy would be right to refuse.
 */
async function mountInPage({ id, css, html }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById(id)?.remove();
  const root = document.createElement("div");
  root.id = id;
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (primary) {
    const m = primary.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
    root.style.setProperty("--demo-accent", m
      ? `hsl(${m[1]} ${Math.max(Number(m[2]), 28)}% ${Math.max(Number(m[3]), 58)}%)`
      : primary.includes("(") ? primary : `hsl(${primary})`);
  }
  root.innerHTML = `<style>${css}</style>${html}`;
  document.body.appendChild(root);
  try { await Promise.race([document.fonts.ready, sleep(1500)]); } catch { /* fine */ }
  await sleep(60);
}

/**
 * Play the intro over whatever page is showing. Resolves when the overlay has dissolved.
 *
 * @param page  Playwright page, already on the brand's login with its photos drawn.
 * @param film  on-film ms → real ms (the recorder's own).
 * @param lang  "en" | "it".
 * @param brand the house's name, for the last beat.
 * @param logoUrl the house's logo as the login shows it; the name is set in type if none.
 * @param photoUrl the house's photograph (the login's own), behind the mark and beside the logo.
 */
export async function playIntro(page, { film, lang = "en", brand = "", logoUrl = "", photoUrl = "" }) {
  const copy = introCopy(lang);
  const html = `
    ${canvas(photoUrl)}
    <section class="beat" data-beat="0">
      <div class="mark0">AION<span class="sheen" aria-hidden="true">AION</span></div>
      <div class="hair" style="margin-top:28px"></div>
      <p class="kicker" style="margin-top:22px">${esc(copy.kicker0)}</p>
    </section>
    <section class="beat" data-beat="1">
      <p class="kicker">${esc(copy.kicker1)}</p>
      <h1>${words(copy.one)}</h1>
      <p class="sub">${esc(copy.oneSub)}</p>
      <div class="sky">
        <svg class="wires" viewBox="0 0 1180 540" width="1180" height="540">
          <ellipse class="orbit" cx="590" cy="270" rx="500" ry="215"/>
        </svg>
        ${INTRO_SOURCES.map((s, i) => node(s, lang, i)).join("")}
        <div class="core">${lucide("sparkles", 46)}</div>
      </div>
    </section>
    <section class="beat" data-beat="2">
      <p class="kicker">${esc(copy.kicker2)}</p>
      <h1><span class="w"><span><span class="count">0</span> ${esc(copy.agents)}</span></span></h1>
      <p class="sub">${esc(copy.agentsSub)}</p>
      <div class="grid"><span class="light"></span>${INTRO_AGENTS.map((a, i) => card(a, lang, i + 1)).join("")}</div>
    </section>
    <div class="cream">
      ${photoUrl ? `<div class="side" style="background-image:url('${esc(photoUrl)}')"></div>` : ""}
      <div class="main">
        <div class="house">
          ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(brand)}">` : `<span class="aion" style="letter-spacing:.02em;padding:0">${esc(brand)}</span>`}
          <span class="x">×</span><span class="aion">AION</span>
        </div>
        <div class="hair"></div>
        <p class="go">${esc(copy.go)}</p>
      </div>
    </div>`;

  const ID = "demo-intro", CSS_ = CANVAS_CSS(ID) + INTRO_CSS;
  // About sixteen seconds on film in all: titles that run longer than that are a wait before
  // the product, and the product is the point.
  const t = {
    markIn: film(1200), markHold: film(900),
    headIn: film(900),
    ringsIn: film(450), nodeEvery: film(110), skyHold: film(1100),
    converge: film(850), coreHold: film(1100),
    countUp: film(900), cardEvery: film(80), gridHold: film(1300), sweepHold: film(1000),
    creamOpen: film(1100), houseHold: film(2000),
    fade: film(650), gap: film(350),
  };

  await page.evaluate(mountInPage, { id: ID, css: CSS_, html });
  await page.evaluate(async ({ id, t }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.getElementById(id);
    const beats = [...root.querySelectorAll(".beat")];
    const photo = root.querySelector(".photo");
    const show = async (i, ms) => { beats[i].classList.add("on"); await sleep(90); beats[i].classList.add("in"); await sleep(ms); };
    const hide = async (i) => { beats[i].classList.remove("on"); await sleep(t.gap); };

    // ── 0. the mark, over the house's photograph ──
    if (photo) photo.classList.add("on");
    await show(0, t.markIn * 0.5);
    beats[0].classList.add("sweep");
    await sleep(t.markIn * 0.5 + t.markHold);
    if (photo) photo.classList.remove("on");
    await hide(0);

    // ── 1. the ring ──
    await show(1, t.headIn);
    const sky = beats[1].querySelector(".sky");
    const nodes = [...sky.querySelectorAll(".node")];
    const W = 1180, H = 540, cx = W / 2, cy = H / 2, RX = 500, RY = 215;
    const placed = nodes.map((n, k) => {
      const a = (k / nodes.length) * Math.PI * 2 - Math.PI / 2;
      const x = cx + RX * Math.cos(a), y = cy + RY * Math.sin(a);
      n.style.left = `${x}px`; n.style.top = `${y}px`;
      return { n, x, y };
    });
    sky.classList.add("rings");
    await sleep(t.ringsIn);
    for (const p of placed) { p.n.classList.add("on"); await sleep(t.nodeEvery); }
    await sleep(t.skyHold);
    for (const p of placed) {
      p.n.classList.add("go");
      p.n.style.transform = `translate(calc(-50% + ${cx - p.x}px), calc(-50% + ${cy - p.y}px)) scale(.25)`;
      p.n.style.opacity = "0";
    }
    await sleep(t.converge * 0.85);
    const core = sky.querySelector(".core");
    core.classList.add("on");
    await sleep(200);
    core.classList.add("pulse");
    await sleep(t.coreHold);
    await hide(1);

    // ── 2. the eleven ──
    await show(2, t.headIn * 0.6);
    const count = beats[2].querySelector(".count");
    const n0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - n0) / t.countUp);
        count.textContent = String(Math.round((1 - Math.pow(1 - k, 3)) * 11));
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    for (const c of beats[2].querySelectorAll(".card")) { c.classList.add("on"); await sleep(t.cardEvery); }
    await sleep(t.gridHold);
    beats[2].querySelector(".grid").classList.add("sweep");
    await sleep(t.sweepHold);

    // ── 3. cream, the house, and the product ──
    root.querySelector(".cream").classList.add("open");
    await sleep(t.creamOpen + t.houseHold);
    root.style.transition = `opacity ${t.fade}ms ease`;
    root.style.opacity = "0";
    await sleep(t.fade + 80);
    root.remove();
  }, { id: ID, t });
}

/**
 * A chapter card before a question: a large numeral in the accent, the title, a hairline.
 * Returns once it has dissolved; the product underneath is untouched.
 */
export async function playChapter(page, { film, lang = "en", index, kind = "" }) {
  const copy = introCopy(lang);
  const title = CHAPTERS[kind]?.[lang] ?? CHAPTERS[kind]?.en ?? copy.question(index);
  const html = `
    ${canvas("")}
    <section class="beat">
      <div class="num">${String(index).padStart(2, "0")}</div>
      <h1>${words(title)}</h1>
      <div class="hair"></div>
    </section>`;
  const ID = "demo-chapter", CSS_ = CANVAS_CSS(ID) + CHAPTER_CSS;
  const t = { hold: film(1300), fade: film(450) };
  await page.evaluate(mountInPage, { id: ID, css: CSS_, html });
  await page.evaluate(async ({ id, t }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.getElementById(id);
    const beat = root.querySelector(".beat");
    root.style.transition = `opacity ${t.fade}ms ease`;
    beat.classList.add("on"); await sleep(90); beat.classList.add("in");
    await sleep(t.hold);
    root.style.opacity = "0";
    await sleep(t.fade + 60);
    root.remove();
  }, { id: ID, t });
}

/**
 * The small card that sits beside the composer while an answer streams. `book` is
 * demo_login's { clients, covers, products }, or null when the recorder was not told.
 */
export async function showReading(page, { lang = "en", book = null }) {
  const copy = introCopy(lang);
  const of = book && (book.clients || book.covers || book.products) ? copy.readingOf(book) : copy.readingNoBook;
  const html = `<p class="k">${esc(copy.reading)}</p><p class="of">${esc(of)}</p><div class="bar"><i></i></div>`;
  await page.evaluate(mountInPage, { id: "demo-reading", css: READING_CSS, html }).catch(() => {});
  await page.evaluate(() => {
    const root = document.getElementById("demo-reading");
    requestAnimationFrame(() => root?.classList.add("on"));
  }).catch(() => {});
}

export async function hideReading(page, { film }) {
  await page.evaluate(async (ms) => {
    const el = document.getElementById("demo-reading");
    if (!el) return;
    el.classList.remove("on");
    await new Promise((r) => setTimeout(r, ms));
    el.remove();
  }, film(450)).catch(() => {});
}

/**
 * The close. One line on ink, then cream with the house's photograph and mark, and where
 * its demo is waiting. The film ends on this; nothing dissolves back to the product.
 */
export async function playEnding(page, { film, lang = "en", brand = "", logoUrl = "", photoUrl = "", where = "" }) {
  const copy = introCopy(lang);
  const html = `
    ${canvas("")}
    <section class="beat">
      <h1>${words(copy.endLine)}</h1>
      <div class="hair" style="margin-top:28px"></div>
    </section>
    <div class="cream">
      ${photoUrl ? `<div class="side" style="background-image:url('${esc(photoUrl)}')"></div>` : ""}
      <div class="main">
        <div class="house">
          ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(brand)}">` : `<span class="aion" style="letter-spacing:.02em;padding:0">${esc(brand)}</span>`}
          <span class="x">×</span><span class="aion">AION</span>
        </div>
        <div class="hair"></div>
        <p class="go">${esc(copy.endReady)}</p>
        ${where ? `<p class="where">${esc(where)}</p>` : ""}
      </div>
    </div>`;
  const ID = "demo-ending", CSS_ = CANVAS_CSS(ID) + ENDING_CSS;
  const t = { lineIn: film(900), lineHold: film(1700), creamOpen: film(1100), houseHold: film(2600) };
  await page.evaluate(mountInPage, { id: ID, css: CSS_, html });
  await page.evaluate(async ({ id, t }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.getElementById(id);
    const beat = root.querySelector(".beat");
    beat.classList.add("on"); await sleep(90); beat.classList.add("in");
    await sleep(t.lineIn + t.lineHold);
    root.querySelector(".cream").classList.add("open");
    await sleep(t.creamOpen + t.houseHold);
  }, { id: ID, t });
}
