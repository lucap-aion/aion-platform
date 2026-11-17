import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isBrandRole, useAuth } from "@/contexts/AuthContext";

// brand_staff_roles and profiles.staff_role_id are newer than the generated types (as in team.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type AssistantMode = "full" | "preset" | "off";
export type PresetQuestion = { id: string; label: string; question: string };
export type StaffRole = {
  id: number;
  name: string;
  pages: string[];
  assistant_mode: AssistantMode;
  preset_questions: PresetQuestion[];
};

/**
 * The pages a role can be given. The assistant is not here: its own mode decides it.
 * Team and Integrations are masters' screens and are never given to a role.
 */
export const ROLE_PAGES: { path: string; label: string }[] = [
  { path: "/dashboard", label: "Home" },
  { path: "/insights", label: "Insights" },
  { path: "/knowledge", label: "Knowledge" },
  { path: "/discussions", label: "Discussions" },
  { path: "/customers", label: "Customers" },
  { path: "/covers", label: "Covers" },
  { path: "/claims", label: "Claims" },
  { path: "/shops", label: "Shops" },
];

/** Every path a role can close. Anything else (profile, notifications…) is always open. */
export const GATED_PATHS = [...ROLE_PAGES.map((p) => p.path), "/assistant", "/ai-query", "/renewals"];

/** May this role open this path (the part after the brand's slug)? */
export function roleAllows(role: StaffRole | null, path: string): boolean {
  if (!role) return true;
  const gated = GATED_PATHS.find((g) => path === g || path.startsWith(`${g}/`));
  if (!gated) return true;
  if (gated === "/assistant") return role.assistant_mode !== "off";
  // The older data chat has no preset questions, so only an unrestricted assistant opens it.
  if (gated === "/ai-query") return role.assistant_mode === "full";
  // Renewals is reached from Covers.
  if (gated === "/renewals") return role.pages.includes("/covers");
  return role.pages.includes(gated);
}

/** The first screen a role can open, for a redirect away from one it cannot. */
export function landingFor(
  role: StaffRole | null,
  opts: { assistantFirst: boolean; assistantAvailable: boolean },
): string {
  // Never a screen another rule sends away from — that is how two redirects become a loop.
  const assistant = opts.assistantAvailable && (!role || role.assistant_mode !== "off");
  if (!role) return opts.assistantFirst && assistant ? "/assistant" : "/dashboard";
  if (opts.assistantFirst && assistant) return "/assistant";
  const page = ROLE_PAGES.find((p) => role.pages.includes(p.path));
  if (page) return page.path;
  return assistant ? "/assistant" : "/profile";
}

/**
 * The signed-in (or viewed-as) staff member's role, or null for no restriction — a master,
 * a user with no role, or anyone who is not brand staff. The server enforces the assistant
 * part regardless (staff-access.ts); this decides what the portal shows.
 */
export function useStaffRole(): { role: StaffRole | null; shopName: string | null; loading: boolean } {
  const { profile } = useAuth();
  const staff = !!profile?.id && isBrandRole(profile?.role) && profile?.is_master !== true;
  const { data, isLoading } = useQuery({
    queryKey: ["staff-role", profile?.id],
    enabled: staff,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: p, error } = await db.from("profiles")
        .select("staff_role_id, shop_id, is_master").eq("id", profile!.id).maybeSingle();
      // Before the column exists, or on any read error: no role, which is how every user
      // worked before roles. The server, not this, is what restricts the assistant.
      if (error || !p || p.is_master || p.staff_role_id == null) return { role: null, shopName: null };
      const [{ data: r }, shop] = await Promise.all([
        db.from("brand_staff_roles")
          .select("id, name, pages, assistant_mode, preset_questions").eq("id", p.staff_role_id).maybeSingle(),
        p.shop_id != null
          ? supabase.from("shops").select("name").eq("id", p.shop_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const role = r
        ? {
            ...(r as Omit<StaffRole, "preset_questions"> & { preset_questions: unknown }),
            pages: (r as { pages?: string[] }).pages ?? [],
            preset_questions: Array.isArray((r as { preset_questions?: unknown }).preset_questions)
              ? ((r as { preset_questions: PresetQuestion[] }).preset_questions)
              : [],
          } as StaffRole
        : null;
      return { role, shopName: ((shop.data as { name?: string } | null)?.name ?? null) };
    },
  });
  return { role: data?.role ?? null, shopName: data?.shopName ?? null, loading: staff && isLoading };
}

/** A preset as the person will read it: {{shop}} as their store. */
export function presetText(q: string, shopName: string | null): string {
  return q.replace(/\{\{\s*shop\s*\}\}/gi, shopName ?? "your store");
}

export function useBrandRoles(brandId: number | null | undefined) {
  return useQuery({
    queryKey: ["brand-staff-roles", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await db.from("brand_staff_roles")
        .select("id, name, pages, assistant_mode, preset_questions").eq("brand_id", brandId).order("name");
      if (error) throw error;
      return (data ?? []) as StaffRole[];
    },
  });
}

/** One line on what a role can do, for the list and the member picker. */
export function describeRole(r: StaffRole): string {
  const pages = ROLE_PAGES.filter((p) => r.pages.includes(p.path)).map((p) => p.label);
  const assistant = r.assistant_mode === "full" ? "assistant"
    : r.assistant_mode === "preset" ? `${r.preset_questions.length} preset question${r.preset_questions.length === 1 ? "" : "s"}`
    : null;
  return [...pages, ...(assistant ? [assistant] : [])].join(" · ") || "Nothing — only their profile";
}
