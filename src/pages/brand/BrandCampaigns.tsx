// BrandCampaigns — bulk outreach for a saved customer segment. Brand picks a
// segment (the chips we built on BrandCustomers), picks an intent, AI drafts
// a templated email (with {first_name} placeholder), brand reviews and
// exports the recipient list as CSV / addresses for their existing email
// tool. We deliberately don't *send* — that's deferred until SPF/DMARC/
// GDPR-consent story is in place — but every "save" records a brand_campaigns
// row so the brand has a paper trail of who got what.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Megaphone, Crown, Clock, AlertTriangle, Heart, Users,
  Wand2, Loader2, Copy, Download, Save, Trash2, X, Calendar, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useLanguage } from "@/contexts/LanguageContext";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type SegmentRow = {
  customer_id: string;
  is_vip: boolean;
  is_lapsed: boolean;
  is_incomplete: boolean;
  is_high_nps_idle: boolean;
};

type SegmentKey = "vip" | "lapsed" | "incomplete" | "highNpsIdle";
type Intent = "cross_sell" | "renewal_nudge" | "win_back" | "check_in";
type Draft = { subject: string; body: string; suggested_followup_days?: number };

type Recipient = { id: string; first_name: string | null; last_name: string | null; email: string | null };

const SEGMENTS: { key: SegmentKey; flag: keyof SegmentRow; Icon: any; labelKey: string }[] = [
  { key: "vip", flag: "is_vip", Icon: Crown, labelKey: "campaigns.segment.vip" },
  { key: "lapsed", flag: "is_lapsed", Icon: Clock, labelKey: "campaigns.segment.lapsed" },
  { key: "incomplete", flag: "is_incomplete", Icon: AlertTriangle, labelKey: "campaigns.segment.incomplete" },
  { key: "highNpsIdle", flag: "is_high_nps_idle", Icon: Heart, labelKey: "campaigns.segment.highNpsIdle" },
];

const INTENTS: Intent[] = ["cross_sell", "renewal_nudge", "win_back", "check_in"];

const flattenFaq = (source: unknown): string => {
  if (!Array.isArray(source)) return "";
  return (source as any[])
    .map((item) => {
      const q = (item?.title ?? item?.question ?? "").toString().trim();
      const a = item?.content?.blocks
        ? (item.content.blocks as any[]).filter((b: any) => b?.text).map((b: any) => String(b.text)).join(" ").trim()
        : (item?.answer ?? "").toString().trim();
      if (!q && !a) return "";
      return `Q: ${q}\nA: ${a}`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const escapeCsv = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const BrandCampaigns = () => {
  const { profile } = useAuth();
  const tenant = useTenant();
  const { t, locale } = useLanguage();
  const queryClient = useQueryClient();

  const [segment, setSegment] = useState<SegmentKey>("vip");
  const [intent, setIntent] = useState<Intent>("cross_sell");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the same segments map BrandCustomers uses — gives us per-customer
  // flag membership for the segment counts and recipient list.
  const { data: segmentRows } = useQuery({
    queryKey: ["brand-customer-segments", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("brand_customer_segments", { p_brand_id: profile!.brand_id });
      if (error) throw error;
      return (data ?? []) as SegmentRow[];
    },
    enabled: !!profile?.brand_id,
    staleTime: 5 * 60 * 1000,
  });

  // Recipient IDs for the active segment.
  const recipientIds = useMemo(() => {
    if (!segmentRows) return [];
    const seg = SEGMENTS.find((s) => s.key === segment);
    if (!seg) return [];
    return segmentRows
      .filter((r) => r[seg.flag] === true)
      .map((r) => r.customer_id);
  }, [segmentRows, segment]);

  // Fetch the actual recipient contact rows for the active segment.
  const { data: recipients } = useQuery({
    queryKey: ["brand-campaigns-recipients", profile?.brand_id, segment, recipientIds.length],
    queryFn: async () => {
      if (recipientIds.length === 0) return [] as Recipient[];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", recipientIds);
      if (error) throw error;
      return (data ?? []) as Recipient[];
    },
    enabled: !!profile?.brand_id && recipientIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Past campaigns history.
  const { data: history } = useQuery({
    queryKey: ["brand-campaigns-history", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_campaigns")
        .select("id, segment_key, intent, subject, recipient_count, created_at")
        .eq("brand_id", profile!.brand_id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: number;
        segment_key: string;
        intent: string;
        subject: string;
        recipient_count: number;
        created_at: string;
      }>;
    },
    enabled: !!profile?.brand_id,
    staleTime: 60 * 1000,
  });

  // Reset draft when segment / intent changes — old draft no longer applies.
  useEffect(() => { setDraft(null); setDraftError(null); }, [segment, intent]);

  const segmentCounts: Record<SegmentKey, number> = useMemo(() => {
    const out: Record<SegmentKey, number> = { vip: 0, lapsed: 0, incomplete: 0, highNpsIdle: 0 };
    if (!segmentRows) return out;
    for (const s of SEGMENTS) out[s.key] = segmentRows.filter((r) => r[s.flag]).length;
    return out;
  }, [segmentRows]);

  const generateDraft = async () => {
    if (recipientIds.length === 0) {
      toast.error(t("campaigns.noRecipients"));
      return;
    }
    setDrafting(true);
    setDraftError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const brandFaq = flattenFaq(locale === "it" ? tenant.faqIt : tenant.faqEn);
      const segmentLabel = t(SEGMENTS.find((s) => s.key === segment)?.labelKey ?? "");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/customer-outreach-draft`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bulk: true,
          intent,
          locale,
          brand_faq: brandFaq,
          segment_label: segmentLabel,
          recipient_count: recipientIds.length,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setDraft(body as Draft);
    } catch (e: any) {
      setDraftError(e?.message ?? "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  const saveCampaign = async () => {
    if (!draft || !profile?.brand_id || recipientIds.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("brand_campaigns")
      .insert({
        brand_id: profile.brand_id,
        segment_key: segment,
        intent,
        subject: draft.subject,
        body: draft.body,
        recipient_count: recipientIds.length,
        recipient_ids: recipientIds as any,
        created_by: profile.id,
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("campaigns.saved"));
    void queryClient.invalidateQueries({ queryKey: ["brand-campaigns-history", profile.brand_id] });
  };

  const deleteCampaign = async (id: number) => {
    const { error } = await supabase.from("brand_campaigns").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["brand-campaigns-history", profile?.brand_id] });
  };

  const downloadCsv = () => {
    if (!recipients?.length) return;
    const header = ["first_name", "last_name", "email"].join(",");
    const rows = recipients.map((r) =>
      [escapeCsv(r.first_name), escapeCsv(r.last_name), escapeCsv(r.email)].join(",")
    );
    const blob = new Blob(["﻿" + header + "\n" + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${segment}-${intent}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyBcc = async () => {
    const emails = (recipients ?? []).map((r) => r.email).filter(Boolean).join(", ");
    if (!emails) {
      toast.error(t("campaigns.noEmails"));
      return;
    }
    try {
      await navigator.clipboard.writeText(emails);
      toast.success(t("campaigns.bccCopied"));
    } catch {
      toast.error(t("campaigns.copyFailed"));
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      toast.success(t("campaigns.draftCopied"));
    } catch {
      toast.error(t("campaigns.copyFailed"));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary" /> {t("campaigns.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("campaigns.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: composer */}
        <div className="lg:col-span-3 space-y-5">
          {/* Segment chips */}
          <div className="glass-card p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {t("campaigns.audience")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SEGMENTS.map((s) => {
                const active = segment === s.key;
                const count = segmentCounts[s.key];
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSegment(s.key)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-foreground font-medium">
                      <s.Icon className="h-4 w-4 text-primary" /> {t(s.labelKey)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {t("campaigns.recipientsCount").replace("{n}", String(recipientIds.length))}
            </p>
          </div>

          {/* Intent picker */}
          <div className="glass-card p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {t("campaigns.intent")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {INTENTS.map((it) => (
                <button
                  key={it}
                  type="button"
                  onClick={() => setIntent(it)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                    intent === it
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <p className="font-medium">{t(`brandCustomer.intent.${it}`)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t(`brandCustomer.intent.${it}.sub`)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button
            type="button"
            onClick={() => void generateDraft()}
            disabled={drafting || recipientIds.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {drafting ? t("campaigns.generating") : draft ? t("campaigns.regenerate") : t("campaigns.generate")}
          </button>

          {draftError && <p className="text-xs text-destructive">{draftError}</p>}

          {draft && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-5 space-y-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">{t("campaigns.draftReady")}</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  {t("brandCustomer.subject")}
                </label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  {t("brandCustomer.body")}
                </label>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={12}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  {t("campaigns.placeholderHint")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => void copyDraft()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Copy className="h-3.5 w-3.5" /> {t("campaigns.copyDraft")}
                </button>
                <button
                  type="button"
                  onClick={() => void copyBcc()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Copy className="h-3.5 w-3.5" /> {t("campaigns.copyBcc")}
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> {t("campaigns.downloadCsv")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveCampaign()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {t("campaigns.save")}
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Right: history */}
        <div className="lg:col-span-2 space-y-3">
          <div className="glass-card p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> {t("campaigns.history")}
            </p>
            {!history || history.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">{t("campaigns.historyEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {history.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border/60 bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {t(`brandCustomer.intent.${c.intent}` as any)} · {t(`campaigns.segment.${c.segment_key as SegmentKey}` as any) || c.segment_key}
                        </p>
                        <p className="text-sm font-medium text-foreground truncate">
                          {c.subject || "(no subject)"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(c.created_at).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}{" · "}
                          {t("campaigns.recipientsCount").replace("{n}", String(c.recipient_count))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteCampaign(c.id)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title={t("campaigns.delete")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandCampaigns;
