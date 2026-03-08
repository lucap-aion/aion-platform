import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Info, Camera } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const claimTypes = ["Theft", "Accidental Damage", "Loss", "Other"];
const countries = ["Italy", "France", "United Kingdom", "Germany", "Switzerland", "United States", "Other"];

const NewClaim = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    claimType: "",
    incidentDate: "",
    incidentCity: "",
    incidentCountry: "",
    description: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Claim submitted successfully. We'll review it shortly.");
    navigate("/claims");
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <Link to="/claims" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Claims
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8">
        <h1 className="font-serif text-2xl font-bold text-foreground mb-2">New Claim</h1>

        <div className="rounded-lg bg-secondary/50 p-4 mb-8">
          <p className="text-xs text-muted-foreground mb-1">Cover</p>
          <p className="text-sm font-semibold text-foreground">
            Collana con pendente Nudo Petit by Pomellato bought at Boutique Pomellato on Mar 08, 2026.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Claim Type */}
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
                {claimTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Incident Date */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                Incident Date <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <input
                type="date"
                value={form.incidentDate}
                onChange={(e) => setForm({ ...form, incidentDate: e.target.value })}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            {/* City */}
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

            {/* Country */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                Incident Country <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </label>
              <select
                value={form.incidentCountry}
                onChange={(e) => setForm({ ...form, incidentCountry: e.target.value })}
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                <option value="">Select Country</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
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

          {/* File Upload */}
          <div>
            <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
              Files <span className="font-normal text-muted-foreground">(upload evidence that can speed up review)</span>
            </label>
            <div className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border transition-colors hover:border-primary/50 hover:bg-primary/5">
              <Camera className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-4 border-t border-border pt-6">
            <Link to="/claims" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-lg bg-primary px-8 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Submit
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default NewClaim;
