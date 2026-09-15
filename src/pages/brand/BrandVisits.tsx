// Visits — the shop floor's memory, for the people who never stand on it.
//
// Two audiences in one page, deliberately. A store manager opens it to record
// what just happened and leaves in under a minute. A head of CRM opens it to
// see what the floor has been hearing all week: who is owed a call, and the
// reasons sales did not close, which are the only reasons anyone can act on.
//
// The three counters at the top are the page's whole argument: without this,
// the middle one — visits that ended without a sale — is a number no luxury
// house has.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mic, ShoppingBag, CircleSlash, HelpCircle, CalendarClock,
  User, AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import VisitRecorder, { type Visit } from "@/components/visits/VisitRecorder";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

type Row = Visit & {
  shop_id: number | null;
  profiles?: { first_name: string | null; last_name: string | null } | null;
};

const FILTERS = [
  { key: "all", en: "All", it: "Tutte" },
  { key: "not_purchased", en: "Didn't buy", it: "Non hanno comprato" },
  { key: "follow_up", en: "Owed a call", it: "Da richiamare" },
  { key: "draft", en: "Unconfirmed", it: "Da confermare" },
] as const;

const OUTCOME_META = {
  purchased: { icon: ShoppingBag, en: "Bought", it: "Ha comprato", tone: "text-emerald-600" },
  not_purchased: { icon: CircleSlash, en: "Didn't buy", it: "Non ha comprato", tone: "text-muted-foreground" },
  undecided: { icon: HelpCircle, en: "Thinking", it: "Ci pensa", tone: "text-amber-600" },
} as const;

const dayLabel = (iso: string, locale: string) => {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const yday = new Date(today.getTime() - 86400000).toDateString() === d.toDateString();
  if (same) return tt(locale, "Today", "Oggi");
  if (yday) return tt(locale, "Yesterday", "Ieri");
  return d.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
    day: "numeric", month: "short",
  });
};

const BrandVisits = () => {
  const { profile } = useAuth();
  const { locale } = useLanguage();
  const slugPrefix = useAuthSlug();
  const brandId = profile?.brand_id ?? null;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("store_visits" as never)
      .select("*, profiles:customer_id(first_name, last_name)")
      .eq("brand_id", brandId)
      .order("visited_at", { ascending: false })
      .limit(200);
    if (!error) setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const today = new Date().toDateString();
    return {
      today: rows.filter((r) => new Date(r.visited_at).toDateString() === today).length,
      lost: rows.filter((r) => r.outcome === "not_purchased").length,
      owed: rows.filter((r) => r.follow_up_due && r.status === "confirmed").length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "draft") return rows.filter((r) => r.status === "draft");
    if (filter === "follow_up") return rows.filter((r) => r.follow_up_due);
    return rows.filter((r) => r.outcome === filter);
  }, [rows, filter]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 md:mb-8">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            {tt(locale, "Visits", "Visite")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tt(
              locale,
              "What happened on the floor, in the manager's own words — including the visits that ended without a sale.",
              "Cosa è successo in negozio, con le parole di chi c'era — comprese le visite finite senza vendita.",
            )}
          </p>
        </div>
        <Button size="lg" onClick={() => setRecording(true)}>
          <Mic className="mr-2 h-4 w-4" />
          {tt(locale, "New note", "Nuova nota")}
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { n: counts.today, en: "visits today", it: "visite oggi" },
          { n: counts.lost, en: "ended without a sale", it: "finite senza vendita" },
          { n: counts.owed, en: "waiting on a call", it: "in attesa di un contatto" },
        ].map((c) => (
          <div key={c.en} className="glass-card px-4 py-3">
            <p className="font-serif text-2xl font-bold tabular-nums">{c.n}</p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {tt(locale, c.en, c.it)}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === f.key
                ? "border-primary bg-primary/5 font-medium"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {tt(locale, f.en, f.it)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="glass-card h-24 animate-pulse" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Mic className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? tt(locale, "No visits recorded yet.", "Nessuna visita registrata.")
              : tt(locale, "Nothing under this filter.", "Niente con questo filtro.")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r, i) => {
            const meta = r.outcome ? OUTCOME_META[r.outcome] : null;
            const name = r.profiles
              ? [r.profiles.first_name, r.profiles.last_name].filter(Boolean).join(" ")
              : r.customer_said;
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                className="glass-card p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {meta && (
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${meta.tone}`}>
                      <meta.icon className="h-3.5 w-3.5" />
                      {tt(locale, meta.en, meta.it)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    · {dayLabel(r.visited_at, locale)}
                  </span>
                  {r.status === "draft" && (
                    <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
                      {tt(locale, "Unconfirmed", "Da confermare")}
                    </Badge>
                  )}
                </div>

                <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.customer_id ? (
                    <Link
                      to={`${slugPrefix}/customers/${r.customer_id}`}
                      className="hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span>
                      {name ?? tt(locale, "Walk-in", "Cliente di passaggio")}
                    </span>
                  )}
                </div>

                {r.summary && (
                  <p className="text-sm leading-relaxed text-foreground/90">{r.summary}</p>
                )}

                {r.objection && (
                  <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{r.objection}</span>
                  </p>
                )}

                {(r.follow_up || r.follow_up_due) && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{r.follow_up}</span>
                    {r.follow_up_due && (
                      <Badge variant="outline" className="text-[10px]">{r.follow_up_due}</Badge>
                    )}
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {tt(locale, "New visit", "Nuova visita")}
            </DialogTitle>
          </DialogHeader>
          {brandId && (
            <VisitRecorder
              brandId={brandId}
              locale={locale}
              onSaved={() => { setRecording(false); void load(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BrandVisits;
