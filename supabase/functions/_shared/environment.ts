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
