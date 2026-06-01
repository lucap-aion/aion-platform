import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Info, Upload, X, FileText, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCustomerPolicies } from "@/hooks/use-policies";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { sendEmail } from "@/utils/sendEmail";
import SearchableSelect from "@/components/SearchableSelect";
import { CLAIM_TYPES, COUNTRIES } from "@/utils/countries";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type AiSuggestion = {
  suggested_type: string | null;
  confidence: "high" | "medium" | "low" | null;
  severity: "minor" | "major" | "critical" | null;
  description: string | null;
  observations: string[] | null;
};

// Convert a File to the data:image/...;base64,... form Anthropic accepts.
const fileToDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(f);
  });

const getImage = (policy: any) => policy?.catalogues?.picture || "/placeholder.svg";
const getProduct = (policy: any) => policy?.catalogues?.name || "Unknown Product";
const getBrand = (policy: any) => policy?.brands?.name || "Unknown Brand";
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString() : "—";

const NewClaim = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const slugPrefix = useAuthSlug();
  const { data: policies, isLoading: isLoadingPolicies } = useCustomerPolicies();
  const urlCoverId = searchParams.get("cover") || "";
  const [selectedPolicyId, setSelectedPolicyId] = useState(urlCoverId);
  const selectedPolicy = policies?.find((p: any) => String(p.id) === selectedPolicyId);

  // Check for existing open claim on selected policy
  const handlePolicyChange = async (id: string) => {
    setSelectedPolicyId(id);
    setOpenClaimWarning(null);
    if (!id) return;
    const { data } = await supabase
      .from("claims")
      .select("id")
      .eq("policy_id", Number(id))
      .eq("status", "open")
      .limit(1);
    if (data && data.length > 0) {
      setOpenClaimWarning(`Claim #${data[0].id} is already open on this cover. You may not submit a new claim until it is resolved.`);
    }
  };

  const { t, locale } = useLanguage();

  const [form, setForm] = useState({
    claimType: "",
    incidentDate: new Date().toISOString().split("T")[0],
    incidentCity: "",
    incidentCountry: "",
    description: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openClaimWarning, setOpenClaimWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI photo wizard state. The customer can opt out at any time — the form
  // is fully usable without ever running the analyser.
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Run the photo prefill against the first 1–2 image files. Called manually
  // from a button so the customer is in control. Falls back gracefully on
  // any failure — never blocks the form.
  const runAiAnalysis = async () => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/")).slice(0, 2);
    if (imageFiles.length === 0) {
      setAiError(t("newClaim.ai.needImage"));
      return;
    }
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not signed in");

      const photos = await Promise.all(imageFiles.map(fileToDataUrl));
      const productHint = selectedPolicy
        ? `${getProduct(selectedPolicy)} by ${getBrand(selectedPolicy)}`
        : "";

      const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-photo-prefill`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ photos, product_hint: productHint, locale }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);

      const suggestion = body as AiSuggestion;
      setAiSuggestion(suggestion);

      // Only prefill fields the customer hasn't already touched. Respect
      // their work — we're assisting, not steamrolling.
      setForm((prev) => ({
        ...prev,
        claimType: prev.claimType || (suggestion.suggested_type ?? ""),
        description: prev.description || (suggestion.description ?? ""),
      }));
    } catch (e: any) {
      setAiError(e?.message ?? t("newClaim.ai.failed"));
    } finally {
      setAiAnalyzing(false);
    }
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files];
    Array.from(incoming).forEach((f) => {
      if (!next.find((x) => x.name === f.name && x.size === f.size)) next.push(f);
    });
    setFiles(next);
    setFileError(false);
  };

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPolicy?.id) {
      toast.error("Please select a cover.");
      return;
    }
    if (openClaimWarning) {
      toast.error("There is already an open claim on this cover. Please resolve it before submitting a new one.");
      return;
    }
    if (!form.claimType || !form.incidentDate || !form.incidentCity || !form.incidentCountry || !form.description) {
      toast.error("Please complete all required fields.");
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    if (form.incidentDate > today) {
      toast.error("The incident date cannot be in the future.");
      return;
    }
    if (files.length === 0) {
      setFileError(true);
      toast.error("Please attach at least one file as evidence.");
      return;
    }

    setIsSubmitting(true);

    // Upload files to Supabase storage
    const mediaUrls: string[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const path = `${profile?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("claims_media").upload(path, file);
      if (uploadError) {
        toast.error(`Upload failed: ${uploadError.message}`);
        setIsSubmitting(false);
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from("claims_media").getPublicUrl(path);
      mediaUrls.push(publicUrl);
    }

    const { error } = await supabase.from("claims").insert({
      policy_id: selectedPolicy.id,
      type: form.claimType,
      incident_date: form.incidentDate,
      incident_city: form.incidentCity,
      incident_country: form.incidentCountry,
      description: form.description,
      status: "open",
      media: mediaUrls,
    });

    if (error) {
      toast.error(error.message);
      setIsSubmitting(false);
      return;
    }

    sendEmail("claim_submitted", {
      claim: {
        type: form.claimType,
        incident_date: form.incidentDate,
        description: form.description,
        policy: {
          id: selectedPolicy.id,
          customer: {
            first_name: profile?.first_name ?? null,
            last_name: profile?.last_name ?? null,
            email: profile?.email ?? "",
          },
          brand: { name: getBrand(selectedPolicy), id: (selectedPolicy as any)?.brand_id ?? null, email: null },
          item: { name: getProduct(selectedPolicy) },
        },
      },
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-claims", profile?.id] }),
      queryClient.invalidateQueries({ queryKey: ["customer-policies", profile?.id] }),
    ]);
    setIsSubmitting(false);
    toast.success("Claim submitted successfully.");
    navigate(`${slugPrefix}/claims`);
  };

  if (isLoadingPolicies) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-0 md:py-8 animate-fade-in">
        <div className="h-4 w-32 rounded bg-muted animate-pulse mb-4" />
        <div className="glass-card p-6 md:p-8 space-y-6">
          <div className="h-7 w-36 rounded bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
            <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
            <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
              <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
              <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
            <div className="h-24 w-full rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 md:px-0 md:py-8 animate-fade-in">
      <Link to={`${slugPrefix}/claims`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to Claims
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 md:p-8">
        <h1 className="font-serif text-2xl font-bold text-foreground mb-6">New Claim</h1>

        {/* Cover picker */}
        <div className="mb-6">
          <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
            Select Cover <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </label>
          <SearchableSelect
            value={selectedPolicyId}
            onChange={handlePolicyChange}
            options={(policies || []).map((p: any) => ({
              value: String(p.id),
              label: `${getProduct(p)} — ${getBrand(p)} · Policy #${p.id}`,
            }))}
            placeholder={isLoadingPolicies ? "Loading covers…" : "Select a cover…"}
            searchPlaceholder="Search covers…"
          />
          {selectedPolicy && (
            <div className="mt-2 rounded-lg bg-muted px-3 py-2 flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-white overflow-hidden">
                <img src={getImage(selectedPolicy)} alt={getProduct(selectedPolicy)} className="h-full w-full object-contain mix-blend-multiply" />
              </div>
              <p className="text-xs text-muted-foreground">
                Valid {formatDate((selectedPolicy as any).start_date)} → {formatDate((selectedPolicy as any).expiration_date)}
              </p>
            </div>
          )}
          {openClaimWarning && (
            <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-start gap-2">
              <Info className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{openClaimWarning}</p>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {!aiSuggestion && (
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                  Claim Type <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </label>
                <select
                  value={form.claimType}
                  onChange={(e) => setForm({ ...form, claimType: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Select Type</option>
                  {CLAIM_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                Incident Date <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <input
                type="date"
                value={form.incidentDate}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setForm({ ...form, incidentDate: e.target.value })}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                Incident City <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <input
                type="text"
                placeholder="Enter incident city"
                value={form.incidentCity}
                onChange={(e) => setForm({ ...form, incidentCity: e.target.value })}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                Incident Country <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <SearchableSelect
                value={form.incidentCountry}
                onChange={(v) => setForm({ ...form, incidentCountry: v })}
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                placeholder="Select Country"
                searchPlaceholder="Search countries..."
              />
            </div>
          </div>

          <div className={aiSuggestion ? "hidden" : undefined}>
            <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
              Claim Description <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </label>
            <textarea
              placeholder="Enter Description (max 600 chars)"
              maxLength={600}
              rows={5}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
              Evidence Files <span className="text-destructive ml-0.5">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            {/* Drop zone */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              className={`w-full rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${fileError ? "border-destructive/60 bg-destructive/5" : "border-border hover:border-primary/50 hover:bg-primary/5"}`}
            >
              <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click or drag & drop to upload files
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">Images and PDFs accepted</p>
            </button>
            {fileError && (
              <p className="text-xs text-destructive mt-1">At least one file is required.</p>
            )}
            {/* Previews */}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-3">
                {files.map((file, i) => {
                  const isImage = file.type.startsWith("image/");
                  const previewUrl = isImage ? URL.createObjectURL(file) : null;
                  return (
                    <div key={i} className="relative group h-20 w-20 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center shrink-0">
                      {previewUrl
                        ? <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
                        : <FileText className="h-8 w-8 text-muted-foreground" />}
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] truncate px-1 py-0.5">{file.name}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI assist panel — appears once at least one image is attached.
                Customer can choose to run it or skip; suggestion only
                prefills fields they haven't filled themselves. */}
            {files.some((f) => f.type.startsWith("image/")) && (
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
                {!aiSuggestion ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Sparkles className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{t("newClaim.ai.title")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("newClaim.ai.subtitle")}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runAiAnalysis()}
                      disabled={aiAnalyzing}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                    >
                      {aiAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      {aiAnalyzing ? t("newClaim.ai.analyzing") : t("newClaim.ai.analyze")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{t("newClaim.ai.resultTitle")}</p>
                          {aiSuggestion.confidence && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {t("newClaim.ai.confidence")}: <span className="font-medium">{aiSuggestion.confidence}</span>
                              {aiSuggestion.severity ? <> · {t("newClaim.ai.severity")}: <span className="font-medium">{aiSuggestion.severity}</span></> : null}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAiSuggestion(null); setAiError(null); }}
                        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        {t("newClaim.ai.redo")}
                      </button>
                    </div>

                    {/* The claim Type and Description fields live here once AI
                        has run — direct edit, no duplicate copy in the form
                        below. Same form state, same validation. */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                        {t("newClaim.ai.suggestedType")}
                      </label>
                      <select
                        value={form.claimType}
                        onChange={(e) => setForm({ ...form, claimType: e.target.value })}
                        className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                      >
                        <option value="">Select Type</option>
                        {CLAIM_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                        {t("newClaim.ai.descriptionLabel")}
                      </label>
                      <textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        maxLength={600}
                        rows={4}
                        className="w-full rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                      />
                    </div>

                    {aiSuggestion.observations && aiSuggestion.observations.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                          {t("newClaim.ai.whatAiSaw")}
                        </p>
                        <ul className="text-[11px] text-muted-foreground space-y-1 pl-1">
                          {aiSuggestion.observations.slice(0, 5).map((o, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-primary/60 shrink-0">•</span>
                              <span>{o}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="text-[11px] text-muted-foreground/80 italic">{t("newClaim.ai.reviewNote")}</p>
                  </div>
                )}
                {aiError && (
                  <p className="text-xs text-destructive mt-2">{aiError}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-4 border-t border-border pt-6">
            <Link to={`${slugPrefix}/claims`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default NewClaim;
