// ==============================|| GO-LIVE CHECKLIST ||============================== //
// What has to be true before a brand can issue a real cover.
//
// The list lives in code, not in the database: it evolves with the platform, and a brand
// added last year should pick up an item added last week rather than being stuck with the
// list as it stood the day it was created. Only the *state* is stored, per brand, in
// `brand_golive_checklist` — an item with no row has simply not been touched.
//
// The groups are ordered the way the work is usually sequenced, but nothing gates anything:
// the insurer quotation runs for weeks in the background while configuration proceeds, and
// items genuinely get closed out of order.
//
// `blocking: true` means the first real cover cannot be issued until it is done. Everything
// else can trail the launch.

export type ChecklistItem = {
  /** Stable across edits to the label — it is the primary key in the database. */
  key: string;
  title: string;
  detail: string;
  blocking?: boolean;
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
    key: "record",
    letter: "A",
    title: "Brand record and portal",
    items: [
      {
        key: "slug",
        title: "Settle the portal slug",
        detail: "It is the public path clients reach the portal at; changing it later invalidates every link already handed out.",
        blocking: true,
      },
      {
        key: "brand_record",
        title: "Create the brand record",
        detail: "Name, description, website, customer-care address, registered office, status set to verified.",
        blocking: true,
      },
      {
        key: "assets_collected",
        title: "Collect the brand assets",
        detail: "Full logo and monogram, plus the six section images: sign-in, dashboard hero, theft, damage, FAQ, feedback.",
      },
      {
        key: "assets_uploaded",
        title: "Upload logos and imagery",
        detail: "Logos to the brand logo bucket, section images to the brand media bucket.",
      },
      {
        key: "theme",
        title: "Define the portal theme",
        detail: "Primary colour, heading typeface with its font URL, and the default language.",
      },
      {
        key: "faq",
        title: "Write and load the FAQ",
        detail: "Both locales, in structured blocks — this is what the client actually reads in the portal.",
      },
    ],
  },
  {
    key: "economics",
    letter: "B",
    title: "Commercial parameters",
    items: [
      {
        key: "premium",
        title: "Set the insurance premium",
        detail: "Follows from the insurer quotation for this brand's perimeter.",
        blocking: true,
      },
      {
        key: "fees",
        title: "Set the activation fee and AION share",
        detail: "Both are per-brand and feed the business case as well as the reporting.",
        blocking: true,
      },
      {
        key: "ceiling",
        title: "Set the covered-value ceiling",
        detail: "The per-piece retail cap. It is frozen onto each cover at sale time, so later changes only affect new covers.",
        blocking: true,
      },
      {
        key: "floor",
        title: "Set the activation floor",
        detail: "At or below this retail price a cover is recorded but not activated. The default suits jewellery; a catalogue with lower price points needs its own value or much of the volume lands blocked.",
        blocking: true,
      },
    ],
  },
  {
    key: "taxonomy",
    letter: "C",
    title: "Taxonomy and costs",
    items: [
      {
        key: "category_list",
        title: "Obtain the exact category list",
        detail: "The categories the brand's own systems emit, not the ones in the commercial catalogue.",
        blocking: true,
      },
      {
        key: "costs_loaded",
        title: "Load a cost percentage for every category",
        detail: "Singular and plural forms both, since inbound normalisation is approximate. An unmapped category silently computes a cost of zero.",
        blocking: true,
      },
      {
        key: "category_ownership",
        title: "Agree who flags new categories",
        detail: "Seasonal catalogues grow new categories; each one needs a percentage before it sells.",
      },
      {
        key: "cost_reconciliation",
        title: "Set up the periodic reconciliation",
        detail: "Catalogue categories with no cost row. This has caught real gaps on live programmes.",
      },
    ],
  },
  {
    key: "integration",
    letter: "D",
    title: "Sales integration",
    items: [
      {
        key: "spec_shared",
        title: "Share the integration specification",
        detail: "Production endpoints, authentication, payloads, idempotency.",
      },
      {
        key: "test_credential",
        title: "Issue the test credential",
        detail: "The service derives the brand and the record source from the credential, so no code change is needed for a new brand.",
      },
      {
        key: "field_allowlist",
        title: "Put an allowlist on inbound customer fields",
        detail: "The partner's customer object is written through as received; privileged fields must not be settable from a payload.",
        blocking: true,
      },
      {
        key: "no_email_policy",
        title: "Decide the behaviour when no email arrives",
        detail: "Today a placeholder address is composed and matching falls back to the surname.",
      },
      {
        key: "shops",
        title: "Decide whether to preload the boutiques",
        detail: "Otherwise they are created from the first sale that names them, with whatever formatting the source system sends.",
      },
      {
        key: "test_set",
        title: "Run the end-to-end test set",
        detail: "A sale, a multi-quantity sale, a duplicate retry, a return, a cancellation, and a return against an unknown sale.",
        blocking: true,
      },
      {
        key: "prod_credential",
        title: "Issue the production credential",
        detail: "Only after a joint reconciliation of the test results, blocked covers included.",
        blocking: true,
      },
    ],
  },
  {
    key: "insurer",
    letter: "E",
    title: "Insurer and reporting",
    items: [
      {
        key: "quotation",
        title: "Close the formal insurer quotation",
        detail: "On the real perimeter. It takes one to two months and everything commercial depends on it.",
        blocking: true,
      },
      {
        key: "policy_prefix",
        title: "Assign the policy number prefix",
        detail: "Five characters, with the policy number padded to fifteen digits.",
        blocking: true,
      },
      {
        key: "product_codes",
        title: "Confirm the caller and product codes",
        detail: "The current values were set for a jewellery programme and need checking for other categories.",
      },
      {
        key: "sftp",
        title: "Verify the reporting destination",
        detail: "Whether the insurer wants a separate account or directory for this brand.",
      },
      {
        key: "reporting_on",
        title: "Enable daily insurer reporting",
        detail: "The scheduled job picks the brand up on its own at the next run once the flag is set.",
        blocking: true,
      },
      {
        key: "first_file_validated",
        title: "Have the insurer validate the first file",
        detail: "Before real volume flows. Backdating limits and the effective-date rule are what make an import fail.",
        blocking: true,
      },
    ],
  },
  {
    key: "launch",
    letter: "F",
    title: "People, documents, launch",
    items: [
      {
        key: "brand_users",
        title: "Create the brand users",
        detail: "At least one contact with access to the brand portal.",
      },
      {
        key: "client_documents",
        title: "Prepare the client document set",
        detail: "Terms, the insurance product information document, and the privacy notice, agreed with the insurer.",
      },
      {
        key: "training",
        title: "Train the sales network",
        detail: "When the cover is offered, what is said, and what happens next.",
      },
      {
        key: "claims_runbook",
        title: "Define the claims runbook",
        detail: "Who looks at what, within what time, and how it escalates.",
      },
      {
        key: "first_sale",
        title: "Agree the first live sale date",
        detail: "And watch the opening days by hand: the first cover and the first insurer file both deserve a manual look.",
      },
    ],
  },
];

/** Every item, flattened — for counting and for looking one up by key. */
export const ALL_ITEMS: ChecklistItem[] = GO_LIVE_CHECKLIST.flatMap((g) => g.items);

export type ChecklistState = Record<string, { done: boolean; note: string | null; updated_at: string; updated_by: string | null }>;

/** Done / total, counting only items that still exist in the definition. */
export function checklistProgress(state: ChecklistState): { done: number; total: number; blockingLeft: number } {
  const done = ALL_ITEMS.filter((i) => state[i.key]?.done).length;
  const blockingLeft = ALL_ITEMS.filter((i) => i.blocking && !state[i.key]?.done).length;
  return { done, total: ALL_ITEMS.length, blockingLeft };
}
