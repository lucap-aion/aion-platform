// CustomerTravel — "travel mode" for customers. Declare an upcoming trip so
// the brand's clienteling team knows you'll be wearing your piece abroad
// (and can reach out before you leave, suggest local boutiques, share
// region-specific care tips, etc.). RLS lets the brand SELECT their own
// customers' trips — they don't see strangers'.

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Plane, MapPin, Calendar, Trash2, Plus, Loader2, AlertCircle,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import SearchableSelect from "@/components/SearchableSelect";
import { COUNTRIES } from "@/utils/countries";

type Trip = {
  id: number;
  destination_country: string;
  destination_city: string | null;
  start_date: string;
  end_date: string | null;
  notes: string | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const CustomerTravel = () => {
  const { profile } = useAuth();
  const { t, locale } = useLanguage();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    country: "",
    city: "",
    start: "",
    end: "",
    notes: "",
  });

  const { data: trips, isLoading } = useQuery({
    queryKey: ["customer-trips", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_trips")
        .select("id, destination_country, destination_city, start_date, end_date, notes")
        .eq("customer_id", profile!.id)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Trip[];
    },
    enabled: !!profile?.id,
    staleTime: 60 * 1000,
  });

  const today = todayIso();
  const upcoming = (trips ?? []).filter((tr) => (tr.end_date ?? tr.start_date) >= today);
  const past = (trips ?? []).filter((tr) => (tr.end_date ?? tr.start_date) < today);

  const resetForm = () => setForm({ country: "", city: "", start: "", end: "", notes: "" });

  const submitTrip = async () => {
    if (!profile?.id) return;
    if (!form.country || !form.start) {
      toast.error(t("travel.requiredFields"));
      return;
    }
    if (form.end && form.end < form.start) {
      toast.error(t("travel.endBeforeStart"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("customer_trips")
      .insert({
        customer_id: profile.id,
        destination_country: form.country,
        destination_city: form.city || null,
        start_date: form.start,
        end_date: form.end || null,
        notes: form.notes || null,
      });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("travel.tripAdded"));
    resetForm();
    setAdding(false);
    void queryClient.invalidateQueries({ queryKey: ["customer-trips", profile.id] });
  };

  const deleteTrip = async (id: number) => {
    const { error } = await supabase.from("customer_trips").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["customer-trips", profile?.id] });
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Plane className="h-6 w-6 text-primary" /> {t("travel.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("travel.subtitle")}</p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> {t("travel.add")}
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-5 mb-5 space-y-3"
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {t("travel.newTrip")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("travel.country")} *</label>
              <SearchableSelect
                value={form.country}
                onChange={(v) => setForm((f) => ({ ...f, country: v }))}
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                placeholder={t("travel.countryPlaceholder")}
                searchPlaceholder={t("travel.searchCountries")}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("travel.city")}</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder={t("travel.cityPlaceholder")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("travel.start")} *</label>
              <input
                type="date"
                value={form.start}
                min={today}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("travel.end")}</label>
              <input
                type="date"
                value={form.end}
                min={form.start || today}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">{t("travel.notes")}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t("travel.notesPlaceholder")}
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => { setAdding(false); resetForm(); }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {t("travel.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submitTrip()}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("travel.save")}
            </button>
          </div>
        </motion.div>
      )}

      {/* Upcoming trips */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="glass-card p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Plane className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("travel.empty")}</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {t("travel.upcoming")} ({upcoming.length})
              </p>
              <ul className="space-y-2">
                {upcoming.map((tr) => (
                  <TripCard key={tr.id} trip={tr} fmt={fmt} onDelete={() => deleteTrip(tr.id)} t={t} />
                ))}
              </ul>
            </div>
          )}
          {past.length > 0 && (
            <div className="mb-6 opacity-70">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {t("travel.past")} ({past.length})
              </p>
              <ul className="space-y-2">
                {past.slice(0, 5).map((tr) => (
                  <TripCard key={tr.id} trip={tr} fmt={fmt} onDelete={() => deleteTrip(tr.id)} t={t} dim />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-6 rounded-xl border border-amber-300/30 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>{t("travel.privacyNote")}</p>
      </div>
    </div>
  );
};

const TripCard = ({
  trip,
  fmt,
  onDelete,
  t,
  dim,
}: {
  trip: Trip;
  fmt: (iso: string) => string;
  onDelete: () => void;
  t: (k: string) => string;
  dim?: boolean;
}) => (
  <li>
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-4 flex items-start gap-3 ${dim ? "opacity-70" : ""}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <MapPin className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {[trip.destination_city, trip.destination_country].filter(Boolean).join(", ") || trip.destination_country}
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Calendar className="h-3 w-3" />
          {fmt(trip.start_date)}
          {trip.end_date ? <> → {fmt(trip.end_date)}</> : null}
        </p>
        {trip.notes && (
          <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{trip.notes}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title={t("travel.delete")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  </li>
);

export default CustomerTravel;
