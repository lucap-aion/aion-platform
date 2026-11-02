import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus, XCircle } from "lucide-react";
import { untyped } from "@/integrations/supabase/untyped";
import { toast } from "@/hooks/use-toast";

// One link per person the film is sent to, and whether they opened it.
//
// The single signed URL says nothing about who watched: forwarded, it is the same link in
// every hand, and storage keeps no viewer log. A link made for a named recipient is
// something the panel can report on — opened or not, when, and how far they got.

type View = { opened_at: string; last_seen_at: string; max_position_s: number; duration_s: number | null; completed: boolean; country: string | null };
type Link = {
  id: string; token: string; recipient_name: string; recipient_email: string | null;
  created_at: string; revoked_at: string | null; demo_video_views: View[];
};

const pct = (v: View) => (v.duration_s && v.duration_s > 0 ? Math.min(100, Math.round((Number(v.max_position_s) / Number(v.duration_s)) * 100)) : null);

export default function WatchLinks({ brandId }: { brandId: number }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data } = await untyped.from("demo_video_links")
      .select("id, token, recipient_name, recipient_email, created_at, revoked_at, demo_video_views(opened_at, last_seen_at, max_position_s, duration_s, completed, country)")
      .eq("brand_id", brandId).order("created_at", { ascending: false });
    setLinks((data ?? []) as Link[]);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);
  // The panel is open while the prospect may be watching: refresh on a slow tick.
  useEffect(() => {
    const t = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const urlFor = (token: string) => `${window.location.origin}/watch/${token}`;
  const copy = (token: string, who: string) => {
    void navigator.clipboard.writeText(urlFor(token));
    toast({ title: "Link copied", description: `The link for ${who}. It plays in the browser; the panel shows when it is opened.` });
  };

  const add = async () => {
    const who = name.trim();
    if (!who) return;
    setBusy(true);
    const { data, error } = await untyped.from("demo_video_links")
      .insert({ brand_id: brandId, recipient_name: who, recipient_email: email.trim() || null })
      .select("token").single();
    setBusy(false);
    if (error || !data) { toast({ title: "Could not create the link", description: error?.message, variant: "destructive" }); return; }
    setName(""); setEmail(""); setAdding(false);
    copy((data as { token: string }).token, who);
    void load();
  };

  const revoke = async (l: Link) => {
    if (!window.confirm(`Stop the link for ${l.recipient_name}? It will no longer play.`)) return;
    await untyped.from("demo_video_links").update({ revoked_at: new Date().toISOString() }).eq("id", l.id);
    void load();
  };

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Who has watched it</p>
          <p className="text-xs text-muted-foreground">
            Make a link per person you send the film to. It says when they opened it and how far they got.
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
            <Plus className="h-3 w-3" /> New link
          </button>
        )}
      </div>

      {adding && (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipient's name"
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (optional)" type="email"
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />} Create and copy
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
        </form>
      )}

      {links === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {links.map((l) => {
            const views = [...(l.demo_video_views ?? [])].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
            const first = views[0];
            const best = views.reduce<number | null>((m, v) => { const p = pct(v); return p === null ? m : Math.max(m ?? 0, p); }, null);
            const done = views.some((v) => v.completed);
            const last = views.reduce<string | null>((m, v) => (!m || v.last_seen_at > m ? v.last_seen_at : m), null);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                <span className="min-w-[10rem] font-medium">
                  {l.recipient_name}
                  {l.recipient_email && <span className="ml-1 font-normal text-muted-foreground">{l.recipient_email}</span>}
                </span>
                <span className="flex-1 text-muted-foreground">
                  {l.revoked_at ? "Stopped" : views.length === 0 ? "Not opened yet" : (
                    <>
                      Opened {views.length > 1 ? `${views.length}× · first ` : ""}{new Date(first.opened_at).toLocaleString()}
                      {first.country ? ` · ${first.country}` : ""}
                      {done ? " · watched to the end" : best !== null ? ` · watched ${best}%` : ""}
                      {last && views.length > 1 ? ` · last ${new Date(last).toLocaleString()}` : ""}
                    </>
                  )}
                </span>
                {!l.revoked_at && (
                  <>
                    <button type="button" onClick={() => copy(l.token, l.recipient_name)}
                      className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                    <button type="button" onClick={() => void revoke(l)} title="Stop this link"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive">
                      <XCircle className="h-3 w-3" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
