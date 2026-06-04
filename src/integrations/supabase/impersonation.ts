// Admin "view-as / impersonate" — shared client-side state + helpers.
//
// Mechanism: the admin stays authenticated as themselves; AuthContext swaps the
// *effective* profile so the customer/brand UI renders as the target. This module
// owns the sessionStorage persistence (survives in-app reloads, auto-expires on tab
// close), write-tagging so impersonation activity is excluded from analytics, and the
// audit-log writes.

import { supabase } from "./client";

const STORAGE_KEY = "aion_impersonation";

/** Effective profile shape — mirrors AuthContext's Profile. */
export interface ImpersonatedProfile {
  id: string;
  user_id: string | null;
  brand_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  avatar: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  phone_number: string | null;
  address: string | null;
  province: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  is_master: boolean | null;
}

export interface ImpersonationState {
  profile: ImpersonatedProfile;
  /** public.admins.id of the real admin doing the impersonation */
  adminId: string;
  /** admin_impersonation_log row id, for best-effort ended_at on exit */
  auditId: number | null;
  /** brand slug for routing / exit */
  slug: string | null;
}

export function readImpersonation(): ImpersonationState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ImpersonationState) : null;
  } catch {
    return null;
  }
}

export function writeImpersonation(state: ImpersonationState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearImpersonation(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
}

/** True when an admin is currently viewing-as a user (readable outside React). */
export function isImpersonatingNow(): boolean {
  return readImpersonation() !== null;
}

/**
 * Tag an insert row with the impersonating admin's id so analytics can exclude it.
 * No-op (returns the row unchanged) when not impersonating. Apply ONLY at the
 * analytics-feeding insert sites — never globally — so legit admin-portal writes
 * stay untagged.
 */
export function stampImpersonation<T extends object>(row: T): T & { impersonated_by?: string } {
  const imp = readImpersonation();
  return imp ? { ...row, impersonated_by: imp.adminId } : row;
}

/** Insert an audit row when impersonation starts. Returns the row id, or null. */
export async function logImpersonationStart(
  adminId: string,
  target: ImpersonatedProfile,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("admin_impersonation_log")
    .insert({
      admin_id: adminId,
      target_profile_id: target.id,
      target_role: target.role,
      brand_id: target.brand_id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[impersonation audit start]", error);
    return null;
  }
  return (data as { id: number }).id;
}

/** Best-effort: stamp ended_at on the audit row when impersonation ends. */
export async function logImpersonationEnd(auditId: number | null): Promise<void> {
  if (auditId == null) return;
  const { error } = await supabase
    .from("admin_impersonation_log")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", auditId);
  if (error) console.error("[impersonation audit end]", error);
}
