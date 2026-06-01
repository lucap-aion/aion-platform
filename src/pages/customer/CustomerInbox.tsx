// CustomerInbox — derived activity feed. No notifications table or
// read/unread state: this is a single read-only timeline that surfaces what
// needs the customer's attention right now (expiring covers, open claims,
// upcoming trips, recent wishlist adds). All pulled live from existing
// tables via RLS-scoped queries; the customer's Vault hero already shows
// the loudest of these, but the inbox gives a longer view.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Inbox, Calendar, AlertTriangle, Plane, Heart, ArrowRight, CheckCircle2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuthSlug } from "@/hooks/useAuthSlug";

type FeedItem = {
  key: string;
  kind: "renewal" | "claim_open" | "claim_closed" | "trip" | "wishlist";
  title: string;
  subtitle: string;
  dateAt: string;
  href: string;
  Icon: any;
  tone: "warn" | "info" | "good";
};

const daysUntil = (iso: string | null) => {
  if (!iso) return Infinity;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
};

const CustomerInbox = () => {
  const { profile } = useAuth();
  const { t, locale } = useLanguage();
  const slugPrefix = useAuthSlug();

  // Pull each source separately — keeps each query small and lets React Query
  // cache them independently. The merge happens in useMemo.
  const today = new Date().toISOString().slice(0, 10);

  const { data: covers } = useQuery({
    queryKey: ["inbox-covers", profile?.id],
    queryFn: async () => {
      const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("policies")
        .select("id, expiration_date, catalogues!insured_items_item_id_fkey(name)")
        .eq("customer_id", profile!.id)
        .eq("status", "live")
        .gte("expiration_date", today)
        .lte("expiration_date", horizon)
        .order("expiration_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: number;
        expiration_date: string;
        catalogues: { name?: string | null } | null;
      }>;
    },
    enabled: !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: claims } = useQuery({
    queryKey: ["inbox-claims", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select(`
          id, status, created_at, closed_at, type,
          policies!claims_policy_id_fkey ( catalogues!insured_items_item_id_fkey(name), customer_id )
        `)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((c) => c.policies?.customer_id === profile!.id);
    },
    enabled: !!profile?.id,
    staleTime: 60 * 1000,
  });

  const { data: trips } = useQuery({
    queryKey: ["inbox-trips", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_trips")
        .select("id, destination_country, destination_city, start_date, end_date")
        .eq("customer_id", profile!.id)
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: wishlist } = useQuery({
    queryKey: ["inbox-wishlist", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wishlist_items")
        .select(`
          id, created_at,
          catalogues!wishlist_items_catalogue_id_fkey ( name )
        `)
        .eq("customer_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        name: r.catalogues?.name ?? null,
      }));
    },
    enabled: !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  const items: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = [];
    (covers ?? []).forEach((c) => {
      const d = daysUntil(c.expiration_date);
      const tone: FeedItem["tone"] = d <= 14 ? "warn" : "info";
      out.push({
        key: `renew-${c.id}`,
        kind: "renewal",
        title: t("inbox.renewalTitle").replace("{piece}", c.catalogues?.name ?? `#${c.id}`),
        subtitle: t("inbox.renewalSub").replace("{n}", String(d)),
        dateAt: c.expiration_date,
        href: `${slugPrefix}/covers/${c.id}/view`,
        Icon: Calendar,
        tone,
      });
    });
    (claims ?? []).forEach((c) => {
      const closed = c.status === "closed";
      const dateAt = closed ? (c.closed_at ?? c.created_at) : c.created_at;
      out.push({
        key: `claim-${c.id}`,
        kind: closed ? "claim_closed" : "claim_open",
        title: closed
          ? t("inbox.claimClosed").replace("{id}", `#${c.id}`)
          : t("inbox.claimOpen").replace("{id}", `#${c.id}`),
        subtitle: [c.policies?.catalogues?.name, c.type].filter(Boolean).join(" · "),
        dateAt,
        href: `${slugPrefix}/claims/${c.id}/view`,
        Icon: closed ? CheckCircle2 : AlertTriangle,
        tone: closed ? "good" : "warn",
      });
    });
    (trips ?? []).forEach((tr) => {
      const dest = [tr.destination_city, tr.destination_country].filter(Boolean).join(", ") || tr.destination_country;
      out.push({
        key: `trip-${tr.id}`,
        kind: "trip",
        title: t("inbox.tripTitle").replace("{dest}", dest),
        subtitle: t("inbox.tripSub").replace("{date}", new Date(tr.start_date).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "2-digit", month: "short", year: "numeric" })),
        dateAt: tr.start_date,
        href: `${slugPrefix}/travel`,
        Icon: Plane,
        tone: "info",
      });
    });
    (wishlist ?? []).forEach((w) => {
      out.push({
        key: `wish-${w.id}`,
        kind: "wishlist",
        title: t("inbox.wishTitle").replace("{piece}", w.name ?? "—"),
        subtitle: t("inbox.wishSub"),
        dateAt: w.created_at,
        href: `${slugPrefix}/discover`,
        Icon: Heart,
        tone: "info",
      });
    });
    // Sort by dateAt asc for upcoming (renewals/trips) interleaved with desc
    // for past (claims/wishlist). Simplest: by absolute distance to now.
    out.sort((a, b) => {
      const ad = Math.abs(new Date(a.dateAt).getTime() - Date.now());
      const bd = Math.abs(new Date(b.dateAt).getTime() - Date.now());
      return ad - bd;
    });
    return out;
  }, [covers, claims, trips, wishlist, slugPrefix, t, locale]);

  const tones: Record<FeedItem["tone"], string> = {
    warn: "border-amber-500/30 bg-amber-500/5",
    info: "border-border bg-card",
    good: "border-emerald-500/30 bg-emerald-500/5",
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          <Inbox className="h-6 w-6 text-primary" /> {t("inbox.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("inbox.subtitle")}</p>
      </div>

      {items.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("inbox.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, idx) => {
            const dateLabel = new Date(it.dateAt).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
              day: "2-digit", month: "short", year: "numeric",
            });
            return (
              <motion.li
                key={it.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.015, 0.3) }}
              >
                <Link
                  to={it.href}
                  className={`group block rounded-xl border p-4 transition-colors hover:border-primary/40 ${tones[it.tone]}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card border border-border/60">
                      <it.Icon className="h-4 w-4 text-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{it.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-muted-foreground tabular-nums">{dateLabel}</p>
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </div>
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CustomerInbox;
