import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, Copy, ExternalLink, Loader2, Trash2, Video } from "lucide-react";
import { untyped } from "@/integrations/supabase/untyped";
import { Skeleton } from "@/components/ui/skeleton";
import type { StageState } from "@/lib/commercialCycle";

// The demo itself: is there anything to show, the logins to hand over, and the way to take
// it all out again at hand-over.
//
// This was BrandOnboarding — a second screen inside step 3 that drew its own copy of the
// stage list, its own Refresh button and its own eight-second poller against a function the
// parent was already polling every six seconds. The stages moved to PipelinePanel, which
// there is now exactly one of; the parent owns the polling; and what is left here is the
// part that was actually about the demo.

type Account = { email: string; password: string; portal: string };
type PurgePreview = {
  will_remove: Record<string, number>;
  will_remove_logins: { email: string; role: string }[];
  will_keep: Record<string, number>;
};

/** The finished film, as the cycle's artefact list carries it. */
type Film = { file_name: string; generated_at: string; download_url: string | null; watch_url?: string | null };

type Props = {
  brandId: number;
  brandName: string;
  stages: Record<string, StageState> | undefined;
  /** Undefined until the overview has been read. "Not demo ready yet" is a verdict. */
  counts: Record<string, number> | undefined;
  demoAllowed: boolean;
  demoBlockedReason?: string | null;
  /** The recorded film, once one exists. Null while there has never been one. */
  film?: Film | null;
  onChanged: () => void;
};

export default function DemoPanel({
  brandId, brandName, stages, counts, demoAllowed, demoBlockedReason, film, onChanged,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [avgTicket, setAvgTicket] = useState("");
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  // Undefined until read. A toggle that renders "off" before it knows is a toggle somebody
  // flips twice.
  const [assistantOnly, setAssistantOnly] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await untyped.from("brands")
        .select("demo_assistant_only").eq("id", brandId).maybeSingle();
      if (live) setAssistantOnly((data as { demo_assistant_only?: boolean } | null)?.demo_assistant_only === true);
    })();
    return () => { live = false; };
  }, [brandId]);

  const setAssistantOnlyMode = async (next: boolean) => {
    setBusy("scope");
    const { error } = await untyped.from("brands")
      .update({ demo_assistant_only: next }).eq("id", brandId);
    setBusy(null);
    if (error) {
      toast({ title: "Could not change the demo scope", description: error.message, variant: "destructive" });
      return;
    }
    setAssistantOnly(next);
    toast({
      title: next ? "Assistant-only demo" : "Full portal",
      description: next
        ? `${brandName}'s portal now shows the assistant and the knowledge base only.`
        : `${brandName}'s portal shows every screen again.`,
    });
  };

  // The demo film. It is recorded by a GitHub runner rather than here — it needs a browser
  // and a video encoder — so this queues the run and the finished film turns up in the
  // brand's files a few minutes later. See build-collateral's record_demo_video.
  const [runUrl, setRunUrl] = useState<string | null>(null);
  // When this session asked for one, so the panel can tell "a film exists" from "the film
  // you just asked for has landed", and can stop waiting for it.
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  const filmedAt = film?.generated_at ? Date.parse(film.generated_at) : null;
  const waiting = waitingSince !== null && !(filmedAt && filmedAt > waitingSince);
  // A film shows the book it was recorded on. Ferragamo's went out asking for "our top ten
  // clients" because it was recorded seven hours before its book existed. A new book now
  // re-records an existing film by itself (onboard-brand's refilmAfterNewBook); this is what
  // the screen says until the new one lands, or when the re-record could not be started.
  const bookAt = stages?.demo_data?.status === "done" && stages.demo_data.finished_at
    ? Date.parse(stages.demo_data.finished_at) : null;
  const filmStale = !!(filmedAt && bookAt && filmedAt < bookAt);
  const refilm = (stages?.demo_data?.detail as { film?: { requeued?: boolean; reason?: string } } | undefined)?.film;

  // The runner takes a few minutes and posts the film back through an edge function, so
  // nothing in this tab knows it arrived. The parent polls the overview only while a stage
  // is running, and recording is not a stage — without this the film is there and the
  // screen still says it is being made until somebody reloads the page.
  useEffect(() => {
    if (!waiting) return;
    const started = waitingSince!;
    const t = setInterval(() => {
      // Twelve minutes is well past a two-minute film on a cold runner; after that the run
      // has failed and the link to the run is the thing to look at, not this timer.
      if (Date.now() - started > 12 * 60_000) { setWaitingSince(null); return; }
      onChanged();
    }, 20_000);
    return () => clearInterval(t);
  }, [waiting, waitingSince, onChanged]);

  const recordFilm = async () => {
    setBusy("film");
    setRunUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("build-collateral", {
        body: { brand_id: brandId, kind: "record_demo_video" },
      });
      if (error) throw new Error(error.message);
      const d = data as { ok?: boolean; reason?: string; run_url?: string };
      if (d?.ok === false) throw new Error(d.reason ?? "unknown error");
      setRunUrl(d?.run_url ?? null);
      setWaitingSince(Date.now());
      toast({
        title: "Recording started",
        description: `A film of ${assistantOnly ? `${brandName}'s assistant` : `the ${brandName} platform`} is being made. It takes a few minutes and lands in this brand's files.`,
      });
    } catch (e) {
      toast({
        title: "Could not start the recording",
        description: e instanceof Error ? e.message : "unknown error",
        variant: "destructive",
      });
    } finally { setBusy(null); }
  };

  const call = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("onboard-brand", {
      body: { brand_id: brandId, ...payload },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data as Record<string, unknown>;
  };

  // Both of these are facts about the RUN, not about this component, so they are read from
  // the stage rows the parent already has. As component state they survived nothing — not a
  // refresh, and not a colleague opening the same brand.
  const accounts = useMemo(() => {
    const d = stages?.demo_users?.detail as { accounts?: Record<string, Account> } | undefined;
    return d?.accounts ?? null;
  }, [stages]);

  // The generator reports { ok: false, needs: 'avg_ticket' } for a site that renders its
  // prices in JavaScript. That is a question for the admin, not a failure.
  const needsTicket = (stages?.demo_data?.detail as { needs?: string } | undefined)?.needs === "avg_ticket";

  const nothingToPurge = !!preview
    && !Object.keys(preview.will_remove ?? {}).length
    && !preview.will_remove_logins?.length;

  const c = counts ?? {};
  // An assistant-only demo shows the assistant and nothing else, so it needs no book of
  // business. Asking for covers anyway locked the film behind a catalogue Brunello Cucinelli
  // cannot give us — the one house the assistant-only demo was the way round.
  const bookNeeded = assistantOnly !== true;
  const ready = (c.knowledge_chunks ?? 0) > 0 && (c.brand_users ?? 0) > 0
    && (!bookNeeded || ((c.policies ?? 0) > 0 && (c.customers ?? 0) > 0));
  const blocking = [
    (c.knowledge_chunks ?? 0) === 0 && "nothing indexed yet (Website & news)",
    bookNeeded && (c.customers ?? 0) === 0 && "no clients (Demo book of business)",
    bookNeeded && (c.policies ?? 0) === 0 && "no covers (Demo book of business)",
    (c.brand_users ?? 0) === 0 && "no logins (Demo logins)",
  ].filter(Boolean) as string[];

  const generateWithTicket = async () => {
    setBusy("ticket");
    try {
      await call({ action: "start", stages: ["demo_data"], options: { avg_ticket: Number(avgTicket.trim()) } });
      toast({ title: "Queued", description: "The book of business is being rebuilt around that price." });
      onChanged();
    } catch (e) {
      toast({ title: "Could not queue", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Never purge blind: fetch exactly what would go and what would stay, and make the admin
  // confirm against that list.
  const openPurge = async () => {
    setBusy("purge");
    try { setPreview(await call({ action: "preview_purge" }) as unknown as PurgePreview); }
    catch (e) { toast({ title: "Could not read the demo data", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const confirmPurge = async () => {
    setBusy("purge");
    try {
      const out = await call({ action: "purge_demo" });
      const removed = (out.removed_logins as string[] | undefined)?.length ?? 0;
      toast({
        title: "Demo data removed",
        description: `${sumCounts((out.purged as { deleted?: Record<string, number> })?.deleted)} rows and ${removed} login${removed === 1 ? "" : "s"} deleted. The brand, its indexed site and its catalogue are untouched.`,
      });
      setPreview(null);
      onChanged();
    } catch (e) {
      toast({ title: "Purge failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (!counts) return <Skeleton className="h-24 w-full rounded-lg" />;

  if (!demoAllowed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {demoBlockedReason ??
            "Demo generation is not available for this brand here. Crawling, catalogue, documents and the assistant all run."}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 text-sm ${ready ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/40"}`}>
        {ready
          ? <span className="font-medium text-emerald-700 dark:text-emerald-400">{bookNeeded
              ? "Demo ready — both portals have something to show."
              : "Demo ready — the assistant has the site to answer from, and the logins exist."}</span>
          : <span className="text-muted-foreground">Not demo ready yet: {blocking.join(" · ")}</span>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{c.customers ?? 0} clients</span>
          <span>{c.policies ?? 0} covers</span>
          <span>{c.shops ?? 0} boutiques</span>
          <span>{c.brand_users ?? 0} logins</span>
          {(c.crawl_pending ?? 0) > 0 && (
            <span className="text-amber-600">{c.crawl_pending} pages still crawling…</span>
          )}
        </div>
      </div>

      {needsTicket && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm">
            This site renders its prices in JavaScript, so none could be scraped. Give a typical retail
            price and the demo covers will be valued around it — the pieces themselves stay real.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={avgTicket} onChange={(e) => setAvgTicket(e.target.value)} inputMode="numeric" placeholder="e.g. 4200"
              className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">EUR</span>
            <button onClick={() => void generateWithTicket()} disabled={!avgTicket.trim() || busy !== null}
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
              {busy === "ticket" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
            </button>
          </div>
        </div>
      )}

      {/* What the prospect will see when they log in.
          "If we give them the AI assistant to test, I'd make sure only the relevant content
          is there — I'd take out the Cover, Claim etc." Those screens are the insurance
          programme, and in a meeting about the assistant they are four entries of a product
          that is not being discussed, seeded with claims for a programme nobody has bought.

          And the other way round: "Platform Demo — Full Portal shall focus on the whole
          platform (AI assistant is not core at all)." Full portal is the default and the
          demo being sold — the programme, brand side and client side. The assistant is one
          screen in it, listed last here so the hint does not read as if it were the point. */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium">What the demo shows</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {([
            { value: false, label: "Full portal", hint: "The whole platform, brand side and client side — clients, covers, claims, boutiques, insights; the assistant is one screen among them" },
            { value: true, label: "Assistant + knowledge only", hint: "The assistant and the knowledge base. Nothing else is reachable, typed URLs included" },
          ] as const).map((opt) => {
            const on = assistantOnly === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                title={opt.hint}
                disabled={assistantOnly === null || busy !== null}
                onClick={() => void setAssistantOnlyMode(opt.value)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                  on ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {busy === "scope" && !on ? <Loader2 className="h-4 w-4 animate-spin" /> : opt.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {assistantOnly === null
            ? "Reading the current setting…"
            : assistantOnly
              ? "Covers, claims, clients, boutiques and insights are hidden for every user of this brand — including the brand's own logins. Switch back before a programme goes live."
              : "The prospect sees the whole platform: the brand's clients, covers, claims, boutiques and insights, and the client portal where a client sees their covers and opens a claim. The assistant is there, but it is not the demo."}
        </p>
      </div>

      {/* A film of the demo, for a prospect who is not in the room.
          It films whichever demo the toggle above sets up, because a film of the assistant
          sent to a brand being shown the whole programme demonstrates the one part that is
          not being sold — which is exactly what the first one did. The recorder reads the
          mode off the portal itself (scripts/demo-video.mjs), so this copy and the film
          cannot disagree. Until the mode is read, nothing is promised. */}
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Demo film</p>
        <p className="mb-2 text-xs text-muted-foreground">
          {assistantOnly === null
            ? "Recorded off the live portal."
            : assistantOnly
              ? "Two minutes of this brand's own assistant answering three of its own opening questions, recorded off the live portal."
              : "A two-minute tour of the platform on this brand's demo, recorded off the live portal: home, clients, covers, claims, boutiques and insights on the brand side, then the client portal — the client's own covers and the claim form they would open."}{" "}
          It is made by a runner rather than in the browser, so it keeps going after you close
          this — look in the brand's files.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void recordFilm()}
            disabled={busy !== null || !ready}
            title={ready ? undefined : bookNeeded
              ? "The demo needs its book of business and its logins first"
              : "The demo needs the site indexed and its logins first"}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {busy === "film" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            Record a demo film
          </button>
          {runUrl && (
            <a href={runUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Watch it being made <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {waiting && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Recording — the film appears here when it lands.
            </span>
          )}
        </div>

        {/* The film itself.
          *
          * "I can see the video being built — how do I get to it and play it?" It was posted
          * back into the brand's artefact list and nothing on this panel said so, and the
          * artefact list only offers a download: an mp4 saved to Downloads is not a demo you
          * can put in front of somebody in the next thirty seconds. It plays here. */}
        {filmStale && !waiting && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This film was recorded before the current demo book was built
              ({new Date(bookAt!).toLocaleString()}), so it shows the old one — or none.{" "}
              {refilm?.requeued
                ? "A new one was started when the book was built and replaces it when it lands."
                : `Record it again before sending it${refilm?.reason ? ` (the automatic re-record did not start: ${refilm.reason})` : ""}.`}
            </span>
          </div>
        )}
        {!bookNeeded && ready && (c.customers ?? 0) === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No clients yet, so the film skips the client questions. Build the demo book and it is re-recorded with them.
          </p>
        )}

        {film?.download_url && (
          <div className="mt-3 space-y-2">
            <video
              src={film.watch_url ?? film.download_url}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-lg border border-border bg-black"
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Recorded {new Date(film.generated_at).toLocaleString()}</span>
              {/* What to send: a link that plays in the browser, sharp, for thirty days. The mp4
                * itself goes through WhatsApp's recompression and arrives as a download. */}
              {film.watch_url && (
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(film.watch_url!); toast({ title: "Link copied", description: "It plays in the browser for 30 days." }); }}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Copy className="h-3 w-3" /> Copy the link to watch it
                </button>
              )}
              <a href={film.download_url} download={film.file_name}
                className="inline-flex items-center gap-1 text-primary hover:underline">
                Download the mp4
              </a>
              <span>Re-recording replaces this one.</span>
            </div>
          </div>
        )}
      </div>

      {accounts && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Demo logins</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Hand these to the prospect. Re-running the stage keeps the same credentials.
          </p>
          <ul className="space-y-2">
            {Object.entries(accounts).map(([key, a]) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{key.replace(/_/g, " ")}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{a.email} · {a.password}</code>
                <span className="shrink-0 text-xs text-muted-foreground">{a.portal}</span>
                <button
                  className="shrink-0 rounded border border-border p-1"
                  onClick={() => { void navigator.clipboard.writeText(`${a.email} / ${a.password}`); toast({ title: "Copied" }); }}
                  aria-label={`Copy the ${key.replace(/_/g, " ")} login`}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview ? (
        <div className={`rounded-lg border p-3 ${nothingToPurge ? "border-border bg-muted/40" : "border-destructive/40 bg-destructive/5"}`}>
          <p className="text-sm font-medium">Remove the demo data from {brandName}?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everything generated for the demo is deleted. Everything harvested from the brand — the
            indexed site, the news, the catalogue, the brand record itself — stays.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Deleted</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(preview.will_remove ?? {}).map(([k, n]) => <li key={k}>{n} {label(k)}</li>)}
                {preview.will_remove_logins?.map((l) => <li key={l.email} className="truncate">login {l.email}</li>)}
                {!Object.keys(preview.will_remove ?? {}).length && !preview.will_remove_logins?.length && (
                  <li>nothing — no demo data on this brand</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Kept</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(preview.will_keep ?? {}).map(([k, n]) => <li key={k}>{n} {label(k)}</li>)}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {/* Nothing to remove is not a thing to offer to remove. */}
            <button onClick={() => void confirmPurge()} disabled={busy !== null || nothingToPurge}
              title={nothingToPurge ? "There is no demo data on this brand" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">
              {busy === "purge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete the demo data
            </button>
            <button onClick={() => setPreview(null)} disabled={busy !== null}
              className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => void openPurge()} disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50">
          {busy === "purge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove demo data
        </button>
      )}
    </div>
  );
}

function sumCounts(o?: Record<string, number>): number {
  return Object.values(o ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

const LABELS: Record<string, string> = {
  profiles: "demo clients", policies: "demo covers", catalogues: "demo catalogue items",
  shops: "demo boutiques", claims: "demo claims", feedback: "demo feedback",
  events: "seeded events", event_attendees: "seeded attendees",
  brand_record: "brand record", knowledge_docs: "indexed pages",
  knowledge_chunks: "knowledge chunks", knowledge_sources: "knowledge sources",
  catalogue_products: "catalogue products", real_customers: "real clients",
  real_policies: "real covers",
};
function label(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}
