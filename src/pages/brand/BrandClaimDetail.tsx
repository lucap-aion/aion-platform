import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, CheckCircle2, XCircle, Clock, Send, Paperclip, User, Calendar, Shield, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const claimsData: Record<string, {
  id: string; customer: string; email: string; phone: string;
  product: string; coverPlan: string; type: string; date: string;
  status: "Under Review" | "Approved" | "Rejected";
  description: string;
  files: { name: string; size: string; type: string }[];
  notes: { author: string; date: string; text: string }[];
}> = {
  "CLM-047": {
    id: "CLM-047", customer: "Allegra Bianchi", email: "allegra@email.com", phone: "+39 331 234 5678",
    product: "Anello Nudo Classic", coverPlan: "Premium Protection", type: "Accidental Damage",
    date: "Mar 07, 2026", status: "Under Review",
    description: "The ring was accidentally dropped on a marble floor, resulting in a visible chip on the gemstone and a slight bend in the band. The damage occurred at home during routine wear.",
    files: [
      { name: "damage-photo-1.jpg", size: "2.4 MB", type: "image" },
      { name: "damage-photo-2.jpg", size: "1.8 MB", type: "image" },
      { name: "purchase-receipt.pdf", size: "340 KB", type: "document" },
    ],
    notes: [
      { author: "System", date: "Mar 07, 2026 — 10:15", text: "Claim submitted by customer via the portal." },
      { author: "Maria Conti", date: "Mar 07, 2026 — 14:30", text: "Photos reviewed. Damage consistent with accidental impact. Forwarding to appraisal team." },
    ],
  },
  "CLM-046": {
    id: "CLM-046", customer: "Marco Rossi", email: "marco.rossi@email.com", phone: "+39 342 567 8901",
    product: "Bracciale Iconica", coverPlan: "Complete Cover", type: "Theft",
    date: "Mar 05, 2026", status: "Approved",
    description: "Bracelet was stolen during a break-in at the customer's residence. Police report has been filed and attached.",
    files: [
      { name: "police-report.pdf", size: "520 KB", type: "document" },
      { name: "insurance-declaration.pdf", size: "180 KB", type: "document" },
    ],
    notes: [
      { author: "System", date: "Mar 05, 2026 — 09:00", text: "Claim submitted by customer via the portal." },
      { author: "Luca Verdi", date: "Mar 05, 2026 — 11:45", text: "Police report verified. Claim meets all criteria for approval." },
      { author: "Maria Conti", date: "Mar 06, 2026 — 09:20", text: "Approved. Replacement order initiated." },
    ],
  },
};

const statusConfig = {
  "Under Review": { color: "bg-warning/10 text-warning border-warning/20", icon: Clock },
  "Approved": { color: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
  "Rejected": { color: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle },
};

const BrandClaimDetail = () => {
  const { claimId } = useParams();
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");

  const claim = claimsData[claimId || ""] || claimsData["CLM-047"];
  const { icon: StatusIcon, color: statusColor } = statusConfig[claim.status];

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    toast({ title: "Note added", description: "Your note has been saved to this claim." });
    setNewNote("");
  };

  const handleStatusChange = (newStatus: string) => {
    toast({ title: `Claim ${newStatus}`, description: `Claim ${claim.id} has been ${newStatus.toLowerCase()}.` });
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <Link to="/brand/claims" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Claims
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{claim.id}</h1>
              <Badge className={`${statusColor} border`}>
                <StatusIcon className="h-3 w-3 mr-1" /> {claim.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Submitted on {claim.date}</p>
          </div>
          {claim.status === "Under Review" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => handleStatusChange("Rejected")}>
                <XCircle className="h-4 w-4 mr-1.5" /> Reject
              </Button>
              <Button className="bg-success hover:bg-success/90 text-white" onClick={() => handleStatusChange("Approved")}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Claim description */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Claim Description</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">{claim.type}</Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{claim.description}</p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Attached files */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Paperclip className="h-4 w-4" /> Attached Files ({claim.files.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {claim.files.map((file, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-secondary/30">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                          {file.type === "image" ? "🖼" : "📄"}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{file.size}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Notes & Comments */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Notes & Comments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {claim.notes.map((note, i) => (
                  <div key={i} className="relative pl-4 border-l-2 border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">{note.author}</span>
                      <span className="text-xs text-muted-foreground">{note.date}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{note.text}</p>
                  </div>
                ))}

                <Separator />

                <div className="space-y-3">
                  <Textarea
                    placeholder="Add a note or comment..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="min-h-[80px] bg-background"
                  />
                  <Button onClick={handleAddNote} disabled={!newNote.trim()} size="sm">
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Add Note
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Sidebar info */}
        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="glass-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" /> Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Name</p>
                  <p className="font-medium text-foreground">{claim.customer}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Email</p>
                  <p className="font-medium text-foreground">{claim.email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Phone</p>
                  <p className="font-medium text-foreground">{claim.phone}</p>
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
                <div>
                  <p className="text-muted-foreground text-xs">Item</p>
                  <p className="font-medium text-foreground">{claim.product}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Cover Plan</p>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" /> {claim.coverPlan}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Claim Type</p>
                  <p className="font-medium text-foreground">{claim.type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Submitted</p>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> {claim.date}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default BrandClaimDetail;
