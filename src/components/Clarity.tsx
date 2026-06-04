import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getStoredUtm } from "@/utils/utm";

const CLARITY_PROJECT_ID = "uybcsprpva";
const PROD_HOST = "app.aioncover.com";
const COOKIE_NAME = "noclarity";

function hasNoClarityCookie() {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c === `${COOKIE_NAME}=1`);
}

function loadClarity(projectId: string) {
  if (typeof window === "undefined") return;
  if ((window as any).clarity) return;

  (function (c: any, l: Document, a: string, r: string, i: string) {
    c[a] =
      c[a] ||
      function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
    const t = l.createElement(r) as HTMLScriptElement;
    t.async = true;
    t.src = "https://www.clarity.ms/tag/" + i;
    const y = l.getElementsByTagName(r)[0];
    y.parentNode!.insertBefore(t, y);
  })(window, document, "clarity", "script", projectId);
}

export default function Clarity() {
  const [searchParams] = useSearchParams();
  const { user, adminRecord, loading, isImpersonating } = useAuth();

  const noClarityParam = searchParams.get(COOKIE_NAME);

  // Persist / clear opt-out cookie based on URL param
  useEffect(() => {
    if (noClarityParam === "1") {
      document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax; secure`;
    } else if (noClarityParam === "0") {
      document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax; secure`;
    }
  }, [noClarityParam]);

  useEffect(() => {
    if (loading) return;

    // Never track admin "view-as" sessions — keep impersonation out of analytics.
    if (isImpersonating) return;

    const isProd = window.location.hostname === PROD_HOST;
    if (!isProd) return;

    if (noClarityParam === "1" || hasNoClarityCookie()) return;

    // Resolve from the real identity only (during impersonation `profile` is the
    // target's, which must not drive tracking — handled by the bail above too).
    const email = (user?.email ?? adminRecord?.email ?? "").toLowerCase();
    if (email.endsWith("@aioncover.com")) return;

    loadClarity(CLARITY_PROJECT_ID);

    // Tag the session with its traffic source so it can be filtered in Clarity.
    // Covers every visitor, including those who bounce before signing up.
    const utm = getStoredUtm();
    const clarity = (window as any).clarity;
    if (clarity) {
      if (utm.utm_source) clarity("set", "utm_source", utm.utm_source);
      if (utm.utm_medium) clarity("set", "utm_medium", utm.utm_medium);
      if (utm.utm_campaign) clarity("set", "utm_campaign", utm.utm_campaign);
    }
  }, [loading, user, adminRecord, noClarityParam, isImpersonating]);

  return null;
}
