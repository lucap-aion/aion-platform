import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { supabase } from "@/integrations/supabase/client";
// The standalone `toast`, not `useToast().toast` — the hook returns a fresh object every
// render, so a fetcher that depends on it never stops re-running.
import { toast } from "@/hooks/use-toast";
import { Check, Loader2, MessageSquare, X, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GO_LIVE_CHECKLIST, checklistProgress, isItemDone, itemBlockedBecause,
  type ChecklistState, type ChecklistSignals,
} from "@/lib/goLiveChecklist";

// What has to be true before a brand can issue a real cover — shared across AION admins.
//
// This used to be a document, which meant it was one person's copy of a document: two
// admins working the same brand could not see what the other had closed, and nothing
// recorded when an item was done. The state now lives next to the brand, so opening this
// tab shows the same thing to everyone.
//
// The item list itself is in code (src/lib/goLiveChecklist.ts) so brands pick up new items
// automatically; only what has been DONE is stored. An item with no row is untouched.
//
// Eighteen of the items no longer need a tick at all. "Set the insurance premium" is a number
// on the brand record, "Write and load the FAQ" is two jsonb columns, "Assign the policy
// number prefix" is a five-character string — brand_golive_signals() reads all of them and
// this screen shows them as done, with the evidence, the moment they are true. Asking a
// person to confirm what the database already says produced a checklist that disagreed with
// the platform as soon as anything changed, and a launch where nobody trusted either.

type Row = {
  item_key: string;
  done: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
};

export default function GoLiveChecklist({ brandId, brandName }: { brandId: number; brandName: string | null }) {
  const [state, setState] = useState<ChecklistState>({});
  const [signals, setSignals] = useState<ChecklistSignals>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [admins, setAdmins] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await untyped
      .from("brand_golive_checklist")
      .select("item_key, done, note, updated_at, updated_by")
      .eq("brand_id", brandId);
    if (error) {
      toast({ title: "Could not load the checklist", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const next: ChecklistState = {};
    for (const r of (data ?? []) as Row[]) {
      next[r.item_key] = { done: r.done, note: r.note, updated_at: r.updated_at, updated_by: r.updated_by };
    }
    setState(next);

    // What the platform can see for itself. A failure here is not a failure of the screen:
    // the manual ticks still render, and every derivable item simply falls back to needing
    // one, which is how this worked before.
    const { data: detected, error: signalError } = await untyped.rpc("brand_golive_signals", { p_brand_id: brandId });
    if (signalError) {
      toast({
        title: "Could not read what is already done",
        description: `${signalError.message} — every item is showing as a manual tick.`,
        variant: "destructive",
      });
      setSignals({});
    } else {
      setSignals((detected ?? {}) as ChecklistSignals);
    }
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  // Who ticked what. Resolved once, so a row can say a name instead of a uuid.
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      const { data } = await untyped.from("profiles").select("user_id, first_name, last_name").eq("role", "admin");
      const map: Record<string, string> = {};
      for (const p of (data ?? []) as { user_id: string | null; first_name: string | null; last_name: string | null }[]) {
        if (p.user_id) map[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(" ") || "AION";
      }
      setAdmins(map);
    })();
  }, []);

  const save = async (itemKey: string, patch: { done?: boolean; note?: string | null }) => {
    const current = state[itemKey];
    const row = {
      brand_id: brandId,
      item_key: itemKey,
      done: patch.done !== undefined ? patch.done : current?.done ?? false,
      note: patch.note !== undefined ? patch.note : current?.note ?? null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    // Optimistic: a checkbox that waits on a round trip feels broken.
    setState((s) => ({ ...s, [itemKey]: { done: row.done, note: row.note, updated_at: row.updated_at, updated_by: row.updated_by } }));
    setSaving(itemKey);
    const { error } = await untyped
      .from("brand_golive_checklist")
      .upsert(row as never, { onConflict: "brand_id,item_key" });
    setSaving(null);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      void load();
    }
  };

  const openNote = (itemKey: string) => {
    setNoteFor(itemKey);
    setNoteDraft(state[itemKey]?.note ?? "");
  };

  const commitNote = async () => {
    if (!noteFor) return;
    const key = noteFor;
    setNoteFor(null);
    await save(key, { note: noteDraft.trim() || null });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  const { done, total, blockingLeft, detected } = checklistProgress(state, signals);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Where this brand stands */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Go-live checklist</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What has to be true before {brandName ?? "this brand"} can issue a real cover. Shared across AION admins.
            </p>
            {detected > 0 && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary" />
                {detected} {detected === 1 ? "item is" : "items are"} confirmed by the platform itself and update as the work lands
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-foreground">{done} / {total}</p>
            {blockingLeft > 0 ? (
              <p className="text-xs text-destructive">{blockingLeft} blocking {blockingLeft === 1 ? "item" : "items"} left</p>
            ) : (
              <p className="text-xs text-emerald-600">nothing blocking left</p>
            )}
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${blockingLeft > 0 ? "bg-primary" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {GO_LIVE_CHECKLIST.map((group) => {
        const gDone = group.items.filter((i) => isItemDone(i.key, state, signals)).length;
        return (
          <div key={group.key}>
            <div className="flex items-baseline gap-3 border-b border-foreground/80 pb-1.5">
              <span className="font-mono text-[11px] tracking-widest text-primary">{group.letter}</span>
              <h4 className="text-sm font-semibold text-foreground">{group.title}</h4>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {gDone}/{group.items.length}
              </span>
            </div>

            <ul className="divide-y divide-border">
              {group.items.map((item) => {
                const row = state[item.key];
                const auto = signals[item.key] === true;
                // What the platform says is missing, when it can be specific. Beats the
                // item's own phrase, which can only restate the whole requirement.
                const because = itemBlockedBecause(item.key, signals);
                const isDone = isItemDone(item.key, state, signals);
                const who = row?.updated_by ? admins[row.updated_by] : null;
                return (
                  <li key={item.key} className="py-3">
                    <div className="flex items-start gap-3">
                      {/* An item the platform can see is not a thing to click: un-ticking a
                          premium that is demonstrably set would be a lie the next reload
                          corrects. It shows as done, and says why. */}
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isDone}
                        aria-label={item.title}
                        aria-disabled={auto}
                        disabled={auto}
                        title={auto ? `Confirmed by the platform: ${item.evidence}` : undefined}
                        onClick={() => void save(item.key, { done: !isDone })}
                        className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition-colors ${
                          isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-input bg-background hover:border-primary"
                        } ${auto ? "cursor-default" : ""}`}
                      >
                        {saving === item.key
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : isDone ? <Check className="h-3 w-3" /> : null}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`text-sm font-medium ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>
                            {item.title}
                          </p>
                          {item.blocking && !isDone && (
                            <span className="rounded border border-destructive px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">
                              blocking
                            </span>
                          )}
                          {auto && (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              <Sparkles className="h-2.5 w-2.5" /> detected
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                        {/* Three different things to say, and they are not the same sentence.
                            Done: the evidence, so "detected" is checkable rather than magic.
                            Blocked with a diagnosis: the diagnosis, in amber, because it is
                            the one line that tells the reader what to go and do — and it
                            shows even on an item somebody ticked by hand, since a tick that
                            disagrees with the platform is exactly the drift worth seeing.
                            Neither: what the platform is watching for, phrased as a check
                            rather than as a claim — the evidence is written in the done
                            tense, and reading it under an empty box looked like a lie. */}
                        {auto ? (
                          <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">✓ {item.evidence}</p>
                        ) : because ? (
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">{because}</p>
                        ) : item.evidence ? (
                          <p className="mt-0.5 text-xs text-muted-foreground/80">Checks for: {item.evidence}</p>
                        ) : null}

                        {noteFor === item.key ? (
                          <div className="mt-2 flex items-start gap-2">
                            <textarea
                              id={`note-${item.key}`}
                              autoFocus
                              rows={2}
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              placeholder="What is the state of this, and who is waiting on what?"
                              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                            />
                            <button type="button" onClick={() => void commitNote()}
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Save</button>
                            <button type="button" onClick={() => setNoteFor(null)}
                              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted" aria-label="Discard note">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : row?.note ? (
                          <button type="button" onClick={() => openNote(item.key)}
                            className="mt-1.5 block w-full rounded-md border-l-2 border-primary bg-muted/50 px-2.5 py-1.5 text-left text-xs text-foreground">
                            {row.note}
                          </button>
                        ) : null}

                        {(row?.updated_at || !row?.note) && (
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                            {noteFor !== item.key && !row?.note && (
                              <button type="button" onClick={() => openNote(item.key)}
                                className="inline-flex items-center gap-1 hover:text-foreground">
                                <MessageSquare className="h-3 w-3" /> Add a note
                              </button>
                            )}
                            {row?.updated_at && (
                              <span>
                                {isDone ? "Done" : "Updated"} {new Date(row.updated_at).toLocaleDateString()}
                                {who ? ` · ${who}` : ""}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
