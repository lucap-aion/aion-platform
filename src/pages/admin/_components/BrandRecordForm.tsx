import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_MAX_COVERED_VALUE, DEFAULT_MIN_COVERED_VALUE } from "@/lib/coverage";
import type { ThemeColors, ThemeFonts } from "@/contexts/TenantContext";
import { FormField, Input, Select, TextArea, SaveBar } from "./FormField";
import { ImageUpload } from "./ImageUpload";
import CategoryFees from "./CategoryFees";
import CatalogueEvidence from "./CatalogueEvidence";
import { ChevronRight } from "lucide-react";

// The brand record, as one form used in two places.
//
// It lived inline in AdminBrands, inside a drawer, which meant the only way to
// see or change a brand's website, logo, HQ address or fees was to find its row
// in a table and open a panel over the top of it. Those fields are inputs to the
// commercial cycle — the deck needs the logo, the data request needs the
// address, the demo needs the website — so the cycle screen kept having to send
// people back to a table to fix them.
//
// Extracted rather than duplicated: the brands table still opens it in its
// drawer, and the brand detail page renders the same component inline. One form,
// one save path, no chance of the two drifting.

// ── Hex ↔ HSL helpers ──────────────────────────────────────────────
function hexToHsl(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = 0;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hslToHex(hsl: string): string {
  const parts = hsl.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return "#888888";
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** index.css defaults — used only as preview placeholder in the color picker */
const CSS_DEFAULTS: Record<string, string> = {
  primary_hsl:            "38 55% 55%",
  background_hsl:         "0 0% 97%",
  foreground_hsl:         "0 0% 9%",
  card_hsl:               "0 0% 100%",
  border_hsl:             "0 0% 89%",
  sidebar_background_hsl: "0 0% 100%",
  muted_hsl:              "0 0% 94%",
  destructive_hsl:        "0 72% 51%",
};

export interface Brand {
  id: number;
  name: string | null;
  slug: string | null;
  description: string | null;
  email: string | null;
  website: string | null;
  hq_country: string | null;
  hq_address: string | null;
  hq_city: string | null;
  hq_postcode: string | null;
  status: string | null;
  logo_small: string | null;
  logo_big: string | null;
  auth_background_image: string | null;
  top_banner_image: string | null;
  theft_image: string | null;
  damage_image: string | null;
  faq_image: string | null;
  feedback_image: string | null;
  faq_en: any;
  faq_it: any;
  theme_settings: Record<string, string> | null;
  enable_chubb_reporting: boolean | null;
  chubb_policy_prefix: string | null;
  activation_fee: number | null;
  insurance_premium: number | null;
  aion_premium_fee: number | null;
  max_covered_value: number | null;
  min_covered_value: number | null;
  // The commercial cycle writes these three from step 2. They are on the record as well,
  // because a legal entity and a pilot perimeter are facts about the house, not about the
  // screen that happened to ask for them.
  legal_name: string | null;
  registered_address: string | null;
  product_focus: string | null;
  // True once a person has typed the focus. Onboarding re-reads the catalogue on every run
  // and would otherwise overwrite their wording with its own — see the migration.
  product_focus_manual: boolean | null;
  is_prospect: boolean | null;
}

export type Mode = "view" | "edit" | "add";

export const empty = (): Partial<Brand> => ({
  name: "", slug: "", description: "", email: "", website: "",
  hq_country: "", hq_address: "", hq_city: "", hq_postcode: "",
  status: "pending",
  logo_small: "", logo_big: "",
  auth_background_image: null, top_banner_image: null,
  theft_image: null, damage_image: null, faq_image: null, feedback_image: null,
  faq_en: null, faq_it: null,
  theme_settings: null,
  enable_chubb_reporting: false, chubb_policy_prefix: "",
  activation_fee: null, insurance_premium: null, aion_premium_fee: null,
  max_covered_value: null, min_covered_value: null,
  legal_name: "", registered_address: "", product_focus: "", product_focus_manual: false,
  is_prospect: true,
});

const toJsonStr = (v: any) => v ? JSON.stringify(v, null, 2) : "";
const fromJsonStr = (s: string): any => {
  if (!s.trim()) return null;
  try { return JSON.parse(s); } catch { return s; }
};


export default function BrandRecordForm({ brandId, initialMode = "edit", onClose, onSaved, onDirtyChange, embedded = false }: {
  brandId?: number;
  initialMode?: Mode;
  onClose?: () => void;
  onSaved?: () => void;
  /** Told whenever this form starts or stops holding unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
  // Inline on a page rather than inside a drawer: no Close button, and the form
  // owns no dismissal of its own.
  embedded?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [editing, setEditing] = useState<Partial<Brand>>(empty());
  // What the database last handed us, so "discard" has something to go back to and the page
  // above can be told there is work to lose. This form is unmounted the moment another tab
  // is clicked: forty fields, gone, with no warning and nothing to restore them from.
  const [loaded, setLoaded] = useState<Partial<Brand>>(empty());
  const [loadedFaq, setLoadedFaq] = useState({ en: "", it: "" });
  const [faqEnStr, setFaqEnStr] = useState("");
  const [faqItStr, setFaqItStr] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!brandId);

  useEffect(() => {
    if (!brandId) {
      setEditing(empty()); setLoaded(empty());
      setFaqEnStr(""); setFaqItStr(""); setLoadedFaq({ en: "", it: "" });
      setLoading(false); return;
    }
    setLoading(true);
    void (async () => {
      const { data } = await supabase.from("brands")
        .select("id, name, slug, description, email, website, hq_country, hq_address, hq_city, hq_postcode, status, logo_small, logo_big, auth_background_image, top_banner_image, theft_image, damage_image, faq_image, feedback_image, faq_en, faq_it, theme_settings, enable_chubb_reporting, chubb_policy_prefix, activation_fee, insurance_premium, aion_premium_fee, max_covered_value, min_covered_value, legal_name, registered_address, product_focus, product_focus_manual, is_prospect")
        .eq("id", brandId).maybeSingle();
      const b = (data ?? empty()) as Partial<Brand>;
      const en = toJsonStr(b.faq_en), it = toJsonStr(b.faq_it);
      setEditing(b); setLoaded(b);
      setFaqEnStr(en); setFaqItStr(it); setLoadedFaq({ en, it });
      setLoading(false);
    })();
  }, [brandId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // The database enforces this too, but a check constraint surfaces as a raw Postgres
    // error in a toast. Say it in words instead, before the round trip.
    const floor = editing.min_covered_value ?? DEFAULT_MIN_COVERED_VALUE;
    const ceiling = editing.max_covered_value ?? DEFAULT_MAX_COVERED_VALUE;
    if (floor >= ceiling) {
      toast({
        title: "Covered value range is inverted",
        description: `The activation floor (€${floor.toLocaleString()}) has to be below the ceiling (€${ceiling.toLocaleString()}), otherwise every cover is recorded blocked.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    // Build theme_settings: only store non-default values to keep it clean
    const ts = editing.theme_settings;
    const cleanTheme: Record<string, string> = {};
    if (ts) {
      for (const [k, v] of Object.entries(ts)) {
        if (v && v !== (CSS_DEFAULTS as Record<string, string>)[k]) cleanTheme[k] = v;
      }
    }
    const payload = {
      name: editing.name ?? null, slug: editing.slug ?? null,
      description: editing.description ?? null,
      email: editing.email ?? null,
      website: editing.website ?? null,
      hq_country: editing.hq_country ?? null,
      hq_address: editing.hq_address ?? null,
      hq_city: editing.hq_city ?? null,
      hq_postcode: editing.hq_postcode ?? null,
      status: editing.status ?? null,
      logo_small: editing.logo_small ?? null, logo_big: editing.logo_big ?? null,
      auth_background_image: editing.auth_background_image ?? null,
      top_banner_image: editing.top_banner_image ?? null,
      theft_image: editing.theft_image ?? null,
      damage_image: editing.damage_image ?? null,
      faq_image: editing.faq_image ?? null,
      feedback_image: editing.feedback_image ?? null,
      faq_en: fromJsonStr(faqEnStr),
      faq_it: fromJsonStr(faqItStr),
      theme_settings: Object.keys(cleanTheme).length > 0 ? cleanTheme : null,
      enable_chubb_reporting: editing.enable_chubb_reporting ?? false,
      chubb_policy_prefix: editing.chubb_policy_prefix ?? null,
      activation_fee: editing.activation_fee ?? null,
      insurance_premium: editing.insurance_premium ?? null,
      aion_premium_fee: editing.aion_premium_fee ?? null,
      max_covered_value: editing.max_covered_value ?? DEFAULT_MAX_COVERED_VALUE,
      min_covered_value: editing.min_covered_value ?? DEFAULT_MIN_COVERED_VALUE,
      legal_name: editing.legal_name || null,
      registered_address: editing.registered_address || null,
      product_focus: editing.product_focus || null,
      // Typing in the field is what claims it. Not a checkbox the person has to find: the
      // act of correcting a wrong focus IS the statement that this one is theirs, and a
      // correction that onboarding silently undid on the next run is the bug this closes.
      product_focus_manual: (editing.product_focus || null) !== (loaded.product_focus || null)
        ? true
        : editing.product_focus_manual ?? false,
      is_prospect: editing.is_prospect ?? false,
    };
    const { error } = mode === "add"
      ? await supabase.from("brands").insert(payload)
      : await supabase.from("brands").update(payload).eq("id", editing.id!);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: mode === "add" ? "Brand created" : "Brand updated" });
    onSaved?.();
    onClose?.();
  };

  const set = (k: keyof Brand, v: unknown) => setEditing((p) => ({ ...p, [k]: v }));

  // Unsaved work, and whether anybody above needs to know about it.
  const dirty = !loading && (
    JSON.stringify(editing) !== JSON.stringify(loaded)
    || faqEnStr !== loadedFaq.en || faqItStr !== loadedFaq.it
  );
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Leaving the browser entirely is the one exit this component cannot intercept itself.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const discard = () => {
    setEditing(loaded); setFaqEnStr(loadedFaq.en); setFaqItStr(loadedFaq.it);
  };
  const ro = mode === "view";
  // A brand being created has no id yet, so uploads get a throwaway key rather
// than all landing on brands/undefined-*.
  const brandKey = editing.id ?? `new-${Date.now()}`;

  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading the brand record…</p>;

  return (
        <form onSubmit={handleSave} className="space-y-4">

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" required={!ro}><Input disabled={ro} value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} required={!ro} /></FormField>
            <FormField label="Portal address" required={!ro} hint="The brand's own URL under app.aioncover.com"><Input disabled={ro} value={editing.slug ?? ""} onChange={(e) => set("slug", e.target.value)} required={!ro} /></FormField>
          </div>
          {/* A textarea, not an input: onboarding writes the encyclopaedia's paragraph about
              the house in here, and a single line showed the first eighty characters of it
              with the rest reachable only by dragging the caret. */}
          <FormField label="Description" hint="Shown in the portal and used as the house's own words in generated documents">
            <TextArea rows={4} disabled={ro} value={editing.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </FormField>
          <FormField label="Email"><Input type="email" disabled={ro} value={editing.email ?? ""} onChange={(e) => set("email", e.target.value)} /></FormField>
          <FormField label="Website"><Input disabled={ro} value={editing.website ?? ""} onChange={(e) => set("website", e.target.value)} /></FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Status">
              {ro ? <Input disabled value={editing.status ?? ""} /> : (
                <Select value={editing.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="blocked">Blocked</option>
                </Select>
              )}
            </FormField>
            {/* A deal or a live programme. It filters the brands list, and it is one of the
                two things that decide whether demo clients and covers may be fabricated in
                this account — the other being that the status is not yet verified. */}
            <FormField label="Kind" hint="A prospect's account may hold demo data; a client's may not">
              {ro ? <Input disabled value={editing.is_prospect ? "Prospect" : "Client"} /> : (
                <Select value={editing.is_prospect ? "prospect" : "client"}
                  onChange={(e) => set("is_prospect", e.target.value === "prospect")}>
                  <option value="prospect">Prospect</option>
                  <option value="client">Client</option>
                </Select>
              )}
            </FormField>
          </div>

          {/* What the data request goes out saying. Edited here or in step 2 of the cycle —
              the same three columns either way, so neither screen loses the other's work. */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Commercial</p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Legal entity" hint="The entity the programme is contracted with, if not the trading name">
                <Input disabled={ro} value={editing.legal_name ?? ""} onChange={(e) => set("legal_name", e.target.value)} placeholder="Brand Name S.p.A." />
              </FormField>
              <FormField
                label="Product focus"
                hint={editing.product_focus_manual
                  ? "Set by hand — onboarding will not overwrite it"
                  : "Read from the catalogue on every onboarding run; type over it to own it"}
              >
                <Input disabled={ro} value={editing.product_focus ?? ""} onChange={(e) => set("product_focus", e.target.value)} placeholder="High jewellery, EU boutiques" />
              </FormField>
            </div>
            {/* The workings, because this line goes out on a data request telling a client
                which categories the pilot covers, and it reads as a fact rather than as a
                reading of a part-scraped website. Seeing "82 of 260 pieces are Accessori"
                is what turns "that is wrong" into a correction somebody can make. */}
            {brandId ? <CatalogueEvidence brandId={brandId} focus={editing.product_focus ?? null} /> : null}
            <div className="mt-3">
              <FormField label="Registered address" hint="Only when it differs from the headquarters below">
                <Input disabled={ro} value={editing.registered_address ?? ""} onChange={(e) => set("registered_address", e.target.value)} />
              </FormField>
            </div>
          </div>

          {/* Fee Rates */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fee Rates</p>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Activation Fee" hint="e.g. 0.05 = 5%">
                <Input type="number" step="0.0001" disabled={ro} value={editing.activation_fee ?? ""} onChange={(e) => set("activation_fee", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="Insurance Premium" hint="e.g. 0.12 = 12%">
                <Input type="number" step="0.0001" disabled={ro} value={editing.insurance_premium ?? ""} onChange={(e) => set("insurance_premium", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="AION Premium Fee" hint="On net premium">
                <Input type="number" step="0.0001" disabled={ro} value={editing.aion_premium_fee ?? ""} onChange={(e) => set("aion_premium_fee", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="Max Covered Value (€)" hint="Retail cap per item; new covers only">
                <Input type="number" step="1" min="0" disabled={ro} value={editing.max_covered_value ?? ""} placeholder={String(DEFAULT_MAX_COVERED_VALUE)} onChange={(e) => set("max_covered_value", e.target.value ? Number(e.target.value) : null)} />
              </FormField>
              <FormField label="Min Covered Value (€)" hint="At or below this retail price a cover is recorded but not activated">
                <Input type="number" step="1" min="0" disabled={ro} value={editing.min_covered_value ?? ""} placeholder={String(DEFAULT_MIN_COVERED_VALUE)} onChange={(e) => set("min_covered_value", e.target.value !== "" ? Number(e.target.value) : null)} />
              </FormField>
            </div>

            {/* Per category, because a house does not have one rate. A bag and a watch are
                different risks and are quoted differently, and with a single set of rates on
                the record that difference lived in somebody's head. Saved as you leave each
                cell — this is its own table, not part of the form's payload. */}
            {brandId ? (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Per-category rates
                </p>
                <CategoryFees
                  brandId={brandId}
                  readOnly={ro}
                  brandRates={{
                    insurance_premium: editing.insurance_premium ?? null,
                    activation_fee: editing.activation_fee ?? null,
                    aion_premium_fee: editing.aion_premium_fee ?? null,
                    min_covered_value: editing.min_covered_value ?? DEFAULT_MIN_COVERED_VALUE,
                    max_covered_value: editing.max_covered_value ?? DEFAULT_MAX_COVERED_VALUE,
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Chubb */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Chubb Reporting</p>
            <div className="grid grid-cols-2 gap-4 items-end">
              <FormField label="Policy Prefix">
                <Input disabled={ro} value={editing.chubb_policy_prefix ?? ""} onChange={(e) => set("chubb_policy_prefix", e.target.value)} placeholder="e.g. CHB-" />
              </FormField>
              <div className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  id="chubb_reporting"
                  disabled={ro}
                  checked={editing.enable_chubb_reporting ?? false}
                  onChange={(e) => set("enable_chubb_reporting", e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                />
                <label htmlFor="chubb_reporting" className="text-sm font-medium text-foreground">Enable Chubb Reporting</label>
              </div>
            </div>
          </div>
          {/* HQ Address */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Headquarters</p>
            <FormField label="Address"><Input disabled={ro} value={editing.hq_address ?? ""} onChange={(e) => set("hq_address", e.target.value)} /></FormField>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <FormField label="City"><Input disabled={ro} value={editing.hq_city ?? ""} onChange={(e) => set("hq_city", e.target.value)} /></FormField>
              <FormField label="Postcode"><Input disabled={ro} value={editing.hq_postcode ?? ""} onChange={(e) => set("hq_postcode", e.target.value)} /></FormField>
              <FormField label="Country"><Input disabled={ro} value={editing.hq_country ?? ""} onChange={(e) => set("hq_country", e.target.value)} /></FormField>
            </div>
          </div>

          {/* Everything below dresses the customer portal. It is filled in by onboarding and
              seldom touched by hand, so it is folded away: the three things a new brand is
              actually sent here to set — the fees, the Chubb prefix and the ceiling — used to
              sit underneath forty fields nobody had been asked to look at. */}
          <details className="border-t border-border pt-4 [&_summary]:list-none">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
              Logos
              <span className="font-normal normal-case tracking-normal text-[11px]">filled in by onboarding</span>
            </summary>
            <div className="pt-3">
          {/* Logos */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Logos</p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Logo (icon)" hint="Small square, used in navigation">
                {ro ? (
                  editing.logo_small
                    ? (
                      // Openable in view mode too — checking a logo means looking at the file.
                      <a href={editing.logo_small!} target="_blank" rel="noreferrer" title="Open the full-size file"
                        className="inline-flex h-16 w-32 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                        <img src={editing.logo_small} alt="" className="max-h-full max-w-full object-contain" />
                      </a>
                    )
                    : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.logo_small} onChange={(url) => set("logo_small", url)} bucket="brand_logos" path={`brands/${brandKey}-icon`} />
                )}
              </FormField>
              <FormField label="Logo (full)" hint="Full logo, used in portal header">
                {ro ? (
                  editing.logo_big
                    ? (
                      // Openable in view mode too — checking a logo means looking at the file.
                      <a href={editing.logo_big!} target="_blank" rel="noreferrer" title="Open the full-size file"
                        className="inline-flex h-16 w-32 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
                        <img src={editing.logo_big} alt="" className="max-h-full max-w-full object-contain" />
                      </a>
                    )
                    : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.logo_big} onChange={(url) => set("logo_big", url)} bucket="brand_logos" path={`brands/${brandKey}-full`} />
                )}
              </FormField>
            </div>
          </div>

            </div>
          </details>

          <details className="border-t border-border pt-4 [&_summary]:list-none">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
              Brand theme colours
              <span className="font-normal normal-case tracking-normal text-[11px]">only what you change is saved</span>
            </summary>
            <div className="pt-3">
          {/* Theme / Brand Colours */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Brand Theme Colours</p>
            <p className="text-xs text-muted-foreground mb-4">The brand's own accents. The page itself — background, text, cards, sidebar — stays on the AION palette, so a brand's logo and photography are legible on it by construction.</p>
            <div className="grid grid-cols-2 gap-4">
              {/* The canvas is not on this list on purpose — see THEME_KEYS in
                  TenantContext. Offering a background here and then not
                  applying it would be worse than not offering it. */}
              {([
                ["primary_hsl",            "Primary (brand colour)"],
                ["border_hsl",             "Borders"],
                ["destructive_hsl",        "Destructive / Error"],
              ] as [keyof ThemeColors, string][]).map(([key, label]) => {
                const ts = editing.theme_settings ?? {};
                const hslVal = (ts as Record<string, string>)[key] || (CSS_DEFAULTS as Record<string, string>)[key];
                const hexVal = hslToHex(hslVal);
                return (
                  <FormField key={key} label={label}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        disabled={ro}
                        value={hexVal}
                        onChange={(e) => {
                          const newHsl = hexToHsl(e.target.value);
                          set("theme_settings", { ...ts, [key]: newHsl });
                        }}
                        className="h-9 w-12 rounded border border-border cursor-pointer disabled:cursor-default disabled:opacity-60"
                      />
                      <span className="text-xs text-muted-foreground font-mono">{hexVal}</span>
                      {!ro && (ts as Record<string, string>)[key] && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...ts } as Record<string, string>;
                            delete next[key];
                            set("theme_settings", Object.keys(next).length ? next : null);
                          }}
                          className="text-xs text-destructive hover:underline ml-auto"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </FormField>
                );
              })}
            </div>
          </div>

            </div>
          </details>

          <details className="border-t border-border pt-4 [&_summary]:list-none">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
              Brand fonts
              <span className="font-normal normal-case tracking-normal text-[11px]"></span>
            </summary>
            <div className="pt-3">
          {/* Brand Fonts */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Brand Fonts</p>
            <p className="text-xs text-muted-foreground mb-4">Override the default fonts. Provide a Google Fonts or self-hosted CSS URL to load custom typefaces.</p>
            <div className="space-y-3">
              <FormField label="Font CSS URL" hint="e.g. Google Fonts @import URL">
                <Input disabled={ro} value={(editing.theme_settings as any)?.font_url ?? ""} onChange={(e) => set("theme_settings", { ...(editing.theme_settings ?? {}), font_url: e.target.value || undefined })} placeholder="https://fonts.googleapis.com/css2?family=..." />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Heading Font" hint="CSS font-family for h1–h6">
                  <Input disabled={ro} value={(editing.theme_settings as any)?.heading_font ?? ""} onChange={(e) => set("theme_settings", { ...(editing.theme_settings ?? {}), heading_font: e.target.value || undefined })} placeholder="e.g. Portrait, Noto Serif" />
                </FormField>
                <FormField label="Body Font" hint="CSS font-family for body text">
                  <Input disabled={ro} value={(editing.theme_settings as any)?.body_font ?? ""} onChange={(e) => set("theme_settings", { ...(editing.theme_settings ?? {}), body_font: e.target.value || undefined })} placeholder="e.g. DM Sans, Inter" />
                </FormField>
              </div>
            </div>
          </div>

            </div>
          </details>

          <details className="border-t border-border pt-4 [&_summary]:list-none">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
              Portal images
              <span className="font-normal normal-case tracking-normal text-[11px]">six sections of the customer portal</span>
            </summary>
            <div className="pt-3">
          {/* Portal images */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Portal Images</p>
            <div className="space-y-3">
              <FormField label="Auth Background" hint="Login / signup page background">
                {ro ? (
                  editing.auth_background_image ? <img src={editing.auth_background_image} alt="" className="h-20 w-full rounded-lg border border-border object-cover" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.auth_background_image} onChange={(url) => set("auth_background_image", url)} bucket="brand_media" path={`brands/${brandKey}-auth-bg`} />
                )}
              </FormField>
              <FormField label="Top Banner" hint="Customer portal top banner">
                {ro ? (
                  editing.top_banner_image ? <img src={editing.top_banner_image} alt="" className="h-20 w-full rounded-lg border border-border object-cover" /> : <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <ImageUpload value={editing.top_banner_image} onChange={(url) => set("top_banner_image", url)} bucket="brand_media" path={`brands/${brandKey}-top-banner`} />
                )}
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Theft Image" hint="Used on new claim (Theft)">
                  {ro ? (
                    editing.theft_image ? <img src={editing.theft_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.theft_image} onChange={(url) => set("theft_image", url)} bucket="brand_media" path={`brands/${brandKey}-theft`} />
                  )}
                </FormField>
                <FormField label="Damage Image" hint="Used on new claim (Accidental Damage)">
                  {ro ? (
                    editing.damage_image ? <img src={editing.damage_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.damage_image} onChange={(url) => set("damage_image", url)} bucket="brand_media" path={`brands/${brandKey}-damage`} />
                  )}
                </FormField>
                <FormField label="FAQ Image">
                  {ro ? (
                    editing.faq_image ? <img src={editing.faq_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.faq_image} onChange={(url) => set("faq_image", url)} bucket="brand_media" path={`brands/${brandKey}-faq`} />
                  )}
                </FormField>
                <FormField label="Feedback Image">
                  {ro ? (
                    editing.feedback_image ? <img src={editing.feedback_image} alt="" className="h-16 rounded-lg border border-border object-cover w-full" /> : <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <ImageUpload value={editing.feedback_image} onChange={(url) => set("feedback_image", url)} bucket="brand_media" path={`brands/${brandKey}-feedback`} />
                  )}
                </FormField>
              </div>
            </div>
          </div>

            </div>
          </details>

          <details className="border-t border-border pt-4 [&_summary]:list-none">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
              FAQ content
              <span className="font-normal normal-case tracking-normal text-[11px]">raw JSON, edited on the Documents tab too</span>
            </summary>
            <div className="pt-3">
          {/* FAQ */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">FAQ Content (JSON)</p>
            <div className="space-y-3">
              <FormField label="FAQ (English)" hint="JSON array of { question, answer } objects">
                <TextArea disabled={ro} rows={5} value={faqEnStr} onChange={(e) => setFaqEnStr(e.target.value)} placeholder='[{"question":"...","answer":"..."}]' className="font-mono text-xs" />
              </FormField>
              <FormField label="FAQ (Italian)" hint="JSON array of { question, answer } objects">
                <TextArea disabled={ro} rows={5} value={faqItStr} onChange={(e) => setFaqItStr(e.target.value)} placeholder='[{"question":"...","answer":"..."}]' className="font-mono text-xs" />
              </FormField>
            </div>
          </div>

            </div>
          </details>


          {ro ? (
            <div className="flex justify-between gap-2 pt-4 border-t border-border mt-4">
              <button type="button" onClick={() => onClose?.()} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">Close</button>
              <button type="button" onClick={() => { setMode("edit"); }} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Edit</button>
            </div>
          ) : (
            <SaveBar
              onCancel={embedded ? discard : () => onClose?.()}
              cancelLabel={embedded ? "Discard changes" : "Cancel"}
              cancelDisabled={embedded && !dirty}
              loading={saving}
              label={mode === "add" ? "Create Brand" : "Save Changes"}
              note={dirty ? "Unsaved changes" : undefined}
            />
          )}
        </form>
  );
}
