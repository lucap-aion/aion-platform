// Which project is this function running against?
//
// Demo tooling — generating a fake book of business, minting loginable demo
// accounts — must never run against production. A brand's live account is not a
// place to discover that forty invented clients and three shared logins have
// appeared in it.
//
// The gate is derived from the project ref rather than from a feature flag on
// purpose: a flag has to be remembered when a function is deployed, and the one
// time it is forgotten is the time it matters. This fails CLOSED — anything that
// isn't a known non-production project is treated as production.

const DEV_PROJECT_REF = "tlmdlskiubfdhywmzgzb";
const PROD_PROJECT_REF = "dvmhwsmunvfdxnvckdom";

export function projectRef(): string {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return url.replace(/^https?:\/\//, "").split(".")[0] ?? "";
}

export function isProduction(): boolean {
  return projectRef() === PROD_PROJECT_REF || !isNonProduction();
}

export function isNonProduction(): boolean {
  const ref = projectRef();
  if (ref === PROD_PROJECT_REF) return false;
  if (ref === DEV_PROJECT_REF) return true;
  // A future staging project can opt in explicitly; production cannot opt in by
  // omission, because the default above is already "no".
  return Deno.env.get("ALLOW_DEMO_TOOLS") === "true";
}

// Demo data and demo logins. Everything else in onboarding (crawl, catalogue,
// documents) is real work and runs anywhere.
export function demoToolsEnabled(): boolean {
  return isNonProduction();
}

export function demoToolsBlockedReason(): string {
  return `demo tooling is disabled on this environment (project ${projectRef()}). ` +
    "Generating demo clients, covers and logins is a dev-only operation — " +
    "a live brand account must contain only its own data.";
}

// ── Demo tooling for one brand ───────────────────────────────────────────────
// The environment gate above is right about live brands and wrong about
// prospects, and the platform could not tell them apart.
//
// The rule it enforces — "a live brand account must contain only its own data" —
// says nothing about a house that has not signed anything and whose account holds
// nothing at all. Yet the demo is precisely what a prospect is shown, and it was
// refused on the only project their deck, their catalogue and their documents
// live on. The two-hour job nobody does was the one thing the pipeline would not
// do for them.
//
// So a brand explicitly flagged as a prospect may have a demo built in it,
// anywhere. The flag alone is not enough to breach the rule, because a flag can
// be set by mistake: `status` must also not be 'verified', which is what a house
// becomes when its account goes live. Both have to be wrong before fabricated
// clients can reach a real programme, and each is set by a different action.
export type DemoBrand = { is_prospect?: boolean | null; status?: string | null; name?: string | null };

export function demoAllowedForBrand(brand: DemoBrand): boolean {
  if (isNonProduction()) return true;
  return brand.is_prospect === true && brand.status !== "verified";
}

export function demoBlockedForBrandReason(brand: DemoBrand): string {
  const who = brand.name ?? "this brand";
  if (brand.is_prospect !== true) {
    return `${who} is not flagged as a prospect, so demo tooling is refused on this ` +
      `environment (project ${projectRef()}). Fabricated clients, covers and logins belong ` +
      "in a prospect's empty account, never in a live one. Mark it a prospect on the brand " +
      "record if it genuinely is one.";
  }
  return `${who} is flagged as a prospect but its status is 'verified', which is what a ` +
    "brand becomes when it goes live. Refusing rather than guessing: clear one of the two " +
    "if this really is still a deal.";
}
