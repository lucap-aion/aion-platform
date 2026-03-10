/**
 * Returns the canonical site URL for auth redirects.
 * On localhost / 127.0.0.1 always uses the current origin so email links
 * redirect back to the local dev server.
 * In production uses VITE_SITE_URL, falling back to the current origin.
 */
export const siteUrl = (): string => {
  const { hostname, origin } = window.location;
  if (hostname === "localhost") return origin;
  return import.meta.env.VITE_SITE_URL ?? origin;
};
