// ==============================|| GO-LIVE CHECKLIST ||============================== //
// What has to be true before a brand can issue a real cover.
//
// The list lives in code, not in the database: it evolves with the platform, and a brand
// added last year should pick up an item added last week rather than being stuck with the
// list as it stood the day it was created. Only the *state* is stored, per brand, in
// `brand_golive_checklist` — an item with no row has simply not been touched.
//
// It runs from the first meeting to the launch, not only the technical set-up: the contracts,
// the commercial cycle, finance and claims are what a launch actually waits on, and they
// lived in a spreadsheet next to this list that nobody on the platform could see.
//
// The groups are ordered the way the work is usually sequenced, but nothing gates anything:
// the insurer quotation runs for weeks in the background while configuration proceeds, and
// items genuinely get closed out of order.
//
// Every item also says how much engineering it takes (`tech`), and the screen filters on it:
// the few items that need a developer for days are the ones that set the launch date.
//
// `blocking: true` means the first real cover cannot be issued until it is done. Everything
// else can trail the launch.

/**
 * How much engineering an item takes — the axis the list is filtered on, because it decides
 * WHO can close it. A launch is mostly contracts, meetings and review; the handful of items
 * that need a developer for days are the ones that set the date, and they were invisible in
 * a list sorted by subject.
 *
 * - `heavy`: development, integration with the house's IT, or work on production.
 * - `config`: needs somebody technical, but it is configuration — SQL, a flag, a credential,
 *   checking a file. Hours, not days.
 * - `none`: commercial, legal, operations, or a click in the admin anyone can make.
 */
export type TechLoad = "heavy" | "config" | "none";

export const TECH_LOADS: Record<TechLoad, { label: string; hint: string }> = {
  heavy: { label: "Tech heavy", hint: "Development, integration with the house's IT, or work on production" },
  config: { label: "Tech config", hint: "Needs somebody technical, but it is configuration: SQL, a flag, a credential" },
  none: { label: "Non-tech", hint: "Commercial, legal, operations, or a click in the admin" },
};

export type ChecklistItem = {
  /** Stable across edits to the label — it is the primary key in the database. */
  key: string;
  title: string;
  detail: string;
  blocking?: boolean;
  tech: TechLoad;
  /**
   * What the platform looks at to decide this item is done, in words.
   *
   * An item with `evidence` is answered by `brand_golive_signals` (see
   * 20260912000003_golive_signals.sql) and ticks itself: asking a person to confirm that a
   * number they can see on the record is set is asking them to copy the database onto a
   * form, and the form then disagrees with the data the moment anything changes.
   *
   * An item WITHOUT it is work no query can see — a conversation with the insurer, a
   * training session, a runbook — and stays a human tick.
   */
  evidence?: string;
};

export type ChecklistGroup = {
  key: string;
  /** Short marker shown down the left of the list. */
  letter: string;
  title: string;
  items: ChecklistItem[];
};

export const GO_LIVE_CHECKLIST: ChecklistGroup[] = [
  {
    // The five meetings of the commercial cycle, and the two approvals they lead to. The
    // steps tick themselves from the Commercial cycle tab, so a meeting is recorded once.
    key: "commercial",
    letter: "A",
    title: "Commercial cycle",
    items: [
      {
        key: "onboarding_run",
        title: "Create the brand and let onboarding run",
        detail: "Name, website and portal address, and Kind = prospect for a house that has not signed. Ten stages then run on their own — branding, crawl, catalogue, decks, demo book, assistant — and settle within the hour. A site behind a bot challenge gives no catalogue, and those parts are filled by hand.",
        tech: "config",
        evidence: "every onboarding stage has run and come to rest",
      },
      {
        key: "intro_meeting",
        title: "Hold the first meeting",
        detail: "Commercial cycle step 1. The teaser deck is built for it, rebranded with the house's own pieces.",
        tech: "none",
        evidence: "step 1 of the commercial cycle is marked done",
      },
      {
        key: "nda",
        title: "Sign the NDA",
        detail: "Before the house shares any figures for the data request.",
        tech: "none",
      },
      {
        key: "data_request",
        title: "Send the data request",
        detail: "Commercial cycle step 2. One segment per category in the product focus, so check that field before building; a workbook carrying any typed number is refused.",
        tech: "none",
        evidence: "step 2 of the commercial cycle is marked done",
      },
      {
        key: "platform_demo",
        title: "Run the platform demo",
        detail: "Commercial cycle step 3. The demo book and the logins for both portals come from onboarding, for prospects only; the film is recorded from the brand page.",
        tech: "none",
        evidence: "step 3 of the commercial cycle is marked done",
      },
      {
        key: "pricing_case",
        title: "Build the business case",
        detail: "Commercial cycle step 4, on the quotes on file. It refuses a category with no quote, and has to be rebuilt once the formal quotation lands.",
        tech: "none",
        evidence: "step 4 of the commercial cycle is marked done",
      },
      {
        key: "ops_review",
        title: "Hold the operations review",
        detail: "Commercial cycle step 5. The ops deck is also the starting material for training the sales network.",
        tech: "none",
        evidence: "step 5 of the commercial cycle is marked done",
      },
      {
        key: "insurer_quote_approved",
        title: "Approve the insurer's quotation",
        detail: "The formal one, on the real perimeter (group G).",
        blocking: true,
        tech: "none",
      },
      {
        key: "aion_quote_approved",
        title: "Approve AION's quotation",
        detail: "On a business case rebuilt from the formal insurer quotation, not the indicative one.",
        blocking: true,
        tech: "none",
      },
    ],
  },
  {
    key: "contracts",
    letter: "B",
    title: "Contracts and client documents",
    items: [
      {
        key: "partnership_comms",
        title: "Approve the partnership announcement",
        detail: "What each side says publicly, and when.",
        tech: "none",
      },
      {
        key: "brokerage_mandate",
        title: "Sign the insurance brokerage mandate",
        detail: "Signed by the house, appointing AION as broker.",
        tech: "none",
      },
      {
        key: "platform_licence",
        title: "Sign the AION Cover platform licence",
        detail: "The licence for the brand and client portals.",
        tech: "none",
      },
      {
        key: "technical_annex",
        title: "Approve the technical annex",
        detail: "Built on the public integration reference at api.aioncover.com; needs a technical review before it is signed.",
        tech: "config",
      },
      {
        key: "order_form",
        title: "Approve the order form",
        detail: "The economics it fixes are the ones to carry onto the brand record (group D).",
        tech: "none",
      },
      {
        key: "insurance_contract",
        title: "Sign the insurance contract",
        detail: "No cover can be issued under a policy that does not exist yet.",
        blocking: true,
        tech: "none",
      },
      {
        key: "policy_conditions",
        title: "Agree the policy conditions",
        detail: "With the insurer, for this house's perimeter.",
        tech: "none",
      },
      {
        key: "client_documents",
        title: "Prepare the client document set",
        detail: "Terms, the insurance product information document, and the privacy notice, agreed with the insurer.",
        tech: "none",
      },
    ],
  },
  {
    key: "record",
    letter: "C",
    title: "Brand record and portal",
    items: [
      {
        key: "slug",
        title: "Settle the portal slug",
        detail: "It is the public path clients reach the portal at; changing it later invalidates every link and QR code already handed out.",
        blocking: true,
        tech: "none",
        evidence: "the brand has a portal slug",
      },
      {
        key: "brand_record",
        title: "Create the brand record",
        detail: "Name, description, website, customer-care address, registered office. Onboarding reads them off the house's legal page; check the customer-care address above all.",
        blocking: true,
        tech: "none",
        evidence: "description, website, customer-care address and registered office are set",
      },
      {
        // Split out of "Create the brand record", which used to demand the status as a fifth
        // field. It is not a field. A record with every box filled in sat unticked under a
        // sentence listing four things that were all plainly true, and the status — the one
        // thing that was not — is a decision rather than data: Verified is what PUBLISHES a
        // brand. The portal's brand picker lists every verified brand to anonymous visitors,
        // and the admin dashboards, reports, covers and claims all scope to them. So it gets
        // its own line, and nothing sets it automatically.
        key: "brand_verified",
        title: "Verify the brand",
        detail: "Verified is what publishes it: the portal's brand picker shows every verified brand to anonymous visitors, and the AION dashboards, reports, covers and claims all scope to them. Deliberate, never automatic.",
        blocking: true,
        tech: "none",
        evidence: "the status is Verified",
      },
      {
        key: "assets_collected",
        title: "Collect the brand assets",
        detail: "Full logo and monogram, plus the six section images: sign-in, dashboard hero, theft, damage, FAQ, feedback. Onboarding finds them on the house's site; replace them with files the house has approved before launch.",
        tech: "none",
        evidence: "both logos and all six section images are set",
      },
      {
        key: "assets_uploaded",
        title: "Upload logos and imagery",
        detail: "Logos to the brand logo bucket, section images to the brand media bucket.",
        tech: "none",
        evidence: "every logo and image is served from AION storage rather than hotlinked from the brand's own site",
      },
      {
        key: "theme",
        title: "Define the portal theme",
        detail: "Primary colour, heading typeface with its font URL, and the default language. A proprietary typeface cannot be loaded by the portal, so agree a Google alternative with the house.",
        tech: "none",
        evidence: "a primary colour and a heading typeface are on the record",
      },
      {
        key: "faq",
        title: "Write and load the FAQ",
        detail: "Both locales, in structured blocks — this is what the client actually reads in the portal. Onboarding writes the standard set; review it with the house.",
        tech: "none",
        evidence: "both locales carry FAQ entries",
      },
    ],
  },
  {
    key: "economics",
    letter: "D",
    title: "Commercial parameters",
    items: [
      {
        key: "premium",
        title: "Set the insurance premium",
        detail: "Follows from the insurer quotation for this brand's perimeter.",
        blocking: true,
        tech: "none",
        evidence: "the insurance premium is set",
      },
      {
        key: "fees",
        title: "Set the activation fee and AION share",
        detail: "Both are per-brand and feed the business case as well as the reporting. Onboarding fills the standard terms; align them with the signed order form.",
        blocking: true,
        tech: "none",
        evidence: "the activation fee and the AION share are set",
      },
      {
        key: "ceiling",
        title: "Set the covered-value ceiling",
        detail: "The per-piece retail cap. It is frozen onto each cover at sale time, so later changes only affect new covers.",
        blocking: true,
        tech: "none",
        evidence: "the covered-value ceiling is set",
      },
      {
        key: "floor",
        title: "Set the activation floor",
        detail: "At or below this retail price a cover is recorded but not activated. The default suits jewellery; a catalogue with lower price points needs its own value or much of the volume lands blocked — and existing covers are not re-evaluated when it changes.",
        blocking: true,
        tech: "none",
        evidence: "the activation floor is set",
      },
    ],
  },
  {
    key: "taxonomy",
    letter: "E",
    title: "Taxonomy and costs",
    items: [
      {
        key: "category_list",
        title: "Obtain the exact category list",
        detail: "The categories the brand's own systems emit, not the ones in the commercial catalogue. Agreed with the house's IT and mapped.",
        blocking: true,
        tech: "heavy",
        evidence: "the catalogue the brand's own systems emit carries categories",
      },
      {
        key: "product_key",
        title: "Agree the unique product and order-line key",
        detail: "What makes a retried sale idempotent and lets a return or cancellation find its sale. Fixed in the integration specification.",
        blocking: true,
        tech: "heavy",
      },
      {
        key: "costs_loaded",
        title: "Load a cost percentage for every category",
        detail: "Singular and plural forms both, since inbound normalisation is approximate. An unmapped category silently computes a cost of zero. There is no admin screen for this: it is loaded in SQL.",
        blocking: true,
        tech: "config",
        evidence: "every category in that catalogue has a cost percentage",
      },
      {
        key: "category_ownership",
        title: "Agree who flags new categories",
        detail: "Seasonal catalogues grow new categories; each one needs a percentage before it sells.",
        tech: "config",
      },
      {
        key: "cost_reconciliation",
        title: "Set up the periodic reconciliation",
        detail: "Catalogue categories with no cost row. This has caught real gaps on live programmes.",
        tech: "config",
      },
    ],
  },
  {
    key: "integration",
    letter: "F",
    title: "Sales integration",
    items: [
      {
        // Everything above this group can be done on DEV, and most of it is done there by
        // the onboarding pipeline. Production has none of that automation, so the brand has
        // to be brought across before a real sale can land.
        key: "prod_brand",
        title: "Create the brand in production",
        detail: "Onboarding and the commercial cycle run on DEV only. The record, pictures, theme, FAQ, economics, costs, credential, boutiques and reporting flag all have to exist on production — replicated, or by a promotion (docs/PROD_PROMOTION.md).",
        blocking: true,
        tech: "heavy",
      },
      {
        key: "spec_shared",
        title: "Share the integration specification",
        detail: "Production endpoints, authentication, payloads, idempotency — the public reference is at api.aioncover.com. Send it early: the house's IT is usually the critical path.",
        tech: "config",
      },
      {
        key: "test_credential",
        title: "Issue the test credential",
        detail: "The service derives the brand and the record source from the credential, so no code change is needed for a new brand. Loaded in SQL.",
        tech: "config",
        evidence: "an active API credential exists for this brand",
      },
      {
        key: "field_allowlist",
        title: "Put an allowlist on inbound customer fields",
        detail: "The partner's customer object is written through as received; privileged fields must not be settable from a payload.",
        blocking: true,
        tech: "heavy",
      },
      {
        key: "no_email_policy",
        title: "Decide the behaviour when no email arrives",
        detail: "Today a placeholder address is composed and matching falls back to the surname, so the client receives no link. Agree with the house whether an email is mandatory, and change the service if not.",
        tech: "heavy",
      },
      {
        key: "brand_it_integration",
        title: "See the house's IT through to its first calls",
        detail: "AION's side needs no code: the work is the house's systems calling the sale, return and cancellation endpoints. Stay with them until the first calls succeed.",
        blocking: true,
        tech: "heavy",
      },
      {
        key: "shops",
        title: "Decide whether to preload the boutiques",
        detail: "Otherwise they are created from the first sale that names them, with whatever formatting the source system sends.",
        tech: "none",
        evidence: "boutiques exist for this brand",
      },
      {
        key: "test_set",
        title: "Run the end-to-end test set",
        detail: "A sale, a multi-quantity sale, a fractional quantity, a duplicate retry, a return, a cancellation, and a return against an unknown sale. A failed request leaves no response on file, so reconcile failures with the house by hand.",
        blocking: true,
        tech: "heavy",
      },
      {
        key: "prod_credential",
        title: "Issue the production credential",
        detail: "Only after a joint reconciliation of the test results, blocked covers included.",
        blocking: true,
        tech: "config",
      },
    ],
  },
  {
    key: "insurer",
    letter: "G",
    title: "Insurer and reporting",
    items: [
      {
        key: "quotation",
        title: "Close the formal insurer quotation",
        detail: "On the real perimeter. It takes one to two months and everything commercial depends on it. Enter it under Business case › Insurer quotes as soon as it lands.",
        blocking: true,
        tech: "none",
        evidence: "an insurer quote is on file for THIS brand, not borrowed from another",
      },
      {
        key: "policy_prefix",
        title: "Assign the policy number prefix",
        detail: "Five characters, with the policy number padded to fifteen digits. Onboarding proposes one that is not in use; confirm it with the insurer.",
        blocking: true,
        tech: "none",
        evidence: "a policy prefix is set",
      },
      {
        key: "product_codes",
        title: "Confirm the caller and product codes",
        detail: "The current values were set for a jewellery programme. If the insurer assigns different ones for this house, the reporting job has to change.",
        tech: "heavy",
      },
      {
        key: "sftp",
        title: "Verify the reporting destination",
        detail: "Whether the insurer wants a separate account or directory for this brand.",
        tech: "config",
      },
      {
        key: "reporting_on",
        title: "Enable daily insurer reporting",
        detail: "The scheduled job picks the brand up on its own at the next run once the flag is set.",
        blocking: true,
        tech: "config",
        evidence: "daily insurer reporting is enabled",
      },
      {
        key: "first_file_validated",
        title: "Have the insurer validate the first file",
        detail: "Before real volume flows. Backdating limits and the effective-date rule are what make an import fail.",
        blocking: true,
        tech: "config",
      },
      {
        key: "claims_bordereau",
        title: "Include the brand in the claims bordereau",
        detail: "The integration exists; agree the process with the insurer and check the brand is in it.",
        tech: "config",
      },
    ],
  },
  {
    key: "finance",
    letter: "H",
    title: "Finance",
    items: [
      {
        key: "claims_bank_details",
        title: "Collect the bank details for claim payments",
        detail: "Where the house is paid when a claim is settled.",
        tech: "none",
      },
      {
        key: "billing_cycle",
        title: "Set up invoicing both ways",
        detail: "What AION invoices and what it pays, and when. The monthly internal report books covers on the insurer's cut-off.",
        tech: "none",
      },
    ],
  },
  {
    key: "claims",
    letter: "I",
    title: "Claims",
    items: [
      {
        key: "claims_covered",
        title: "Agree what is covered",
        detail: "In words the sales network and the client can both use.",
        tech: "none",
      },
      {
        key: "claims_runbook",
        title: "Define the claims runbook",
        detail: "Who looks at what, within what time, and how it escalates.",
        tech: "none",
      },
      {
        key: "claims_voucher",
        title: "Set up replacement vouchers",
        detail: "How a replacement is issued to the client.",
        tech: "none",
      },
      {
        key: "claims_recovery",
        title: "Arrange recovery of the replaced piece",
        detail: "Who collects it, and where it goes.",
        tech: "none",
      },
    ],
  },
  {
    key: "launch",
    letter: "J",
    title: "People, operations, launch",
    items: [
      {
        key: "pilot_contacts",
        title: "Name the house's contacts in the pilot",
        detail: "Head office and the sales associates in the participating boutiques.",
        tech: "none",
      },
      {
        key: "brand_users",
        title: "Create the brand users",
        detail: "At least one contact with access to the brand portal — Shop assistants, with Master User for head office. Only master users can change the knowledge base.",
        tech: "none",
        evidence: "at least one brand user exists",
      },
      {
        key: "customer_invite",
        title: "Decide who sends the client invitation",
        detail: "The house's own system, as on the programme in production, or AION. It carries the portal link and a QR code.",
        tech: "none",
      },
      {
        key: "invite_email",
        title: "Build the automatic invitation, if AION sends it",
        detail: "Today nothing sends it on a sale — only the manual Resend invite on Customers. It needs a trigger on the new cover and a branded template. Tick it with a note if the house sends the invitation.",
        tech: "heavy",
      },
      {
        key: "activation_flow",
        title: "Adapt the after-sale activation flow",
        detail: "The standard flow is already in the generated ops deck.",
        tech: "none",
      },
      {
        key: "training",
        title: "Train the sales network",
        detail: "When the cover is offered, what is said, and what happens next.",
        tech: "none",
      },
      {
        key: "first_sale",
        title: "Agree the first live sale date",
        detail: "And watch the opening days by hand: the first cover and the first insurer file both deserve a manual look.",
        tech: "config",
      },
      {
        key: "official_launch",
        title: "Official launch",
        detail: "The announcement agreed in group B goes out.",
        tech: "none",
      },
    ],
  },
];

/** Every item, flattened — for counting and for looking one up by key. */
export const ALL_ITEMS: ChecklistItem[] = GO_LIVE_CHECKLIST.flatMap((g) => g.items);

export type ChecklistState = Record<string, { done: boolean; note: string | null; updated_at: string; updated_by: string | null }>;

/**
 * What `brand_golive_signals` found, per item key.
 *
 * `true` is done. A STRING is the reason it is not — "still missing: the status is still
 * Pending", "3 of 8 are still hotlinked from the brand's own site". The static evidence
 * phrase on the item could only ever restate the whole requirement, which is how a
 * checklist with every visible field filled read as inexplicably stuck.
 */
export type ChecklistSignals = Record<string, boolean | string>;

/**
 * Is this item done?
 *
 * Either the platform can see it or a person has said so. A tick can only ever ADD: nobody
 * can un-tick a premium that is demonstrably set, and nothing the platform sees erases the
 * record of who confirmed what.
 */
export function isItemDone(
  key: string, state: ChecklistState, signals: ChecklistSignals = {},
): boolean {
  return signals[key] === true || state[key]?.done === true;
}

/** Why the platform says this item is not done, when it has something specific to say. */
export function itemBlockedBecause(
  key: string, signals: ChecklistSignals = {},
): string | null {
  const signal = signals[key];
  return typeof signal === "string" && signal.trim() ? signal : null;
}

/** Done / total, counting only items that still exist in the definition. */
export function checklistProgress(
  state: ChecklistState, signals: ChecklistSignals = {},
): { done: number; total: number; blockingLeft: number; detected: number } {
  const isDone = (i: ChecklistItem) => isItemDone(i.key, state, signals);
  return {
    done: ALL_ITEMS.filter(isDone).length,
    total: ALL_ITEMS.length,
    blockingLeft: ALL_ITEMS.filter((i) => i.blocking && !isDone(i)).length,
    // How much of this the platform answered on its own — worth showing, because it is the
    // difference between a checklist somebody maintains and one that maintains itself.
    detected: ALL_ITEMS.filter((i) => signals[i.key] === true).length,
  };
}

// ── What to put in front of somebody ─────────────────────────────────────────
//
// The list is sixty-odd items and a third of them answer themselves. Rendering all of it,
// always, made the screen a wall: the reader's question is "what is left and what is
// stopping us", and the answer was somewhere in the middle of ten groups of ticked boxes.
//
// So the screen filters, and the filtering is here rather than inline in the component
// because "which items does TO DO mean" is a rule worth being able to test.

export type ChecklistFilter = "todo" | "blocking" | "all";

export const CHECKLIST_FILTERS: readonly { value: ChecklistFilter; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "blocking", label: "Blocking" },
  { value: "all", label: "Everything" },
] as const;

// The second axis: who can close it. Independent of the first — "blocking and tech heavy"
// is the question a developer planning the week asks.
export type TechFilter = "any" | "heavy" | "light";

export const TECH_FILTERS: readonly { value: TechFilter; label: string }[] = [
  { value: "any", label: "All work" },
  { value: "heavy", label: "Tech heavy" },
  { value: "light", label: "Not tech heavy" },
] as const;

/** Does this item belong under the tech filter? "Not tech heavy" includes configuration. */
export function matchesTech(item: ChecklistItem, tech: TechFilter): boolean {
  if (tech === "any") return true;
  return tech === "heavy" ? item.tech === "heavy" : item.tech !== "heavy";
}

export type FilteredGroup = {
  group: ChecklistGroup;
  /** The items this filter shows. Empty when the whole group is behind us. */
  items: ChecklistItem[];
  /** Counted over the items the tech filter keeps, so a group's figures match what it lists. */
  done: number;
  /** Zero when the tech filter leaves nothing of this group at all — the screen hides it. */
  total: number;
  /** Every item in this group is done — so it can collapse to a single line. */
  settled: boolean;
};

/**
 * The groups as these filters want them shown.
 *
 * Groups are always returned, settled ones included, so the screen can show a house's whole
 * shape and let a reader open what is already finished. Only `items` changes — and, under a
 * tech filter, the counts, which cover only that kind of work.
 */
export function filterChecklist(
  filter: ChecklistFilter, state: ChecklistState, signals: ChecklistSignals = {},
  tech: TechFilter = "any",
): FilteredGroup[] {
  return GO_LIVE_CHECKLIST.map((group) => {
    const scope = group.items.filter((i) => matchesTech(i, tech));
    const done = scope.filter((i) => isItemDone(i.key, state, signals)).length;
    const items = scope.filter((i) => {
      if (filter === "all") return true;
      if (isItemDone(i.key, state, signals)) return false;
      return filter === "todo" ? true : i.blocking === true;
    });
    return { group, items, done, total: scope.length, settled: done === scope.length };
  });
}

/** How many items a combination of the two filters shows — for the counts on the buttons. */
export function countShown(
  filter: ChecklistFilter, tech: TechFilter, state: ChecklistState, signals: ChecklistSignals = {},
): number {
  return filterChecklist(filter, state, signals, tech).reduce((n, g) => n + g.items.length, 0);
}

/** The blocking items still in the way, most specific diagnosis first. */
export function blockingItems(
  state: ChecklistState, signals: ChecklistSignals = {},
): { item: ChecklistItem; because: string | null }[] {
  return ALL_ITEMS
    .filter((i) => i.blocking && !isItemDone(i.key, state, signals))
    .map((item) => ({ item, because: itemBlockedBecause(item.key, signals) }))
    .sort((a, b) => Number(Boolean(b.because)) - Number(Boolean(a.because)));
}
