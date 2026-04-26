import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user, profile, adminRecord, loading } = useAuth();

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

    const isProd = window.location.hostname === PROD_HOST;
    if (!isProd) return;

    if (noClarityParam === "1" || hasNoClarityCookie()) return;

    const email = (user?.email ?? profile?.email ?? adminRecord?.email ?? "").toLowerCase();
    if (email.endsWith("@aioncover.com")) return;

    loadClarity(CLARITY_PROJECT_ID);
  }, [loading, user, profile, adminRecord, noClarityParam]);

  return null;
}
