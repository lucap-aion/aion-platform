import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { untyped } from "@/integrations/supabase/untyped";

// Whether this brand's staff get Discussions — threads, @mentions, the notification bell
// and the emails (brands.discussions_enabled). Off, the sidebar entry, the bell and the
// assistant's "Discuss with team" button disappear, and the database refuses staff access
// to the threads. Nothing is deleted: switching back on brings every thread back.
// Same shape as AssistantSwitch, beside it on the brand page.
export default function DiscussionsSwitch({ brandId, brandName }: { brandId: number; brandName: string }) {
  // Undefined until read, so it is never flipped from a guess.
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await untyped.from("brands")
        .select("discussions_enabled").eq("id", brandId).maybeSingle();
      if (live) setOn((data as { discussions_enabled?: boolean } | null)?.discussions_enabled !== false);
    })();
    return () => { live = false; };
  }, [brandId]);

  const flip = async () => {
    if (on === null) return;
    const next = !on;
    setBusy(true);
    const { error } = await untyped.from("brands").update({ discussions_enabled: next }).eq("id", brandId);
    setBusy(false);
    if (error) {
      toast({ title: "Could not change Discussions", description: error.message, variant: "destructive" });
      return;
    }
    setOn(next);
    toast({
      title: next ? "Discussions on" : "Discussions off",
      description: next
        ? `${brandName}'s staff now see Discussions, the notification bell and "Discuss with team".`
        : `${brandName}'s staff no longer see Discussions. Their threads are kept.`,
    });
  };

  return (
    <button type="button" onClick={() => void flip()} disabled={on === null || busy}
      title="Whether this brand's staff get Discussions: threads, @mentions, notifications and emails"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
      <MessagesSquare className="h-3.5 w-3.5" />
      {on === null ? "Discussions…" : on ? "Discussions on" : "Discussions off"}
    </button>
  );
}
