// The minute after the client leaves.
//
// One screen, held in one hand, with one thing on it at a time: talk, then read
// back what we understood, then confirm. The manager should never be asked to
// fill a form — if they wanted to fill a form, the visit would already be in
// the CRM and this feature would not need to exist.
//
// The card that comes back is a DRAFT until they confirm it. That is not a
// formality: an assistant that silently writes client history is a liability,
// and a manager who has to correct it twice stops using it. So the confirm
// button is the loud one, and everything on the card is editable before it.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic, Square, Loader2, Check, X, ShoppingBag, CircleSlash,
  HelpCircle, CalendarClock, User, Pencil, Keyboard,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { createDictation, isDictationSupported, dictationLang, type Dictation } from "@/lib/speech";

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

type Stage = "idle" | "listening" | "structuring" | "review";

const OUTCOMES = [
  { value: "purchased" as const, icon: ShoppingBag, en: "Bought", it: "Ha comprato" },
  { value: "undecided" as const, icon: HelpCircle, en: "Thinking about it", it: "Ci sta pensando" },
  { value: "not_purchased" as const, icon: CircleSlash, en: "Didn't buy", it: "Non ha comprato" },
];

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const VisitRecorder = ({
  brandId,
  locale,
  onSaved,
}: {
  brandId: number;
  locale: string;
  onSaved?: (visit: Visit) => void;
}) => {
  const [stage, setStage] = useState<Stage>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [typing, setTyping] = useState(false);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const dictation = useRef<Dictation | null>(null);
  const timer = useRef<number | null>(null);
  const supported = isDictationSupported();

  useEffect(() => () => {
    dictation.current?.stop();
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  const structure = useCallback(async (text: string, source: "voice" | "typed") => {
    const said = text.trim();
    if (said.length < 10) {
      toast.error(tt(locale, "I didn't catch enough to work with.", "Non ho sentito abbastanza per lavorarci."));
      setStage("idle");
      return;
    }
    setStage("structuring");
    try {
      const { data, error } = await supabase.functions.invoke("visit-note", {
        body: { brand_id: brandId, transcript: said, source },
      });
      const res = data as { visit?: Visit; error?: string } | null;
      if (error || res?.error || !res?.visit) {
        throw new Error(res?.error ?? error?.message ?? "no card came back");
      }
      setVisit(res.visit);
      setStage("review");
    } catch (e) {
      toast.error(
        tt(locale, "Couldn't organise that note.", "Non sono riuscito a organizzare la nota.") +
          ` ${e instanceof Error ? e.message : ""}`,
      );
      setStage("idle");
    }
  }, [brandId, locale]);

  const start = () => {
    setTranscript("");
    setInterim("");
    setSeconds(0);
    setStage("listening");
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    const d = createDictation(dictationLang(locale), {
      onTranscript: (full, partial) => { setTranscript(full); setInterim(partial); },
      onError: (code) => {
        if (code === "denied") {
          toast.error(tt(locale, "The browser blocked the microphone.", "Il browser ha bloccato il microfono."));
        } else if (code === "unsupported") {
          toast.error(tt(locale, "This browser can't listen — type it instead.", "Questo browser non ascolta — scrivila."));
          setTyping(true);
        }
        stopListening(false);
      },
    });
    dictation.current = d;
    d.start();
  };

  const stopListening = (thenStructure = true) => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    dictation.current?.stop();
    const said = `${dictation.current?.text() ?? transcript} ${interim}`.trim();
    dictation.current = null;
    setInterim("");
    if (thenStructure) void structure(said, "voice");
    else setStage("idle");
  };

  const patch = (fields: Partial<Visit>) =>
    setVisit((v) => (v ? { ...v, ...fields } : v));

  const confirm = async () => {
    if (!visit) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("store_visits" as never)
      .update({
        outcome: visit.outcome,
        customer_id: visit.customer_id,
        objection: visit.objection,
        follow_up: visit.follow_up,
        follow_up_due: visit.follow_up_due || null,
        summary: visit.summary,
        status: "confirmed",
        needs_review: false,
        confirmed_at: new Date().toISOString(),
      } as never)
      .eq("id", visit.id)
      .select()
      .maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(tt(locale, "Couldn't save.", "Salvataggio non riuscito.") + ` ${error.message}`);
      return;
    }
    toast.success(tt(locale, "Visit saved.", "Visita salvata."));
    onSaved?.((data ?? visit) as Visit);
    setVisit(null);
    setTranscript("");
    setEditing(false);
    setStage("idle");
  };

  const discard = async () => {
    if (visit) await supabase.from("store_visits" as never).delete().eq("id", visit.id);
    setVisit(null);
    setTranscript("");
    setEditing(false);
    setStage("idle");
  };

  // ── Idle / listening ───────────────────────────────────────────────────────
  if (stage !== "review") {
    return (
      <div className="flex flex-col items-center gap-6 py-8">
        <AnimatePresence mode="wait">
          {stage === "structuring" ? (
            <motion.div
              key="structuring"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 text-center"
            >
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {tt(locale, "Organising the visit…", "Sto organizzando la visita…")}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="mic"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                {stage === "listening"
                  ? tt(locale, "Listening — talk the way you'd tell a colleague.", "Ti ascolto — racconta come lo diresti a un collega.")
                  : tt(locale, "The client has just left. Say how it went.", "Il cliente è appena uscito. Racconta com'è andata.")}
              </p>

              {typing || !supported ? (
                <div className="w-full max-w-md space-y-3">
                  <Textarea
                    rows={5}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder={tt(
                      locale,
                      "e.g. Mrs Bianchi came back for the black quilted bag, tried the 38 in the coat too, didn't buy — waiting for her husband to see it. Said she'd come back Saturday.",
                      "es. È tornata la signora Bianchi per la borsa trapuntata nera, ha provato anche il cappotto 38, non ha comprato — aspetta che lo veda il marito. Ha detto che torna sabato.",
                    )}
                  />
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => void structure(transcript, "typed")}>
                      {tt(locale, "Organise it", "Organizzala")}
                    </Button>
                    {supported && (
                      <Button variant="ghost" onClick={() => setTyping(false)}>
                        <Mic className="mr-2 h-4 w-4" />
                        {tt(locale, "Speak", "Parla")}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => (stage === "listening" ? stopListening() : start())}
                    className={`relative flex h-24 w-24 items-center justify-center rounded-full transition-colors ${
                      stage === "listening"
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    }`}
                    aria-label={stage === "listening" ? tt(locale, "Stop", "Ferma") : tt(locale, "Record", "Registra")}
                  >
                    {stage === "listening" && (
                      <motion.span
                        className="absolute inset-0 rounded-full bg-destructive/30"
                        animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1.8, repeat: Infinity }}
                      />
                    )}
                    {stage === "listening"
                      ? <Square className="h-8 w-8" />
                      : <Mic className="h-9 w-9" />}
                  </button>

                  {stage === "listening" ? (
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {mmss(seconds)}
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setTyping(true)}>
                      <Keyboard className="mr-2 h-4 w-4" />
                      {tt(locale, "Type it instead", "Scrivila invece")}
                    </Button>
                  )}
                </>
              )}

              {stage === "listening" && (transcript || interim) && (
                <p className="max-w-md rounded-lg bg-muted/50 px-4 py-3 text-center text-sm leading-relaxed">
                  {transcript}{" "}
                  <span className="text-muted-foreground">{interim}</span>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  if (!visit) return null;
  const items = Array.isArray(visit.items) ? visit.items : [];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">
            {tt(locale, "Is this right?", "È andata così?")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tt(locale, "Nothing is saved until you confirm.", "Niente viene salvato finché non confermi.")}
          </p>
        </div>
        {visit.needs_review && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600">
            {tt(locale, "Check this", "Da controllare")}
          </Badge>
        )}
      </div>

      {/* Outcome — the field the whole record exists for, so it is the first
          thing on the card and always one tap from being corrected. */}
      <div className="grid grid-cols-3 gap-2">
        {OUTCOMES.map((o) => {
          const active = visit.outcome === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => patch({ outcome: o.value })}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs transition-colors ${
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

      {/* Who */}
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">
          {visit.customer_said ?? tt(locale, "Someone we don't know yet", "Qualcuno che non conosciamo ancora")}
        </span>
        {visit.match_confidence === "exact" && (
          <Badge variant="secondary" className="text-[10px]">
            {tt(locale, "In the CRM", "Nel CRM")}
          </Badge>
        )}
        {visit.match_confidence === "likely" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">
              {tt(locale, "Same person?", "Stessa persona?")}
            </span>
            <Button size="icon" variant="ghost" className="h-6 w-6"
              onClick={() => patch({ match_confidence: "exact" })}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6"
              onClick={() => patch({ customer_id: null, match_confidence: "none" })}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {visit.summary && (
        <p className="text-sm leading-relaxed">{visit.summary}</p>
      )}

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{it.product}</span>
                {it.sku && <span className="font-mono text-[10px] text-muted-foreground">{it.sku}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {[it.size, it.colour, it.reaction].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The objection, and the promise. Editable in place — these are the two
          the manager most often wants to put in their own words. */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tt(locale, "Why it didn't close", "Perché non si è chiusa")}
          </label>
          {editing ? (
            <Textarea rows={2} value={visit.objection ?? ""}
              onChange={(e) => patch({ objection: e.target.value })} />
          ) : (
            <p className="text-sm">
              {visit.objection ?? <span className="text-muted-foreground">—</span>}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tt(locale, "Next step", "Prossimo passo")}
          </label>
          {editing ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input className="flex-1" value={visit.follow_up ?? ""}
                onChange={(e) => patch({ follow_up: e.target.value })} />
              <Input type="date" className="sm:w-40" value={visit.follow_up_due ?? ""}
                onChange={(e) => patch({ follow_up_due: e.target.value })} />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              {visit.follow_up ?? <span className="text-muted-foreground">—</span>}
              {visit.follow_up_due && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <CalendarClock className="h-3 w-3" />
                  {visit.follow_up_due}
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

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          {tt(locale, "What I heard", "Quello che ho sentito")}
        </summary>
        <p className="mt-2 leading-relaxed">{visit.transcript}</p>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" onClick={() => void confirm()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          {tt(locale, "Confirm", "Conferma")}
        </Button>
        <Button variant="outline" onClick={() => setEditing((e) => !e)}>
          <Pencil className="mr-2 h-4 w-4" />
          {editing ? tt(locale, "Done", "Fatto") : tt(locale, "Correct", "Correggi")}
        </Button>
        <Button variant="ghost" onClick={() => void discard()}>
          {tt(locale, "Discard", "Scarta")}
        </Button>
      </div>
    </motion.div>
  );
};

export default VisitRecorder;
