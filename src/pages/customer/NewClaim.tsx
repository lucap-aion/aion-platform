import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Info, Upload, X, FileText, Loader2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomerPolicies } from "@/hooks/use-policies";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { sendEmail } from "@/utils/sendEmail";
import SearchableSelect from "@/components/SearchableSelect";
import { CLAIM_TYPES, COUNTRIES } from "@/utils/countries";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!form.claimType || !form.incidentDate || !form.incidentCity || !form.incidentCountry || !form.description) {
      toast.error("Please complete all required fields.");
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
          brand: { name: getBrand(selectedPolicy), email: null },
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
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-0 md:py-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
            onChange={setSelectedPolicyId}
            options={(policies || []).map((p: any) => ({
              value: String(p.id),
              label: `${getProduct(p)} — ${getBrand(p)} · Policy #${p.id}`,
            }))}
            placeholder={isLoadingPolicies ? "Loading covers…" : "Select a cover…"}
            searchPlaceholder="Search covers…"
          />
          {selectedPolicy && (
            <div className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] overflow-hidden">
                <img src={getImage(selectedPolicy)} alt={getProduct(selectedPolicy)} className="h-full w-full object-contain mix-blend-multiply" />
              </div>
              <p className="text-xs text-muted-foreground">
                Valid {formatDate((selectedPolicy as any).start_date)} → {formatDate((selectedPolicy as any).expiration_date)}
              </p>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                {CLAIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

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

          <div>
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
                    <div key={i} className="relative group h-20 w-20 rounded-lg border border-border overflow-hidden bg-secondary/40 flex items-center justify-center shrink-0">
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
