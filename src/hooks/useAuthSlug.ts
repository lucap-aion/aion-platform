import { useParams } from "react-router-dom";

const TENANT_SLUG_KEY = "aion_tenant_slug";

/**
 * Returns the slug prefix for auth navigation (e.g. "/rc"), or "" if none.
 * Prefers the :slug route param; falls back to sessionStorage.
 */
export function useAuthSlug(): string {
  const { slug } = useParams<{ slug?: string }>();
  const resolved = slug ?? sessionStorage.getItem(TENANT_SLUG_KEY) ?? "";
  return resolved && resolved !== "default" ? `/${resolved}` : "";
}
