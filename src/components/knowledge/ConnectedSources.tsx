// Connected sources — Google Drive and Shopify, kept in sync with the
// knowledge base by source-sync. Lives on the Knowledge page, for the people
// who may change the knowledge (brand masters, AION admins).
//
// Drive: the brand shares a folder with AION's service account and pastes its
// link — see supabase/functions/_shared/gdrive.ts for why not "Sign in with
// Google". Shopify: an OAuth install through shopify-oauth, which comes back
// here with ?connected=shopify or ?connect_error=….

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle, CheckCircle2, Copy, ExternalLink, HardDrive, Loader2, Plug, RefreshCw, ShoppingBag, Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const tt = (locale: string, en: string, it: string) => (locale === "it" ? it : en);

type LastRun = {
  at?: string; listed?: number; indexed?: number; unchanged?: number; skipped?: number;
  failed?: number; removed?: number; remaining?: number;
  skipped_examples?: string[]; failed_examples?: string[];
};

export type ConnectorSource = {
  id: string;
  kind: "gdrive" | "shopify";
  target: string;
  label: string | null;
  enabled: boolean;
  status: "ok" | "error" | "syncing";
  last_error: string | null;
  last_synced_at: string | null;
  sync_started_at: string | null;
  items_indexed: number;
  config: { folder_url?: string; last_run?: LastRun } | null;
};

type CallFn = (fn: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

// A run that claimed the source more than ten minutes ago died; don't spin forever.
const isSyncing = (s: ConnectorSource) =>
  s.status === "syncing" && !!s.sync_started_at && Date.now() - new Date(s.sync_started_at).getTime() < 10 * 60_000;

function since(iso: string | null, locale: string): string {
  if (!iso) return tt(locale, "never", "mai");
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return tt(locale, "just now", "adesso");
  if (mins < 60) return tt(locale, `${mins} min ago`, `${mins} min fa`);
  const h = Math.round(mins / 60);
  if (h < 48) return tt(locale, `${h} h ago`, `${h} h fa`);
  return new Date(iso).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB");
}

export default function ConnectedSources({ brandId, locale, callFn, onChanged }: {
  brandId: number;
  locale: string;
  callFn: CallFn;
  /** The document list changed underneath the page — reload it. */
  onChanged: () => void;
}) {
  const [sources, setSources] = useState<ConnectorSource[]>([]);
  const [shareWith, setShareWith] = useState<string | null | undefined>(undefined);
  const [shopifyAvailable, setShopifyAvailable] = useState<boolean | undefined>(undefined);
  const [openForm, setOpenForm] = useState<"gdrive" | "shopify" | null>(null);
  const [folder, setFolder] = useState("");
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("knowledge_sources" as never)
      .select("id, kind, target, label, enabled, status, last_error, last_synced_at, sync_started_at, items_indexed, config")
      .eq("brand_id", brandId)
      .in("kind", ["gdrive", "shopify"]);
    setSources((data as unknown as ConnectorSource[]) ?? []);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  // The address to share a folder with comes from the server, so it is the
  // right one for this environment and never hard-coded in the bundle.
  useEffect(() => {
    callFn("source-sync", { action: "info", brand_id: brandId })
      .then((r) => {
        setShareWith((r.gdrive_share_with as string | null) ?? null);
        setShopifyAvailable(r.shopify_available === true);
      })
      .catch(() => { setShareWith(null); setShopifyAvailable(false); });
    // callFn is re-created on every render of the page; asking once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  // Coming back from Shopify's approval screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("connect_error");
    if (!connected && !error) return;
    if (connected === "shopify") {
      toast.success(tt(locale, "Shopify connected — reading your pages and policies now.", "Shopify collegato — stiamo leggendo pagine e policy."));
      void callFn("source-sync", { action: "sync", kind: "shopify", brand_id: brandId }).catch(() => {}).finally(() => void load());
    }
    if (error) toast.error(error);
    params.delete("connected");
    params.delete("connect_error");
    const q = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a run is going, watch it, and refresh the document list when it ends.
  const anySyncing = sources.some(isSyncing) || sources.some((s) => (s.config?.last_run?.remaining ?? 0) > 0);
  useEffect(() => {
    if (!anySyncing) return;
    const t = setTimeout(() => { void load(); onChanged(); }, 8000);
    return () => clearTimeout(t);
  }, [anySyncing, sources, load, onChanged]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  };

  const connectDrive = () => run("connect-gdrive", async () => {
    const r = await callFn("source-sync", { action: "connect_gdrive", folder, brand_id: brandId });
    if (r.ok === false) { toast.error(String(r.error ?? "Couldn't open the folder")); return; }
    await callFn("source-sync", { action: "sync", source_id: r.source_id, brand_id: brandId });
    toast.success(tt(locale,
      `Connected "${r.label}" — indexing in the background.`,
      `Collegata "${r.label}" — indicizzazione in background.`));
    setFolder(""); setOpenForm(null);
    await load();
  });

  const connectShopify = () => run("connect-shopify", async () => {
    const r = await callFn("shopify-oauth", { action: "start", shop, brand_id: brandId });
    // Off to the shop's own approval screen; it comes back to this page.
    window.location.href = String(r.url);
  });

  const syncNow = (s: ConnectorSource) => run(`sync-${s.id}`, async () => {
    await callFn("source-sync", { action: "sync", source_id: s.id });
    toast.success(tt(locale, "Syncing — new and changed items will appear shortly.", "Sincronizzazione avviata — i contenuti nuovi o modificati arrivano a breve."));
    await load();
  });

  const disconnect = (s: ConnectorSource) => {
    const name = s.label ?? s.target;
    if (!confirm(tt(locale,
      `Disconnect ${name}?\n\nThe ${s.items_indexed} documents it brought in are removed from the knowledge base, and the Assistant stops using them.`,
      `Scollegare ${name}?\n\nI ${s.items_indexed} documenti importati vengono rimossi dalla knowledge base e l'Assistente smette di usarli.`))) return;
    void run(`disconnect-${s.id}`, async () => {
      await callFn("source-sync", { action: "disconnect", source_id: s.id });
      toast.success(tt(locale, "Disconnected.", "Scollegato."));
      await load();
      onChanged();
    });
  };

  const drive = sources.find((s) => s.kind === "gdrive");
  const shopify = sources.find((s) => s.kind === "shopify");

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{tt(locale, "Connected sources", "Fonti collegate")}</span>
        <span className="text-xs text-muted-foreground">
          {tt(locale, "Kept in sync automatically — edit at the source, the Assistant follows.",
                      "Sincronizzate in automatico — modifichi alla fonte, l'Assistente si aggiorna.")}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {/* ── Google Drive ── */}
        <li className="px-4 py-3">
          {drive ? (
            <SourceRow
              source={drive} locale={locale} icon={<HardDrive className="h-4 w-4" />}
              name="Google Drive" href={drive.config?.folder_url ?? null}
              busy={busy} onSync={() => syncNow(drive)} onDisconnect={() => disconnect(drive)}
            />
          ) : (
            <>
              <EmptyRow
                icon={<HardDrive className="h-4 w-4" />} name="Google Drive"
                blurb={shareWith === null
                  ? tt(locale, "Coming soon — not available on this environment yet.", "In arrivo — non ancora disponibile in questo ambiente.")
                  : tt(locale, "Training manuals, brand book, policies — any folder you share.",
                               "Manuali, brand book, policy — qualsiasi cartella condividi.")}
                open={openForm === "gdrive"} onToggle={() => setOpenForm(openForm === "gdrive" ? null : "gdrive")}
                disabled={shareWith === null} locale={locale}
              />
              {openForm === "gdrive" && shareWith && (
                <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
                  <p className="text-foreground">
                    <span className="font-medium">1.</span>{" "}
                    {tt(locale, "In Google Drive, share the folder with this address as a Viewer:",
                                "In Google Drive, condividi la cartella con questo indirizzo come Visualizzatore:")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 max-w-full truncate rounded bg-background px-2 py-1 text-xs">{shareWith}</code>
                    <button type="button"
                      onClick={() => { void navigator.clipboard.writeText(shareWith); toast.success(tt(locale, "Copied", "Copiato")); }}
                      className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted">
                      <Copy className="h-3 w-3" /> {tt(locale, "Copy", "Copia")}
                    </button>
                  </div>
                  <p className="text-foreground">
                    <span className="font-medium">2.</span>{" "}
                    {tt(locale, "Paste the folder's link. Sub-folders are included.", "Incolla il link della cartella. Le sottocartelle sono incluse.")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={folder} onChange={(e) => setFolder(e.target.value)}
                      placeholder="https://drive.google.com/drive/folders/…"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button type="button" onClick={() => void connectDrive()} disabled={!folder.trim() || busy === "connect-gdrive"}
                      className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      {busy === "connect-gdrive" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {tt(locale, "Connect", "Collega")}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tt(locale,
                      "We read Google Docs, Sheets (first tab), Slides, PDF, Word, PowerPoint and text files. Remove a file from the folder and it leaves the knowledge base; un-share the folder to stop entirely.",
                      "Leggiamo Documenti, Fogli (primo foglio), Presentazioni Google, PDF, Word, PowerPoint e file di testo. Togli un file dalla cartella ed esce dalla knowledge base; rimuovi la condivisione per interrompere tutto.")}
                  </p>
                </div>
              )}
            </>
          )}
        </li>

        {/* ── Shopify ── */}
        <li className="px-4 py-3">
          {shopify ? (
            <SourceRow
              source={shopify} locale={locale} icon={<ShoppingBag className="h-4 w-4" />}
              name="Shopify" href={null}
              busy={busy} onSync={() => syncNow(shopify)} onDisconnect={() => disconnect(shopify)}
            />
          ) : (
            <>
              <EmptyRow
                icon={<ShoppingBag className="h-4 w-4" />} name="Shopify"
                blurb={shopifyAvailable === false
                  ? tt(locale, "Coming soon — ask your AION contact to enable it for your shop.", "In arrivo — chiedi al tuo referente AION di attivarlo per il tuo shop.")
                  : tt(locale, "Your shop's pages, journal articles and policies.", "Pagine, articoli del journal e policy del tuo shop.")}
                open={openForm === "shopify"} onToggle={() => setOpenForm(openForm === "shopify" ? null : "shopify")}
                disabled={shopifyAvailable === false} locale={locale}
              />
              {openForm === "shopify" && (
                <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
                  <p className="text-foreground">
                    {tt(locale,
                      "Enter your shop's Shopify address. You'll approve AION on Shopify's own screen — you need to be an admin of the shop.",
                      "Inserisci l'indirizzo Shopify del tuo shop. Approverai AION sulla schermata di Shopify — serve essere admin dello shop.")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={shop} onChange={(e) => setShop(e.target.value)}
                      placeholder="your-house.myshopify.com"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button type="button" onClick={() => void connectShopify()} disabled={!shop.trim() || busy === "connect-shopify"}
                      className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      {busy === "connect-shopify" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {tt(locale, "Continue to Shopify", "Continua su Shopify")}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tt(locale,
                      "Find it in Shopify admin → Settings → Domains; it ends in .myshopify.com. Products stay in your catalogue, not here.",
                      "Lo trovi in Shopify admin → Impostazioni → Domini; finisce con .myshopify.com. I prodotti restano nel catalogo, non qui.")}
                  </p>
                </div>
              )}
            </>
          )}
        </li>
      </ul>
    </div>
  );
}

const EmptyRow = ({ icon, name, blurb, open, onToggle, disabled, locale }: {
  icon: React.ReactNode; name: string; blurb: string; open: boolean; onToggle: () => void; disabled?: boolean; locale: string;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <p className="text-xs text-muted-foreground">{blurb}</p>
    </div>
    <button type="button" onClick={onToggle} disabled={disabled}
      title={disabled ? tt(locale, "Not available on this environment yet", "Non ancora disponibile in questo ambiente") : undefined}
      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
      {open ? tt(locale, "Cancel", "Annulla") : tt(locale, "Connect", "Collega")}
    </button>
  </div>
);

const SourceRow = ({ source: s, locale, icon, name, href, busy, onSync, onDisconnect }: {
  source: ConnectorSource; locale: string; icon: React.ReactNode; name: string; href: string | null;
  busy: string | null; onSync: () => void; onDisconnect: () => void;
}) => {
  const syncing = isSyncing(s);
  const lr = s.config?.last_run;
  const notes = [...(lr?.failed_examples ?? []), ...(lr?.skipped_examples ?? [])];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {name}
            <span className="font-normal text-muted-foreground">·</span>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate font-normal hover:underline">
                {s.label ?? s.target} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className="truncate font-normal">{s.label ?? s.target}</span>
            )}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {syncing ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> {tt(locale, "Syncing…", "Sincronizzazione…")}</>
            ) : s.status === "error" ? (
              <span className="flex items-start gap-1 text-destructive"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {s.last_error}</span>
            ) : (
              <><CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {tt(locale,
                  `${s.items_indexed.toLocaleString()} documents · synced ${since(s.last_synced_at, locale)}`,
                  `${s.items_indexed.toLocaleString()} documenti · sincronizzata ${since(s.last_synced_at, locale)}`)}
                {(lr?.remaining ?? 0) > 0 && tt(locale, ` · ${lr!.remaining} still to index`, ` · ${lr!.remaining} ancora da indicizzare`)}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onSync} disabled={syncing || busy === `sync-${s.id}`}
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
            {busy === `sync-${s.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {tt(locale, "Sync now", "Sincronizza")}
          </button>
          <button type="button" onClick={onDisconnect} disabled={busy === `disconnect-${s.id}`}
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50">
            <Unplug className="h-3 w-3" /> {tt(locale, "Disconnect", "Scollega")}
          </button>
        </div>
      </div>
      {notes.length > 0 && (
        <details className="ml-11 mt-1.5">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {tt(locale,
              `${lr?.failed ?? 0} couldn't be read, ${lr?.skipped ?? 0} skipped`,
              `${lr?.failed ?? 0} non leggibili, ${lr?.skipped ?? 0} saltati`)}
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {notes.map((n, i) => <li key={i} className="truncate" title={n}>{n}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
};
