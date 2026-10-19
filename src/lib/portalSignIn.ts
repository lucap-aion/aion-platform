import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Signs in, asks whether this account may use this portal, and only then hands the session
// to the app.
//
// The question used to be asked BEFORE the password, about any email, by anyone — which
// told a stranger whether an address belonged to a client of the house or to an AION admin.
// Asking it afterwards on the app's own client is not an option either: the moment a
// session lands there, AuthRoute redirects into the portal, so an account that does not
// belong here would be inside before the answer came back. So the password is checked on
// a throwaway client with no storage, the question is asked with that session, and only an
// account that may enter has its session copied across.

type Check =
  | { fn: "check_my_brand_access"; args: { p_brand_id: number } }
  | { fn: "check_my_admin_access"; args?: undefined };

// One shape rather than a union: the app compiles without strictNullChecks, where a
// boolean discriminant does not narrow.
export type PortalSignInResult = {
  ok: boolean;
  userId?: string;
  reason?: "credentials" | "unconfirmed" | "denied";
  status?: string;
  message?: string;
};

export async function portalSignIn(email: string, password: string, check: Check): Promise<PortalSignInResult> {
  const probe = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "aion-portal-probe" },
  });

  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const unconfirmed = /not confirmed/i.test(error?.message ?? "");
    return { ok: false, reason: unconfirmed ? "unconfirmed" : "credentials", message: error?.message };
  }

  const { data: status, error: checkError } = await probe.rpc(check.fn, check.args ?? {});
  if (checkError || status !== "ok") {
    // Revoke this one session only; the account's other devices stay signed in.
    await probe.auth.signOut({ scope: "local" });
    return {
      ok: false,
      reason: status === "unconfirmed" ? "unconfirmed" : "denied",
      status: typeof status === "string" ? status : undefined,
      message: checkError?.message,
    };
  }

  const { error: setError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (setError) return { ok: false, reason: "credentials", message: setError.message };
  return { ok: true, userId: data.user.id };
}
