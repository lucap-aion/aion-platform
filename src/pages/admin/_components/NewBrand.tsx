import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";

// Starting a brand: a name and a website.
//
// It used to be the full record — forty-odd fields across basic info, five image
// uploads, theme colours, fonts, FAQ JSON in two languages, Chubb reporting
// flags and four fee fields — presented to someone who has just got off a first
// call and knows two things about the prospect. Everything in it that CAN be
// discovered is discovered from the website: the logo, the colours, the
// description, the hero imagery, the catalogue, the whole knowledge base.
//
// So this asks for the two facts nobody can derive, creates the brand, and
// starts the pipeline. The full record is the Record tab, for the things a human
// genuinely decides — fees, Chubb prefix, coverage ceiling — once there is
// something to decide them about.

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const normaliseUrl = (raw: string) => {
  const t = raw.trim().replace(/\s+/g, "");
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t.replace(/\/+$/, "") : `https://${t.replace(/\/+$/, "")}`;
};

export default function NewBrand() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  const url = normaliseUrl(website);
  const urlLooksReal = /^https?:\/\/[^/\s.]+\.[^/\s]+/.test(url);
  const ready = name.trim().length > 1 && urlLooksReal;

  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.from("brands")
        .insert({ name: name.trim(), slug: slugify(name), website: url, status: "pending" })
        .select("id").single();
      if (error) throw new Error(error.message);
      const id = (data as { id: number }).id;

      // Queue immediately. It runs on the cron tick, so this returns straight
      // away and the work survives closing the tab — the point being that the
      // admin never has to come back and press "start" on anything.
      const { error: fnErr } = await supabase.functions.invoke("onboard-brand", {
        body: { brand_id: id, action: "start" },
      });
      if (fnErr) {
        toast({
          title: "Brand created, but the pipeline did not start",
          description: `${fnErr.message} — open the Commercial cycle tab and run it from there.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${name.trim()} created`,
          description: "Reading the site, pulling the catalogue and drafting the collateral. It runs in the background.",
        });
      }
      navigate(`/admin/brands/${id}?tab=cycle`);
    } catch (e) {
      toast({ title: "Could not create the brand", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Brand name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pasquale Bruni"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Website</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="pasqualebruni.com"
            onKeyDown={(e) => { if (e.key === "Enter" && ready && !busy) void create(); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          <span className="text-xs text-muted-foreground">
            {website.trim() && !urlLooksReal
              ? <span className="text-amber-600">That does not look like a domain yet.</span>
              : <>Everything else is read from here — the logo, the colours, the catalogue and the knowledge base.</>}
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5" /> What starts on its own
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          <li>Brand identity — logo, colours, description and hero imagery from their site</li>
          <li>Website and news indexed into the knowledge base</li>
          <li>Catalogue detected and pulled, with the product images embedded</li>
          <li>Intro deck and ops deck built, data-request workbook prepared</li>
          <li>FAQ, sales one-pager, cover summary, activation email and proposal drafted</li>
        </ul>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Fees, the Chubb prefix and the coverage ceiling stay on the Record tab — those are decisions, not facts about the website.
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => void create()} disabled={!ready || busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Create and start
        </button>
        <button onClick={() => navigate("/admin/brands")} disabled={busy}
          className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
      </div>
    </div>
  );
}
