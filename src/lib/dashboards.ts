// Saved dashboards (brand_dashboards, migration 20261117000004): a report the assistant built,
// kept as its spec and re-run on open, so the numbers are always today's.
import { supabase } from "@/integrations/supabase/client";
import type { ReportPayload } from "@/components/assistant/ReportView";

// The table is newer than the generated types (as in team.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

export type Dashboard = {
  id: number;
  brand_id: number;
  owner_profile_id: string;
  title: string;
  shared: boolean;
  created_at: string;
  owner?: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

export async function listDashboards(brandId: number): Promise<Dashboard[]> {
  const { data, error } = await db.from("brand_dashboards")
    .select("id, brand_id, owner_profile_id, title, shared, created_at, owner:profiles!brand_dashboards_owner_profile_id_fkey(first_name, last_name, email)")
    .eq("brand_id", brandId)
    .order("position").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Dashboard[];
}

export async function saveDashboard(args: { brandId: number; profileId: string; title: string; spec: Record<string, unknown> }) {
  const { error } = await db.from("brand_dashboards").insert({
    brand_id: args.brandId, owner_profile_id: args.profileId, title: args.title.slice(0, 200), spec: args.spec,
  });
  if (error) throw error;
}

export async function setDashboardShared(id: number, shared: boolean) {
  const { error } = await db.from("brand_dashboards").update({ shared }).eq("id", id);
  if (error) throw error;
}

export async function renameDashboard(id: number, title: string) {
  const { error } = await db.from("brand_dashboards").update({ title: title.slice(0, 200) }).eq("id", id);
  if (error) throw error;
}

export async function deleteDashboard(id: number) {
  const { error } = await db.from("brand_dashboards").delete().eq("id", id);
  if (error) throw error;
}

/** Runs the saved spec again on the server; no model call, today's data. */
export async function runDashboard(id: number, locale = "it"): Promise<{ report: ReportPayload; warnings: string | null }> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/brand-assistant`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "run_dashboard", dashboard_id: id, locale }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as { report: ReportPayload; warnings: string | null };
}
