// What the assistant made of a visit, shown in the conversation that produced it.
//
// The manager talks; the assistant files a DRAFT and this card appears in the
// chat. That draft is not a formality. An assistant that silently writes client
// history is a liability, and a manager who has to correct it twice stops using
// it — so the confirm button is the loud one, everything on the card is
// editable before it, and nothing downstream reads a draft as fact.
//
// Confirming is also the moment the visit becomes KNOWLEDGE: the edge function
// writes it into the brand's knowledge base, so "why are people walking away
// from the quilted bag" can be answered months later from what the floor said.

import { useState } from "react";
import {
  ShoppingBag, CircleSlash, HelpCircle, CalendarClock, User,
  Check, X, Pencil, Loader2, Library,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

export type VisitItem = {
  product?: string | null;
  sku?: string | null;
  size?: string | null;
  colour?: string | null;
  reaction?: string | null;
};

export type Visit = {
  id: string;
  brand_id: number;
  customer_id: string | null;
  customer_said: string | null;
  match_confidence: "exact" | "likely" | "none" | null;
  visited_at: string;
  transcript: string | null;
  outcome: "purchased" | "not_purchased" | "undecided" | null;
  summary: string | null;
  items: VisitItem[] | null;
  objection: string | null;
  occasion: string | null;
  sentiment: string | null;
  follow_up: string | null;
  follow_up_due: string | null;
  tags: string[] | null;
  status: "draft" | "confirmed" | "failed";
  needs_review: boolean;
};

const OUTCOMES = [
  { value: "purchased" as const, icon: ShoppingBag, en: "Bought", it: "Ha comprato" },
  { value: "undecided" as const, icon: HelpCircle, en: "Thinking about it", it: "Ci sta pensando" },
  { value: "not_purchased" as const, icon: CircleSlash, en: "Didn't buy", it: "Non ha comprato" },
];

const VisitCard = ({ visit: initial, locale }: { visit: Visit; locale: string }) => {
  const [visit, setVisit] = useState<Visit>(initial);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<null | "confirmed" | "discarded">(
    initial.status === "confirmed" ? "confirmed" : null,
  );

  const patch = (fields: Partial<Visit>) => setVisit((v) => ({ ...v, ...fields }));

  const confirm = async () => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("visit-note", {
      body: {
        action: "confirm",
        visit_id: visit.id,
        outcome: visit.outcome,
        summary: visit.summary,
        objection: visit.objection,
        follow_up: visit.follow_up,
        follow_up_due: visit.follow_up_due || null,
        customer_id: visit.customer_id,
      },
    });
    setSaving(false);
    const res = data as { error?: string; knowledge?: { indexed?: boolean } } | null;
    if (error || res?.error) {
      toast.error(tt(locale, "Couldn't save.", "Salvataggio non riuscito.") + ` ${res?.error ?? error?.message ?? ""}`);
      return;
    }
    setDone("confirmed");
    toast.success(
      res?.knowledge?.indexed
        ? tt(locale, "Visit saved, and added to what the assistant knows.", "Visita salvata, e aggiunta a ciò che l'assistente sa.")
        : tt(locale, "Visit saved.", "Visita salvata."),
    );
  };

  const discard = async () => {
    await supabase.from("store_visits" as never).delete().eq("id", visit.id);
    setDone("discarded");
  };

  if (done === "discarded") {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
        {tt(locale, "Discarded — nothing was saved.", "Scartata — non è stato salvato niente.")}
      </p>
    );
  }

  const items = Array.isArray(visit.items) ? visit.items : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 rounded-xl border border-border bg-background/60 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {done === "confirmed"
              ? tt(locale, "Visit recorded", "Visita registrata")
              : tt(locale, "Is this right?", "È andata così?")}
          </h3>
          {done !== "confirmed" && (
            <p className="text-[11px] text-muted-foreground">
              {tt(locale, "Nothing is saved until you confirm.", "Niente viene salvato finché non confermi.")}
            </p>
          )}
        </div>
        {done === "confirmed" ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Library className="h-3 w-3" />
            {tt(locale, "In the CRM", "Nel CRM")}
          </Badge>
        ) : visit.needs_review ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
            {tt(locale, "Check this", "Da controllare")}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {OUTCOMES.map((o) => {
          const active = visit.outcome === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={done === "confirmed"}
              onClick={() => patch({ outcome: o.value })}
              className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[11px] transition-colors disabled:opacity-60 ${
                active
                  ? "border-primary bg-primary/5 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <o.icon className="h-4 w-4" />
              {tt(locale, o.en, o.it)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">
          {visit.customer_said ?? tt(locale, "Someone we don't know yet", "Qualcuno che non conosciamo ancora")}
        </span>
        {visit.match_confidence === "exact" && visit.customer_id && (
          <Badge variant="secondary" className="text-[10px]">{tt(locale, "In the CRM", "Nel CRM")}</Badge>
        )}
        {visit.match_confidence === "likely" && done !== "confirmed" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{tt(locale, "Same person?", "Stessa persona?")}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => patch({ match_confidence: "exact" })}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => patch({ customer_id: null, match_confidence: "none" })}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {visit.summary && <p className="text-sm leading-relaxed">{visit.summary}</p>}

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{it.product}</span>
                {it.sku && <span className="font-mono text-[10px] text-muted-foreground">{it.sku}</span>}
              </div>
              <div className="text-muted-foreground">
                {[it.size, it.colour, it.reaction].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tt(locale, "Why it didn't close", "Perché non si è chiusa")}
          </label>
          {editing ? (
            <Textarea rows={2} value={visit.objection ?? ""} onChange={(e) => patch({ objection: e.target.value })} />
          ) : (
            <p className="text-sm">{visit.objection ?? <span className="text-muted-foreground">—</span>}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tt(locale, "Next step", "Prossimo passo")}
          </label>
          {editing ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input className="flex-1" value={visit.follow_up ?? ""} onChange={(e) => patch({ follow_up: e.target.value })} />
              <Input type="date" className="sm:w-40" value={visit.follow_up_due ?? ""} onChange={(e) => patch({ follow_up_due: e.target.value })} />
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {visit.follow_up ?? <span className="text-muted-foreground">—</span>}
              {visit.follow_up_due && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <CalendarClock className="h-3 w-3" />{visit.follow_up_due}
                </Badge>
              )}
            </p>
          )}
        </div>
      </div>

      {(visit.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(visit.tags ?? []).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
          ))}
        </div>
      )}

      {done !== "confirmed" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="flex-1" onClick={() => void confirm()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {tt(locale, "Confirm", "Conferma")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
            <Pencil className="mr-2 h-4 w-4" />
            {editing ? tt(locale, "Done", "Fatto") : tt(locale, "Correct", "Correggi")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void discard()}>
            {tt(locale, "Discard", "Scarta")}
          </Button>
        </div>
      )}
    </motion.div>
  );
};

export default VisitCard;
