// Brand FAQ editor — lets brand teams maintain the EN/IT FAQ that powers
// the customer Concierge's brand-knowledge layer without filing an admin
// ticket. Saves directly to public.brands.faq_en / faq_it via the existing
// "brand: update own brand" RLS policy (admin always wins).
//
// The stored shape is an array of:
//   { title: "Question", content: { type: "blocks", blocks: [{ type: "p", text: "Answer" }] } }
// We keep that shape on save so the existing CustomerDashboard /
// CustomerConcierge readers don't need to change.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, BookOpen, MessageSquare, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

type FaqItem = { id: string; title: string; answer: string };
type StoredFaq = Array<{
  title?: string;
  question?: string;
  content?: { type?: string; blocks?: Array<{ type?: string; text?: string }> };
  answer?: string;
}>;

// Read a stored FAQ array (admin-side shape) into our internal {title,answer}
// editor shape. Handles legacy rows where `answer` is a flat string instead
// of the blocks-style rich content.
const decodeFaq = (raw: unknown): FaqItem[] => {
  if (!Array.isArray(raw)) return [];
  return (raw as StoredFaq).map((item, i) => {
    const title = String(item?.title ?? item?.question ?? "").trim();
    const answer = item?.content?.blocks
      ? (item.content.blocks as any[])
          .filter((b) => b?.text)
          .map((b: any) => String(b.text))
          .join("\n\n")
          .trim()
      : String(item?.answer ?? "").trim();
    return { id: `faq-${i}-${Math.random().toString(36).slice(2, 8)}`, title, answer };
  });
};

// Serialise back into the shape the public readers already understand.
const encodeFaq = (items: FaqItem[]) =>
  items
    .filter((i) => i.title.trim() || i.answer.trim())
    .map((i) => ({
      title: i.title.trim(),
      content: {
        type: "blocks",
        blocks: i.answer
          .split(/\n{2,}/)
          .map((para) => para.trim())
          .filter(Boolean)
          .map((para) => ({ type: "p", text: para })),
      },
    }));

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const BrandFaq = () => {
  const { profile, canWrite } = useAuth();
  const { t } = useLanguage();
  const [lang, setLang] = useState<"en" | "it">("en");
  const [enItems, setEnItems] = useState<FaqItem[]>([]);
  const [itItems, setItItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverEnRaw, setServerEnRaw] = useState<unknown>(null);
  const [serverItRaw, setServerItRaw] = useState<unknown>(null);

  // Load the current brand row's FAQ once.
  useEffect(() => {
    if (!profile?.brand_id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("brands")
        .select("faq_en, faq_it")
        .eq("id", profile.brand_id)
        .single();
      setLoading(false);
      if (error) {
        console.error("[brand-faq load]", error);
        toast.error(t("brandFaq.loadFailed"));
        return;
      }
      setServerEnRaw(data?.faq_en ?? []);
      setServerItRaw(data?.faq_it ?? []);
      setEnItems(decodeFaq(data?.faq_en));
      setItItems(decodeFaq(data?.faq_it));
    })();
  }, [profile?.brand_id, t]);

  const items = lang === "en" ? enItems : itItems;
  const setItems = lang === "en" ? setEnItems : setItItems;

  const dirty = useMemo(() => {
    return (
      !sameJson(encodeFaq(enItems), serverEnRaw) ||
      !sameJson(encodeFaq(itItems), serverItRaw)
    );
  }, [enItems, itItems, serverEnRaw, serverItRaw]);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `new-${Math.random().toString(36).slice(2, 9)}`, title: "", answer: "" },
    ]);
  };

  const updateItem = (id: string, patch: Partial<FaqItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const save = async () => {
    if (!profile?.brand_id) return;
    setSaving(true);
    const encEn = encodeFaq(enItems);
    const encIt = encodeFaq(itItems);
    const { error } = await supabase
      .from("brands")
      .update({ faq_en: encEn as any, faq_it: encIt as any })
      .eq("id", profile.brand_id);
    setSaving(false);
    if (error) {
      console.error("[brand-faq save]", error);
      toast.error(error.message);
      return;
    }
    setServerEnRaw(encEn);
    setServerItRaw(encIt);
    toast.success(t("brandFaq.saved"));
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="h-8 w-32 rounded bg-muted animate-pulse mb-6" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-card p-5 mb-3 h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("brandFaq.masterOnly")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">
            {t("brandFaq.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("brandFaq.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? t("brandFaq.saving") : t("brandFaq.save")}
        </button>
      </div>

      {/* Language tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
        <button
          type="button"
          onClick={() => setLang("en")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          EN <span className="opacity-60 ml-1">({enItems.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setLang("it")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            lang === "it" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          IT <span className="opacity-60 ml-1">({itItems.length})</span>
        </button>
      </div>

      {/* Items list */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("brandFaq.emptyForLang").replace("{lang}", lang.toUpperCase())}
            </p>
          </div>
        ) : (
          items.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-5"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(item.id, -1)}
                    disabled={idx === 0}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    title={t("brandFaq.moveUp")}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(item.id, 1)}
                    disabled={idx === items.length - 1}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    title={t("brandFaq.moveDown")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 min-w-0 space-y-2.5">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1">
                      <MessageSquare className="h-3 w-3" /> {t("brandFaq.question")}
                    </label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => updateItem(item.id, { title: e.target.value })}
                      placeholder={t("brandFaq.questionPlaceholder")}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                      {t("brandFaq.answer")}
                    </label>
                    <textarea
                      value={item.answer}
                      onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                      placeholder={t("brandFaq.answerPlaceholder")}
                      rows={4}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      {t("brandFaq.paragraphHint")}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("brandFaq.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}

        <button
          type="button"
          onClick={addItem}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card/50 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          {t("brandFaq.addQuestion")}
        </button>
      </div>

      {dirty && (
        <div className="sticky bottom-4 mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 flex items-center justify-between">
          <span>{t("brandFaq.unsaved")}</span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t("brandFaq.saving") : t("brandFaq.save")}
          </button>
        </div>
      )}
    </div>
  );
};

export default BrandFaq;
