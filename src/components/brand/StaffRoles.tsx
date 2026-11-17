import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, X, ShieldCheck, ArrowUp, ArrowDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_PAGES, describeRole, useBrandRoles, type AssistantMode, type PresetQuestion, type StaffRole } from "@/hooks/useStaffRole";

// brand_staff_roles is newer than the generated types (as in team.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const inputCls =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const MODES: { value: AssistantMode; label: string; hint: string }[] = [
  { value: "full", label: "Ask anything", hint: "The assistant as every user has it today." },
  { value: "preset", label: "Only the questions below", hint: "No text box: the assistant answers these questions and nothing else." },
  { value: "off", label: "No assistant", hint: "The assistant is hidden and refuses this role." },
];
const MAX_PRESETS = 10;

type Draft = { name: string; pages: string[]; mode: AssistantMode; presets: PresetQuestion[] };
const EMPTY: Draft = { name: "", pages: ["/dashboard"], mode: "preset", presets: [] };

/**
 * The brand's staff roles, for a master. A role is what a store manager or a sales associate
 * can open, and what they can ask the assistant (migration 20261117000002). Assigning one is
 * done on the member; a member with no role keeps full access.
 */
export default function StaffRoles({ brandId, memberCounts }: { brandId: number; memberCounts: Map<number, number> }) {
  const queryClient = useQueryClient();
  const { data: roles = [], isLoading } = useBrandRoles(brandId);
  const [editing, setEditing] = useState<StaffRole | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StaffRole | null>(null);

  const open = (r: StaffRole | "new") => {
    setEditing(r);
    setDraft(r === "new" ? EMPTY : {
      name: r.name, pages: r.pages, mode: r.assistant_mode,
      presets: r.preset_questions.map((p) => ({ ...p })),
    });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["brand-staff-roles"] });
    queryClient.invalidateQueries({ queryKey: ["staff-role"] });
  };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) { toast.error("Give the role a name."); return; }
    const presets = draft.presets
      .map((p) => ({ ...p, label: p.label.trim(), question: p.question.trim() }))
      .filter((p) => p.question);
    if (draft.mode === "preset" && !presets.length) {
      toast.error("Add at least one question, or let this role ask anything.");
      return;
    }
    setSaving(true);
    const row = {
      brand_id: brandId, name, pages: draft.pages, assistant_mode: draft.mode,
      // Presets are kept even in another mode, so switching back does not lose them.
      preset_questions: presets,
    };
    const { error } = editing === "new"
      ? await db.from("brand_staff_roles").insert(row)
      : await db.from("brand_staff_roles").update(row).eq("id", (editing as StaffRole).id);
    setSaving(false);
    if (error) {
      toast.error(/duplicate key/.test(error.message) ? `There is already a role called "${name}".` : error.message);
      return;
    }
    toast.success(editing === "new" ? "Role created." : "Role saved.");
    setEditing(null);
    refresh();
  };

  const inUse = (r: StaffRole) => (memberCounts.get(r.id) ?? 0) > 0;

  const remove = async (r: StaffRole) => {
    const { error } = await db.from("brand_staff_roles").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setConfirmDelete(null);
    toast.success("Role deleted.");
    refresh();
    queryClient.invalidateQueries({ queryKey: ["brand-team"] });
  };

  const setPreset = (i: number, patch: Partial<PresetQuestion>) =>
    setDraft((d) => ({ ...d, presets: d.presets.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const movePreset = (i: number, by: number) =>
    setDraft((d) => {
      const out = [...d.presets];
      const j = i + by;
      if (j < 0 || j >= out.length) return d;
      [out[i], out[j]] = [out[j], out[i]];
      return { ...d, presets: out };
    });

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Roles</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What each kind of user can open and ask. A member with no role has full access; masters always do.
          </p>
        </div>
        <button
          onClick={() => open("new")}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" /> New role
        </button>
      </div>

      <div className="glass-card divide-y divide-border">
        {isLoading ? (
          <div className="px-6 py-6"><div className="h-4 w-48 animate-pulse rounded bg-muted" /></div>
        ) : !roles.length ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No roles yet. Create one — for example "Store manager", limited to a few questions about their own store.
          </p>
        ) : roles.map((r) => (
          <div key={r.id} className="flex items-center gap-4 px-4 py-4 sm:px-6">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {r.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {memberCounts.get(r.id) ?? 0} member{(memberCounts.get(r.id) ?? 0) === 1 ? "" : "s"}
                </span>
              </p>
              <p className="truncate text-xs text-muted-foreground">{describeRole(r)}</p>
            </div>
            <button onClick={() => open(r)} className="tap-target rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setConfirmDelete(r)} className="tap-target rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="glass-card flex max-h-[90vh] w-full max-w-xl flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-5">
              <h2 className="font-serif text-lg font-semibold text-foreground">{editing === "new" ? "New role" : "Edit role"}</h2>
              <button onClick={() => setEditing(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto px-6 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</label>
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Store manager" maxLength={60} className={inputCls} />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Pages</p>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_PAGES.map((p) => (
                    <label key={p.path} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                      <input
                        type="checkbox" className="h-4 w-4 accent-primary"
                        checked={draft.pages.includes(p.path)}
                        onChange={(e) => setDraft((d) => ({
                          ...d, pages: e.target.checked ? [...d.pages, p.path] : d.pages.filter((x) => x !== p.path),
                        }))}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Pages switched off for the brand stay off whatever is ticked here.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Assistant</p>
                <div className="space-y-2">
                  {MODES.map((m) => (
                    <label key={m.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 ${draft.mode === m.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
                      <input type="radio" name="assistant-mode" className="mt-1 accent-primary"
                        checked={draft.mode === m.value} onChange={() => setDraft((d) => ({ ...d, mode: m.value }))} />
                      <span>
                        <span className="block text-sm font-medium text-foreground">{m.label}</span>
                        <span className="block text-xs text-muted-foreground">{m.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {draft.mode === "preset" && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Questions</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Write <code className="rounded bg-muted px-1">{"{{shop}}"}</code> where the member's own store should go —
                    "What did {"{{shop}}"} sell this week?" Set each member's store on the member.
                  </p>
                  <div className="space-y-3">
                    {draft.presets.map((p, i) => (
                      <div key={p.id} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <input value={p.label} onChange={(e) => setPreset(i, { label: e.target.value })}
                            placeholder="Button label (optional)" maxLength={60} className={`${inputCls} py-1.5`} />
                          <button type="button" onClick={() => movePreset(i, -1)} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" title="Move up">
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => movePreset(i, 1)} disabled={i === draft.presets.length - 1} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" title="Move down">
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setDraft((d) => ({ ...d, presets: d.presets.filter((_, j) => j !== i) }))}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <textarea value={p.question} onChange={(e) => setPreset(i, { question: e.target.value })}
                          rows={2} maxLength={500} placeholder="The question, exactly as the assistant will be asked it"
                          className={`${inputCls} resize-none`} />
                      </div>
                    ))}
                  </div>
                  {draft.presets.length < MAX_PRESETS && (
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({
                        ...d, presets: [...d.presets, { id: crypto.randomUUID().slice(0, 8), label: "", question: "" }],
                      }))}
                      className="mt-3 flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      <Plus className="h-4 w-4" /> Add a question
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-border/50 px-6 py-4">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted">Cancel</button>
              <button onClick={() => void save()} disabled={saving}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {saving ? "Saving..." : "Save role"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDelete(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="glass-card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border/50 px-6 py-5">
              <h2 className="font-serif text-lg font-semibold text-foreground">Delete "{confirmDelete.name}"?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {/* Deleting a role in use would leave its members with NO role — full access. A
                    restriction should never lift as a side effect, so it has to be emptied first. */}
                {inUse(confirmDelete)
                  ? `${memberCounts.get(confirmDelete.id)} member${memberCounts.get(confirmDelete.id) === 1 ? " has" : "s have"} this role. Give them another role first — without one they would have full access.`
                  : "No member has this role."}
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
                {inUse(confirmDelete) ? "OK" : "Cancel"}
              </button>
              {!inUse(confirmDelete) && (
                <button onClick={() => void remove(confirmDelete)} className="rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Delete</button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
