import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { supabase } from "@/integrations/supabase/client";
// The standalone `toast`, not `useToast().toast` — the hook returns a fresh object every
// render, so a fetcher that depends on it never stops re-running.
import { toast } from "@/hooks/use-toast";
import { Check, Loader2, MessageSquare, X, Sparkles, BadgeCheck, AlertCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  checklistProgress, isItemDone, itemBlockedBecause, filterChecklist, blockingItems,
  CHECKLIST_FILTERS,
  type ChecklistState, type ChecklistSignals, type ChecklistFilter,
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

export default function GoLiveChecklist(
  { brandId, brandName, onBrandChanged }:
  { brandId: number; brandName: string | null; onBrandChanged?: () => void },
) {
  const [state, setState] = useState<ChecklistState>({});
  const [signals, setSignals] = useState<ChecklistSignals>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [admins, setAdmins] = useState<Record<string, string>>({});
  // The one item on this list that can be closed from here. Everything else is either
  // observed or a tick; this is a decision, and it is two clicks away on another tab.
  const [verifying, setVerifying] = useState(false);
  const [verifySaving, setVerifySaving] = useState(false);
  // Lands on what is LEFT. Thirty-three rows of mostly-ticked boxes is not an answer to
  // "what is stopping us", which is the only question anyone opens this tab with.
  const [filter, setFilter] = useState<ChecklistFilter>("todo");

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

  const markVerified = async () => {
    setVerifySaving(true);
    const { error } = await untyped.from("brands").update({ status: "verified" } as never).eq("id", brandId);
    setVerifySaving(false);
    setVerifying(false);
    if (error) {
      toast({ title: "Could not verify the brand", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `${brandName ?? "The brand"} is verified`,
      description: "It now appears on the portal's brand picker and in the AION dashboards.",
    });
    // Both views are stale: the signal this screen reads, and the status badge in the page
    // header above it.
    void load();
    onBrandChanged?.();
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
        <Skeleton className="h-24 w-full rounded-xl" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }

  const { done, total, blockingLeft, detected } = checklistProgress(state, signals);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const blocking = blockingItems(state, signals);
  const groups = filterChecklist(filter, state, signals);
  const left = total - done;
  const counts: Record<ChecklistFilter, number> = { todo: left, blocking: blockingLeft, all: total };
  const nothingToShow = groups.every((g) => g.items.length === 0);

  return (
    <div className="space-y-4">
      {/* WHERE THIS BRAND STANDS.
          One card, and the blocking items are NAMED in it. The old header said "3 blocking
          items left" and left the reader to find them among thirty-three rows in six
          groups, which is the one question this screen exists to answer. */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-lg text-foreground">
              {blockingLeft > 0
                ? `${brandName ?? "This brand"} is not ready to go live`
                : left > 0
                ? `Nothing is blocking ${brandName ?? "this brand"}`
                : `${brandName ?? "This brand"} is ready`}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {blockingLeft > 0
                ? "These have to be true before it can issue a real cover."
                : left > 0
                ? `${left} ${left === 1 ? "item is" : "items are"} still open, none of them blocking.`
                : "Every item on the list is behind you."}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-serif text-2xl tabular-nums text-foreground">{done}<span className="text-base text-muted-foreground">/{total}</span></p>
            {detected > 0 && (
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Sparkles className="h-2.5 w-2.5 text-primary" /> {detected} detected
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full transition-all ${blockingLeft > 0 ? "bg-primary" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }} />
        </div>

        {/* The blocking items, by name, one click from the thing itself. */}
        {blocking.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {blocking.map(({ item, because }) => (
              <button key={item.key} type="button" onClick={() => setFilter("blocking")} title={because ?? item.detail}
                className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10">
                <AlertCircle className="h-3 w-3" /> {item.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* WHAT TO SHOW. Lands on what is left, not on everything. */}
      <div className="flex flex-wrap items-center gap-1">
        {CHECKLIST_FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.value
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"}`}>
            {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      {nothingToShow && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
          <Check className="mx-auto h-6 w-6 text-emerald-600" />
          <p className="mt-2 text-sm font-medium text-foreground">
            {filter === "blocking" ? "Nothing is blocking this brand." : "Nothing left to do."}
          </p>
          <button type="button" onClick={() => setFilter("all")}
            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">
            Show the whole list
          </button>
        </div>
      )}

      {groups.map(({ group, items, done: gDone, total: gTotal, settled }) => {
        // A group with nothing to show under this filter collapses to its own one line.
        // Six of those is a summary of the house; six expanded lists is a wall.
        if (!items.length) {
          if (nothingToShow) return null;
          return (
            <div key={group.key} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{group.letter}</span>
              <span className="text-muted-foreground">{group.title}</span>
              <span className="ml-auto inline-flex items-center gap-1.5 tabular-nums text-muted-foreground">
                {gDone}/{gTotal}
                {settled && <Check className="h-3.5 w-3.5 text-emerald-600" />}
              </span>
            </div>
          );
        }
        return (
          <div key={group.key} className="rounded-xl border border-border">
            <div className="flex items-baseline gap-3 border-b border-border px-4 py-2.5">
              <span className="font-mono text-[10px] tracking-widest text-primary">{group.letter}</span>
              <h4 className="text-sm font-semibold text-foreground">{group.title}</h4>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{gDone}/{gTotal}</span>
            </div>

            <ul className="divide-y divide-border/70">
              {items.map((item) => {
                const row = state[item.key];
                const auto = signals[item.key] === true;
                const because = itemBlockedBecause(item.key, signals);
                const isDone = isItemDone(item.key, state, signals);
                const who = row?.updated_by ? admins[row.updated_by] : null;
                return (
                  <li key={item.key} className="px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      {/* An item the platform can see is not a thing to click: un-ticking a
                          premium that is demonstrably set would be a lie the next reload
                          corrects. */}
                      <button
                        type="button" role="checkbox" aria-checked={isDone} aria-label={item.title}
                        aria-disabled={auto} disabled={auto}
                        title={auto ? `Confirmed by the platform: ${item.evidence}` : undefined}
                        onClick={() => void save(item.key, { done: !isDone })}
                        className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border transition-colors ${
                          isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-input bg-background hover:border-primary"
                        } ${auto ? "cursor-default" : ""}`}
                      >
                        {saving === item.key ? <Loader2 className="h-3 w-3 animate-spin" />
                          : isDone ? <Check className="h-3 w-3" /> : null}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className={`text-sm ${isDone ? "text-muted-foreground line-through" : "font-medium text-foreground"}`}>
                            {item.title}
                          </p>
                          {item.blocking && !isDone && (
                            <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">blocking</span>
                          )}
                          {auto && (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              <Sparkles className="h-2.5 w-2.5" /> detected
                            </span>
                          )}
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {row?.updated_at && (
                              <span className="text-[10px] text-muted-foreground">
                                {isDone ? "done" : "updated"} {new Date(row.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                {who ? ` · ${who}` : ""}
                              </span>
                            )}
                            <button type="button" onClick={() => (noteFor === item.key ? setNoteFor(null) : openNote(item.key))}
                              title={row?.note ? "Edit the note" : "Add a note"}
                              className={`rounded p-1 hover:bg-muted ${row?.note ? "text-primary" : "text-muted-foreground/60"}`}>
                              <MessageSquare className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </div>

                        {/* ONE line of explanation, and only the one worth reading.
                            A diagnosis beats the item's own phrase, which can only restate
                            the requirement. The "checks for" line is for the full list
                            only: under a filtered view it is noise between things to do. */}
                        {because ? (
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">{because}</p>
                        ) : !isDone ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                        ) : filter === "all" && auto && item.evidence ? (
                          <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">✓ {item.evidence}</p>
                        ) : null}

                        {/* Publishing the brand is the only item here that can be closed
                            from this screen. It otherwise sits on the Record tab behind a
                            dropdown and a Save. */}
                        {item.key === "brand_verified" && !isDone && (
                          <button type="button" onClick={() => setVerifying(true)}
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
                            <BadgeCheck className="h-3.5 w-3.5" /> Mark verified
                          </button>
                        )}

                        {noteFor === item.key ? (
                          <div className="mt-2 flex items-start gap-2">
                            <textarea id={`note-${item.key}`} autoFocus rows={2} value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              placeholder="What is the state of this, and who is waiting on what?"
                              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs" />
                            <button type="button" onClick={() => void commitNote()}
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Save</button>
                            <button type="button" onClick={() => setNoteFor(null)} aria-label="Discard note"
                              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : row?.note ? (
                          <button type="button" onClick={() => openNote(item.key)}
                            className="mt-1.5 block w-full rounded-md border-l-2 border-primary bg-muted/40 px-2.5 py-1.5 text-left text-xs text-foreground">
                            {row.note}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Named consequences, because this is the switch that makes a brand public and the
          reader may well be looking at a prospect or a test record. */}
      <Dialog open={verifying} onOpenChange={(o) => { if (!o) setVerifying(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Verify {brandName ?? "this brand"}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>Verified is what publishes a brand. Once it is set:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>the portal's brand picker shows it to anonymous visitors</li>
                  <li>it is counted in the AION dashboards, insights and reports</li>
                  <li>it becomes selectable when recording covers and claims</li>
                </ul>
                <p>Reversible from the Record tab.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setVerifying(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
            <button type="button" disabled={verifySaving} onClick={() => void markVerified()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {verifySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
              Verify
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
