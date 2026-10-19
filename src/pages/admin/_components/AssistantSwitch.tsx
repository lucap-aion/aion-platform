import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { untyped } from "@/integrations/supabase/untyped";

// Whether this brand's own users see the AI Assistant and the knowledge base
// (brands.assistant_enabled). Off, the brand keeps the navigation it had before
// either existed: "Ask the data", no Knowledge. Admins see both regardless.
export default function AssistantSwitch({ brandId, brandName }: { brandId: number; brandName: string }) {
  // Undefined until read. A toggle that renders "off" before it knows is a toggle somebody
  // flips twice.
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await untyped.from("brands")
        .select("assistant_enabled").eq("id", brandId).maybeSingle();
      if (live) setOn((data as { assistant_enabled?: boolean } | null)?.assistant_enabled !== false);
    })();
    return () => { live = false; };
  }, [brandId]);

  const flip = async () => {
    if (on === null) return;
    const next = !on;
    setBusy(true);
    const { error } = await untyped.from("brands").update({ assistant_enabled: next }).eq("id", brandId);
    setBusy(false);
    if (error) {
      toast({ title: "Could not change the assistant", description: error.message, variant: "destructive" });
      return;
    }
    setOn(next);
    toast({
      title: next ? "Assistant on" : "Assistant off",
      description: next
        ? `${brandName}'s users now see the AI Assistant and Knowledge.`
        : `${brandName}'s users see "Ask the data" again, and no Knowledge.`,
    });
  };

  return (
    <button type="button" onClick={() => void flip()} disabled={on === null || busy}
      title="Whether this brand's own users see the AI Assistant and the knowledge base"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
      <MessageSquare className="h-3.5 w-3.5" />
      {on === null ? "Assistant…" : on ? "Assistant on for brand users" : "Assistant off for brand users"}
    </button>
  );
}
