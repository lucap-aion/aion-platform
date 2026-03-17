import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, XCircle, Clock, CheckCircle2, Paperclip, User, Package, Image, FileText, File, ChevronLeft, ChevronRight, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBrandClaim } from "@/hooks/use-claims";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";
import { parseError } from "@/utils/parseError";

const statusConfig = {
  open: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock, label: "Open" },
  closed: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Closed" },
} as const;

const normalizeStatus = (value?: string | null): keyof typeof statusConfig =>
  value === "closed" ? "closed" : "open";

const toLabel = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const getFileName = (url: string) => {
  try {
    const raw = url.split("/").pop()?.split("?")[0] || url;
    return decodeURIComponent(raw);
  } catch {
    return url;
  }
};

const FileIcon = ({ name }: { name: string }) => {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext))
    return <Image className="h-7 w-7" />;
  if (ext === "pdf") return <FileText className="h-7 w-7" />;
  return <File className="h-7 w-7" />;
};

const BrandClaimDetail = () => {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: claim, isLoading, refetch } = useBrandClaim(claimId);
  const { profile, canWrite } = useAuth();
  const slugPrefix = useAuthSlug();
  const statusKey = normalizeStatus((claim as any)?.status);
  const status = statusConfig[statusKey];
  const policy = (claim as any)?.policies as any;
  const [confirmClose, setConfirmClose] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const attachments: string[] = Array.isArray((claim as any)?.media) ? (claim as any).media : [];

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft" && lightboxIndex > 0) setLightboxIndex((i) => (i ?? 0) - 1);
      if (e.key === "ArrowRight" && lightboxIndex < attachments.length - 1) setLightboxIndex((i) => (i ?? 0) + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, attachments.length]);

  const handleClose = async () => {
    if (!claim?.id) return;
    setIsClosing(true);
    const { error } = await supabase.from("claims").update({ status: "closed" }).eq("id", claim.id);
    setIsClosing(false);
    setConfirmClose(false);
    if (error) { toast({ title: "Update failed", description: parseError(error) }); return; }
    await refetch();
    toast({ title: "Claim closed", description: `Claim #${claim.id} has been closed.` });
  };


  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="mb-8 h-8 w-32 rounded-lg bg-secondary/60 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-40 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="space-y-6">
            {[1, 2].map((i) => (
              <div key={i} className="glass-card p-6 space-y-3">
                <div className="h-5 w-28 rounded bg-secondary/60 animate-pulse" />
                <div className="h-4 w-full rounded bg-secondary/40 animate-pulse" />
                <div className="h-4 w-2/3 rounded bg-secondary/40 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
        <div className="glass-card p-6">
          <p className="text-sm text-muted-foreground">Claim not found.</p>
          <button
            type="button"
            onClick={() => navigate(`${slugPrefix}/claims`)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to claims
          </button>
        </div>
      </div>
    );
  }

  const customerName = `${policy?.profiles?.first_name || ""} ${policy?.profiles?.last_name || ""}`.trim() || policy?.profiles?.email || "Unknown customer";
  const productName = policy?.catalogues?.name || "Unknown product";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in">
      <div className="mb-6 md:mb-8">
        <Link to={`${slugPrefix}/claims`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Claims
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">Claim #{claim.id}</h1>
              <Badge className={`${status.color} border`}>
                <status.icon className="h-3 w-3 mr-1" /> {status.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Submitted on {(claim as any).created_at ? new Date((claim as any).created_at).toLocaleDateString() : "—"}
            </p>
          </div>
          {canWrite && statusKey === "open" && (
            <Button variant="outline" onClick={() => setConfirmClose(true)}>
              <XCircle className="h-4 w-4 mr-1.5" /> Close Claim
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Claim Description</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">{toLabel((claim as any).type) || "General"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{(claim as any).description || "No description provided."}</p>
                <p className="mt-4 text-xs text-muted-foreground">
                  Incident: { (claim as any).incident_city ? `${(claim as any).incident_city}, ${(claim as any).incident_country || ""}`.trim() : "Unknown" }
                  { (claim as any).incident_date ? ` · ${new Date((claim as any).incident_date).toLocaleDateString()}` : "" }
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Paperclip className="h-4 w-4" /> Attached Files ({attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {attachments.length ? (
                  <div className="grid grid-cols-2 gap-3">
                    {attachments.map((file: string, i: number) => {
                      const name = getFileName(file);
                      const ext = name.split(".").pop()?.toLowerCase() || "";
                      const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
                      const isPdf = ext === "pdf";
                      return (
                        <button
                          key={i}
                          onClick={() => setLightboxIndex(i)}
                          title={`${name} — click to expand`}
                          className="group relative rounded-xl border border-border bg-secondary/30 overflow-hidden transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          {isImage ? (
                            <img src={file} alt={name} className="w-full h-48 object-cover transition-transform group-hover:scale-[1.02]" />
                          ) : isPdf ? (
                            <div className="w-full h-48 pointer-events-none">
                              <embed src={file} type="application/pdf" className="w-full h-full" />
                            </div>
                          ) : (
                            <div className="flex h-36 w-full flex-col items-center justify-center gap-2 p-4">
                              <File className="h-10 w-10 text-muted-foreground" />
                              <span className="text-center text-xs text-muted-foreground leading-tight line-clamp-2">{name}</span>
                            </div>
                          )}
                          {/* Hover overlay with expand hint */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-medium bg-black/50 rounded-full px-3 py-1">Expand</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No files attached.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>

        </div>

        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" /> Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm overflow-hidden">
                <div>
                  <p className="text-muted-foreground text-xs">Name</p>
                  <p className="font-medium text-foreground">{customerName}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Email</p>
                  <p className="font-medium text-foreground break-all">{policy?.profiles?.email || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Phone</p>
                  <p className="font-medium text-foreground">{policy?.profiles?.phone_number || "—"}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" /> Product
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {policy?.catalogues?.picture && (
                  <div className="h-20 w-20 rounded-xl overflow-hidden bg-gradient-to-br from-[#f5f0e8] to-[#ede8df] p-2 mb-1">
                    <img
                      src={policy.catalogues.picture}
                      alt={productName}
                      className="h-full w-full object-contain mix-blend-multiply"
                    />
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Name</p>
                  <p className="font-medium text-foreground">{productName}</p>
                </div>
                {policy?.catalogues?.category && (
                  <div>
                    <p className="text-muted-foreground text-xs">Category</p>
                    <p className="font-medium text-foreground">{toLabel(policy.catalogues.category)}</p>
                  </div>
                )}
                {policy?.catalogues?.collection && (
                  <div>
                    <p className="text-muted-foreground text-xs">Collection</p>
                    <p className="font-medium text-foreground">{policy.catalogues.collection}</p>
                  </div>
                )}
                {(policy?.catalogues as any)?.sku && (
                  <div>
                    <p className="text-muted-foreground text-xs">SKU</p>
                    <p className="font-medium text-foreground font-mono text-xs tracking-wide">{(policy.catalogues as any).sku}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
      {lightboxIndex !== null && (() => {
        const file = attachments[lightboxIndex];
        const name = getFileName(file);
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext);
        const isPdf = ext === "pdf";
        const hasPrev = lightboxIndex > 0;
        const hasNext = lightboxIndex < attachments.length - 1;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxIndex(null)}
          >
            {/* Close */}
            <button
              className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Prev */}
            {hasPrev && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            {/* Next */}
            {hasNext && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            {/* Content */}
            <div
              className="relative max-h-[90vh] max-w-[90vw] flex flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={lightboxIndex}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center justify-center"
                >
                  {isImage ? (
                    <img
                      src={file}
                      alt={name}
                      className="max-h-[80vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
                    />
                  ) : isPdf ? (
                    <div className="bg-white rounded-xl overflow-hidden shadow-2xl" style={{ width: "min(85vw, 800px)", height: "80vh" }}>
                      <embed src={file} type="application/pdf" className="w-full h-full" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 rounded-xl bg-white/10 p-12 text-white">
                      <File className="h-16 w-16 opacity-60" />
                      <p className="text-sm font-medium opacity-80 max-w-xs text-center break-all">{name}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Bottom bar */}
              <div className="flex items-center gap-4">
                <span className="text-white/60 text-xs">{lightboxIndex + 1} / {attachments.length}</span>
                <a
                  href={file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in tab
                </a>
                <a
                  href={file}
                  download={name}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmClose(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-border/50">
              <h2 className="font-serif text-lg font-semibold text-foreground">Close this claim?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Claim #{claim?.id} will be marked as closed. This action can be undone by editing the claim.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                onClick={() => setConfirmClose(false)}
                className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={isClosing}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isClosing ? "Closing…" : "Close Claim"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BrandClaimDetail;
