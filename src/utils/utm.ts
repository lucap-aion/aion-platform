// UTM source tracking — captures campaign params from the entry URL so we can
// attribute where a customer came from (RC program page, RC email, aioncover.com).
//
// Customers may land on a link that immediately redirects (e.g. `/` → `/rc`, or the
// `/:slug` entry → `/:slug/login`), and signup completes only after an email round-trip.
// So we snapshot the params into sessionStorage on first load and read them back at
// signup time. First-touch wins: the original entry source is never overwritten.

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const STORAGE_KEY = "aion_utm";

export type UtmParams = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** Snapshot UTM params from a query string into sessionStorage (first-touch wins). */
export function captureUtm(search: string): void {
  if (typeof sessionStorage === "undefined") return;
  const params = new URLSearchParams(search);
  const found: UtmParams = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) found[k] = v.slice(0, 200);
  }
  if (Object.keys(found).length === 0) return;
  // Don't overwrite the first source captured in this session.
  if (sessionStorage.getItem(STORAGE_KEY)) return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(found));
}

/** Read the UTM params captured earlier this session. */
export function getStoredUtm(): UtmParams {
  if (typeof sessionStorage === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as UtmParams;
  } catch {
    return {};
  }
}
