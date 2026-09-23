// The operations booklet, as content rather than as a PDF somebody re-types per house.
//
// "For the operations deck I'd use the booklet. If we can build a slightly graphic deck,
// better; otherwise the booklet updated with the brand target is fine."
//
// What shipped before was seven slides of bullets that SUMMARISED the booklet, and the
// summary is where all the operating detail lives: the fourteen steps of activation, the
// twelve of a claim, the insurer's SLAs, who sends which email and when, and the month-end
// money. A brand's operations team cannot work from "Apertura e gestione dei sinistri —
// AION verifica la completezza della documentazione".
//
// So the booklet itself is the content, section for section, with two tokens in it: the
// house's legal entity and the name its own people use. Nothing here is invented and nothing
// is softened — these are the approved terms, and where the booklet names a figure (2 working
// days, ~10 working days, 15 working days, the 15th, the 20th) the figure is carried across
// so the house is told the same thing in writing that it was told in the room.
//
// Italian, like the booklet. These meetings are held in Italian and the document that follows
// them is in Italian; an English translation of an approved Italian text is a different
// document with different words in it, and nobody has approved that one.

/**
 * A slide, in the shapes the renderer knows how to draw.
 *
 * `eyebrow` is the section a slide belongs to, set on every slide that is NOT the one opening
 * its section. Those slides — the four actors, the SLA table, the voucher flow — carried no
 * section context at all, so a reader landing on one had no way of knowing whether they were
 * in claims or in invoicing. It is the device the reference ops deck uses on every page, and
 * it costs a line of small type at the top of the slide.
 */
export type Slide =
  | { kind: "section"; number: string; title: string; lead?: string; eyebrow?: string;
      /** The house, set under the title on the cover — the "× Brand" half of the lockup. */
      sub?: string }
  | { kind: "bullets"; title: string; lead?: string; eyebrow?: string; bullets: string[] }
  | {
      /** The whole programme as one row of chevrons: the deck's contents, drawn. */
      kind: "flow"; title: string; lead?: string; eyebrow?: string; items: string[];
    }
  | {
      kind: "steps"; title: string; lead?: string; eyebrow?: string; steps: string[];
      /**
       * The number the first step on this slide carries.
       *
       * A flow of fourteen steps does not fit on one slide, so it is cut in two — and the
       * second half was drawn starting at 1 again, which says there are two flows of eight
       * and six rather than one of fourteen. "Slide 4 should be 2/2 and the numbers should
       * start at 9."
       */
      start?: number;
      /** "2 of 2", for a flow that runs over more than one slide. */
      part?: { of: number; index: number };
    }
  | { kind: "table"; title: string; lead?: string; eyebrow?: string; head: string[]; rows: string[][] }
  | { kind: "callout"; title: string; label: string; body: string; eyebrow?: string };

export type BookletParams = {
  /** The entity the programme is contracted with — "Salvatore Ferragamo SpA". */
  legalName: string;
  /** What its own people call it, as it appears in a process line — "FERRAGAMO". */
  shortName: string;
};

/**
 * The booklet's six sections, in order, named once.
 *
 * The section headings used to be typed into each slide's title, which is how the deck ended
 * up with slides that belong to a section and never say so. Now the list is the source: a
 * heading is `section(n)`, a continuation slide's eyebrow is `section(n)`, and the contents
 * slide is the same six strings drawn as a row. Renumbering a section cannot leave one of
 * the three behind.
 */
const SECTIONS = [
  "Panoramica del servizio",
  "Attivazione della polizza",
  "Apertura e gestione dei sinistri",
  "Sostituzione del prodotto — voucher",
  "Comunicazioni con il cliente",
  "Ciclo attivo / passivo",
];
const section = (n: number) => `${n}. ${SECTIONS[n - 1]}`;

/**
 * The booklet for one house.
 *
 * Two names, because the booklet uses two: the legal entity where it is talking about a
 * contract or a payment, and the short name where it is talking about who does something.
 * Passing one for both reads wrong in half the document, which is why the caller is made to
 * supply both rather than this guessing at a short form.
 */
export function opsBooklet({ legalName, shortName }: BookletParams): Slide[] {
  const L = legalName.trim() || "il Brand";
  const B = (shortName.trim() || legalName.trim() || "IL BRAND").toUpperCase();

  return [
    {
      // Stacked, not run together on one line. "AION Cover × Salvatore Ferragamo SpA" set as
      // a single heading is a 46-character line that has to be shrunk to fit, and the house
      // ends up the same size and weight as our own name. The reference deck sets the mark,
      // then what the document is, then the house in caps underneath — which is the order a
      // cover is read in, and it lets the house's name be as long as it is.
      kind: "section", number: "", title: "AION Cover", sub: L,
      lead: "Servizio di copertura assicurativa — presentazione del programma operativo. " +
        "Un servizio esclusivo che protegge i prodotti dei vostri clienti attraverso una " +
        "soluzione assicurativa completa, gestita interamente sulla piattaforma AION.",
    },

    // The whole programme on one page, before any of it is explained. Fourteen slides of
    // flows, tables and SLAs with no contents page in front of them is a document you can
    // only read in order, and an operations meeting never runs in order — somebody asks
    // about invoicing on slide two. The six chevrons are the six sections, so this cannot
    // drift away from what follows it.
    {
      kind: "flow", title: "Il programma operativo in sei sezioni",
      lead: `Dalla panoramica del servizio al ciclo attivo e passivo: come funziona il programma ` +
        `di copertura tra ${L}, AION e la compagnia assicurativa.`,
      items: SECTIONS,
    },

    // ── 1 ────────────────────────────────────────────────────────────────────
    {
      kind: "bullets", title: section(1),
      lead:
        `AION Cover offre un servizio di copertura assicurativa integrato che protegge i prodotti ` +
        `acquistati dai clienti finali di ${L} (e delle sue controllate) contro furto e danni ` +
        `accidentali. Il modello adottato è un CLIP (Contractual Liability Insurance Policy), che ` +
        `copre le perdite finanziarie di ${L} e garantisce ai clienti il diritto alla riparazione ` +
        `e/o sostituzione del prodotto in determinate circostanze.`,
      bullets: [
        "Semplicità di attivazione per il cliente finale",
        "Gestione centralizzata su piattaforma white-label AION",
        "Conformità alle normative assicurative e GDPR",
        "Processi chiari e trasparenti per la gestione dei sinistri",
      ],
    },
    {
      kind: "table", title: "I quattro attori del sistema", eyebrow: section(1),
      head: ["Attore", "Responsabilità principali"],
      rows: [
        ["Compagnia assicurativa (Chubb)",
          "Definisce i termini e le condizioni della polizza CLIP · Stabilisce i campi obbligatori del bordereau coperture e sinistri · Analizza e approva/rigetta i sinistri · Emette fattura al Brand entro il 15 del mese successivo"],
        [B,
          `Racconta il servizio al cliente al momento dell'acquisto · Raccoglie e condivide i dati del cliente e del prodotto con AION (il brand è titolare del trattamento dati) · Gestisce la comunicazione diretta con il cliente`],
        ["AION Cover",
          "Crea e gestisce il servizio di copertura sulla piattaforma · Verifica la completezza dei dati dei sinistri · Condivide il bordereau con la compagnia assicurativa · Fornisce raccomandazioni al Brand su ogni sinistro e in caso di domande sul programma"],
        ["Cliente finale",
          `Condivide i dati di contatto con ${B} · Si registra e attiva l'account sulla piattaforma AION · Apre eventuali sinistri tramite la piattaforma · Fornisce documentazione aggiuntiva se richiesta`],
      ],
    },

    // ── 2 ────────────────────────────────────────────────────────────────────
    {
      kind: "steps", title: section(2),
      part: { index: 1, of: 2 },
      lead: "Il processo di registrazione del cliente e attivazione della copertura assicurativa è il punto di partenza del servizio.",
      steps: [
        "Chubb e AION concordano i campi obbligatori dei bordereaux vendite e sinistri",
        `${B} propone il servizio di copertura durante / dopo la vendita`,
        "Il cliente fornisce i propri dati di contatto",
        `${B} registra i dati del cliente e processa la vendita`,
        `${B} condivide dati prodotto e dati cliente con AION (via integrazione API)`,
        "AION crea il servizio di copertura sulla piattaforma (via integrazione API)",
        "AION condivide la creazione della copertura con il cliente via email",
        "Il cliente apre il link e si registra con la stessa email fornita in negozio",
      ],
    },
    {
      // Same title as the slide before it, because it is the same flow: the badge and the
      // ninth step say where the reader is, and "— dal nono passo" in a heading was the
      // renderer's job being done in the copy.
      kind: "steps", title: section(2),
      part: { index: 2, of: 2 }, start: 9,
      steps: [
        "AION invia una email di verifica dell'indirizzo email",
        "Il cliente apre la email e attiva il proprio account",
        "AION condivide quotidianamente con la compagnia assicurativa la lista degli item assicurati via integrazione",
        "La compagnia assicurativa emette ad AION estratto conto mensile entro il 15 del mese successivo",
        `AION invia a ${B} l'avviso di pagamento entro il 20 dello stesso mese`,
        `${B} paga l'avviso di pagamento entro la fine del mese ad AION, che trattiene la quota broker e trasferisce la differenza alla compagnia`,
      ],
    },

    // ── 3 ────────────────────────────────────────────────────────────────────
    {
      kind: "steps", title: section(3),
      part: { index: 1, of: 2 },
      lead:
        `Il cliente può aprire un sinistro per furto o danno accidentale di un prodotto assicurato. ` +
        `${B} gestisce la relazione con il cliente in modo diretto, supportato dalla piattaforma AION ` +
        `e dalle linee guida della compagnia. Si suggerisce di pensare al processo in modo speculare a ` +
        `quello per riparazione / sostituzione di un prodotto con danno di fabbrica (Garanzia Legale).`,
      steps: [
        "Il cliente accede alla piattaforma AION e apre un sinistro compilando il modulo (furto o danno accidentale)",
        "AION verifica il sinistro e controlla che tutti i dati richiesti siano presenti",
        `Se i dati sono incompleti: AION informa ${B} entro 2 giorni lavorativi, che contatta il cliente per le informazioni mancanti`,
        "Se i dati sono completi: AION registra i dati nel bordereau sinistri e li condivide con la compagnia",
        "La compagnia analizza il sinistro entro circa 10 giorni lavorativi e condivide il feedback con AION",
        `AION condivide il feedback della compagnia con ${B}`,
      ],
    },
    {
      kind: "steps", title: section(3),
      part: { index: 2, of: 2 }, start: 7,
      steps: [
        `${B} approva o rigetta il sinistro`,
        "Il cliente riceve una risposta sul sinistro via email entro 15 giorni lavorativi dall'apertura",
        "Se approvato: il cliente riceve le istruzioni per la riparazione o sostituzione (ritiro del nuovo prodotto o voucher)",
        "Se rigettato: il cliente riceve la spiegazione della motivazione del rigetto",
        "Se servono informazioni aggiuntive: il cliente può caricarle sulla piattaforma o inviarle via email",
        `${B} / AION aggiorna lo stato del sinistro sulla piattaforma dopo la decisione finale`,
      ],
    },
    {
      kind: "table", title: "SLA — tempi di risposta della compagnia assicurativa", eyebrow: section(3),
      head: ["Metrica", "SLA"],
      rows: [
        ["Presa in carico (acknowledgement)", "100% entro 5 giorni lavorativi"],
        ["Risposta alla corrispondenza", "85% entro 5 giorni lavorativi, 100% entro 10 giorni lavorativi"],
        ["Erogazione del pagamento", "100% entro 5 giorni lavorativi dall'approvazione"],
      ],
    },
    {
      kind: "callout", title: "Recupero del prodotto danneggiato", eyebrow: section(3),
      label: "Attenzione — obbligo di recupero",
      body:
        `Il recupero del prodotto danneggiato è obbligatorio per ${B} al fine di ottenere il pagamento ` +
        `del sinistro. AION richiederà la bolla di spedizione a ${L} come prova del recupero avvenuto.`,
    },

    // ── 4 ────────────────────────────────────────────────────────────────────
    {
      kind: "bullets", title: section(4),
      lead:
        "In caso di sinistro approvato, la sostituzione del prodotto avviene tramite l'emissione di un " +
        "voucher. Soluzione suggerita per aumentare il traffico in negozio e sostituire prodotti fuori " +
        "produzione, alternativa alla semplice sostituzione del prodotto.",
      bullets: [
        "Codice alfanumerico univoco e nominale per il beneficiario",
        "Utilizzabile su uno o più SKU nei punti vendita concordati",
        "Durata: 6 mesi o 1 anno dalla data di emissione",
        "Valore pari al prezzo retail del prodotto acquistato originariamente",
      ],
    },
    {
      kind: "steps", title: "Flusso operativo — emissione voucher", eyebrow: section(4),
      steps: [
        "La compagnia assicurativa (Chubb) approva il sinistro",
        `AION comunica l'approvazione a ${L}`,
        `Il team di ${L} crea il voucher tramite la piattaforma dedicata (es. Vouchery.io o sistema interno)`,
        "Il voucher viene condiviso con il cliente insieme alle istruzioni per l'utilizzo (canali abilitati, durata, documento d'identità richiesto)",
        "Il cliente utilizza il voucher nel canale di riferimento indicato",
      ],
    },
    {
      kind: "callout", title: "Valore del voucher", eyebrow: section(4),
      label: "Valore voucher = prezzo retail del prodotto",
      body:
        `Il valore del voucher corrisponde al prezzo retail del prodotto acquistato originariamente. Il ` +
        `cliente prende il prodotto sostitutivo, che avrà un costo azienda pari ai COGS % per il prezzo ` +
        `retail del prodotto. ${L} riceve un rimborso pari ai COGS % per il prezzo retail del prodotto ` +
        `sostituito. Ciò garantisce un flusso a somma zero con il valore rimborsato dalla compagnia.`,
    },

    // ── 5 ────────────────────────────────────────────────────────────────────
    {
      kind: "table", title: section(5),
      lead:
        `Tutte le comunicazioni con il cliente sono gestite dal team di ${L}, che mantiene il contatto ` +
        `diretto lungo tutto il ciclo di vita del servizio. AION invia esclusivamente l'invito alla ` +
        `piattaforma, la conferma email e la conferma di ricezione del sinistro.`,
      head: ["Comunicazione", "Mittente", "Trigger / timing"],
      rows: [
        ["Invito alla piattaforma AION", "AION (team@aioncover.com)", "Subito dopo l'attivazione in negozio"],
        ["Verifica indirizzo email", "AION (team@aioncover.com)", "All'atto della registrazione del cliente sulla piattaforma"],
        ["Conferma apertura sinistro", "AION (team@aioncover.com)", "Al ricevimento del sinistro aperto dal cliente"],
        ["Sinistro approvato", L, "Dopo la decisione di approvazione del sinistro"],
        ["Sinistro rigettato", L, "Dopo la decisione di rigetto, con motivazione dettagliata"],
        ["Richiesta informazioni aggiuntive", L, "Se la documentazione fornita è incompleta"],
      ],
    },

    // ── 6 ────────────────────────────────────────────────────────────────────
    {
      kind: "table", title: section(6),
      lead: "Dettaglio finanziario del programma.",
      head: ["Premi assicurativi", "Rimborso sinistri"],
      rows: [[
        `Entro il 15 del mese successivo, Chubb emette estratto conto per tutti i prodotti registrati nel ` +
        `mese precedente, condivisi tramite tracciato da AION Insurance. Il Brand paga entro fine mese ad ` +
        `AION Insurance Srls, che trattiene la quota broker e trasferisce la differenza a Chubb.`,
        `In caso di accettazione, in 5 giorni la compagnia emette un rimborso a ${L}.`,
      ]],
    },
  ];
}
