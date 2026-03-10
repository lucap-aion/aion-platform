import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, XCircle, Clock, CheckCircle2, Paperclip, User, Package, Image, FileText, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useBrandClaim } from "@/hooks/use-claims";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSlug } from "@/hooks/useAuthSlug";

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

  const handleClose = async () => {
    if (!claim?.id) return;
    const { error } = await supabase.from("claims").update({ status: "closed" }).eq("id", claim.id);
    if (error) { toast({ title: "Update failed", description: error.message }); return; }
    await refetch();
    toast({ title: "Claim closed", description: `Claim #${claim.id} has been closed.` });
  };


  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8 animate-fade-in flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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

  const attachments = Array.isArray((claim as any).media) ? (claim as any).media : [];
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
            <Button variant="outline" onClick={handleClose}>
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
                  <div className="flex flex-wrap gap-3">
                    {attachments.map((file: string, i: number) => {
                      const name = getFileName(file);
                      return (
                        <a
                          key={i}
                          href={file}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={name}
                          className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-secondary/30 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                        >
                          <FileIcon name={name} />
                        </a>
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
    </div>
  );
};

export default BrandClaimDetail;
