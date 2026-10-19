import { useCallback, useEffect, useState } from "react";
import { untyped } from "@/integrations/supabase/untyped";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, Check, ShoppingBag, Eye, Plug } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Connecting a brand's Shopify ORDERS — the half the public feed can't give us.
//
// The catalogue needs no credentials; orders and customers need a token the
// house creates for us (custom app, read_orders + read_customers). That token is
// the brand's entire order book, so nothing here is casual: it is stored in
// Vault through the edge function and never read back into this page, the sync
// starts switched OFF, and "Preview" pulls a page and writes nothing so the
// first contact with a real shop can be read before it is trusted.
//
// Admin-only by design. A brand user must never be able to point this at a
// different shop, so the table has no insert policy and this panel lives on the
// AION side of the app.

type Conn = {
  brand_id: number;
  shop_domain: string;
  api_version: string;
  status: "unconfigured" | "untested" | "ok" | "error";
  scopes: string[] | null;
  missing_scopes: string[] | null;
  last_test_at: string | null;
  last_error: string | null;
  enabled: boolean;
  orders_since: string | null;
  last_sync_at: string | null;
  next_cursor: string | null;
  orders_synced: number;
};

type SyncResult = {
  dry_run?: boolean; pages?: number; fetched?: number; written?: number;
  matched_to_clients?: number; more?: boolean;
  sample?: { order_number: string | null; placed_at: string | null; total: number | null; email: string | null }[];
};

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";

const STATUS: Record<Conn["status"], { label: string; cls: string }> = {
  unconfigured: { label: "Not connected", cls: "bg-muted text-muted-foreground" },
  untested:     { label: "Untested",      cls: "bg-amber-500/10 text-amber-600" },
  ok:           { label: "Connected",     cls: "bg-emerald-500/10 text-emerald-600" },
  error:        { label: "Error",         cls: "bg-destructive/10 text-destructive" },
};

export default function ShopifyConnection({ brandId }: { brandId: number }) {
  const [row, setRow] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopDomain, setShopDomain] = useState("");
  const [token, setToken] = useState("");
  const [ordersSince, setOrdersSince] = useState("");
  const [busy, setBusy] = useState<null | "test" | "preview" | "sync" | "disconnect">(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [orderCount, setOrderCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { count }] = await Promise.all([
      untyped.from("storefront_connections").select("*").eq("brand_id", brandId).maybeSingle(),
      untyped.from("storefront_orders").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
    ]);
    const r = (data ?? null) as Conn | null;
    setRow(r);
    setShopDomain(r?.shop_domain ?? "");
    setOrdersSince(r?.orders_since ?? "");
    setOrderCount(count ?? 0);
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("shopify-orders", { body: { brand_id: brandId, ...body } });
    // A non-2xx from the function arrives as an error whose body holds the
    // useful sentence — surfacing "Edge Function returned a non-2xx status
    // code" instead would hide exactly the thing someone needs to act on.
    if (error) {
      let detail = "";
      const res = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      try { detail = (await res?.json?.())?.error ?? ""; } catch { /* keep the generic */ }
      throw new Error(detail || error.message);
    }
    const d = data as { error?: string } | null;
    if (d?.error) throw new Error(d.error);
    return data as Record<string, unknown>;
  };

  const runTest = async () => {
    if (!shopDomain.trim()) {
      toast({ title: "Shop domain first", description: "Looks like house.myshopify.com.", variant: "destructive" });
      return;
    }
    setBusy("test"); setResult(null);
    try {
      const d = await call({ action: "test", shop_domain: shopDomain.trim(), token: token.trim() || undefined }) as
        { ok?: boolean; shop_name?: string; note?: string; missing_scopes?: string[] };
      // The token is never read back into this page; once stored, forget it.
      setToken("");
      toast({
        title: d.ok ? `Connected to ${d.shop_name ?? shopDomain.trim()}` : "Not connected yet",
        description: d.note,
        variant: d.ok ? undefined : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
      await load();
    } finally { setBusy(null); }
  };

  const runSync = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "sync"); setResult(null);
    try {
      const d = await call({ action: "sync", dry_run: dryRun, max_pages: dryRun ? 1 : undefined }) as SyncResult;
      setResult(d);
      toast({
        title: dryRun ? "Preview only — nothing written" : "Sync finished",
        description: dryRun
          ? `${d.fetched ?? 0} orders read from Shopify.`
          : `${d.written ?? 0} orders saved, ${d.matched_to_clients ?? 0} matched to a client.${d.more ? " More to pull — run again." : ""}`,
      });
      if (!dryRun) await load();
    } catch (e) {
      toast({ title: dryRun ? "Preview failed" : "Sync failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const setEnabled = async (enabled: boolean) => {
    const { error } = await untyped.from("storefront_connections")
      .update({ enabled, updated_at: new Date().toISOString() } as never).eq("brand_id", brandId);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setRow((r) => (r ? { ...r, enabled } : r));
  };

  const saveSince = async () => {
    const { error } = await untyped.from("storefront_connections")
      .update({ orders_since: ordersSince || null, updated_at: new Date().toISOString() } as never).eq("brand_id", brandId);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Saved", description: ordersSince ? `Orders from ${ordersSince} onwards.` : "No start date — the next sync reads the whole history." });
    await load();
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await call({ action: "disconnect" });
      toast({ title: "Disconnected", description: "Token deleted. Orders already pulled are kept." });
      await load();
    } catch (e) {
      toast({ title: "Could not disconnect", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Shopify orders</p>
          <Skeleton className="h-3.5 w-40" />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-8 w-48 rounded-lg" />
      </div>
    );
  }

  const status = STATUS[row?.status ?? "unconfigured"];
  const connected = row?.status === "ok";

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Shopify orders</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
        <span className="text-xs text-muted-foreground">
          {orderCount ?? 0} order{orderCount === 1 ? "" : "s"} · last sync {when(row?.last_sync_at)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        The catalogue comes from the public storefront feed and needs nothing from the house.
        Orders and customers need a token: in the shop's admin, Settings → Apps → Develop apps →
        create an app with <strong>read_orders</strong> and <strong>read_customers</strong>, then paste its
        Admin API access token here. It is stored encrypted and never shown again.
      </p>

      {row?.last_error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>{row.last_error}</span>
        </div>
      )}

      {connected && row?.scopes?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          Granted: {row.scopes.join(", ")}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Shop domain
          <input
            value={shopDomain} onChange={(e) => setShopDomain(e.target.value)}
            placeholder="house.myshopify.com"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Admin API token {row?.status !== "unconfigured" && <span className="normal-case">(stored — paste only to replace)</span>}
          <input
            type="password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="shpat_…" autoComplete="off"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <button
          type="button" onClick={() => void runTest()} disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          Test connection
        </button>
      </div>

      {connected && (
        <>
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Orders from
              <input
                type="date" value={ordersSince} onChange={(e) => setOrdersSince(e.target.value)}
                onBlur={() => { if ((row?.orders_since ?? "") !== ordersSince) void saveSince(); }}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={row?.enabled ?? false} onChange={(e) => void setEnabled(e.target.checked)} />
              Sync switched on
            </label>
            <button
              type="button" onClick={() => void runSync(true)} disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Preview one page
            </button>
            <button
              type="button" onClick={() => void runSync(false)} disabled={busy !== null || !row?.enabled}
              title={row?.enabled ? undefined : "Switch the sync on first"}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
              Sync orders now
            </button>
            <button
              type="button" onClick={() => void disconnect()} disabled={busy !== null}
              className="ml-auto rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          {row?.next_cursor && (
            <p className="text-xs text-amber-600">
              A backfill is part-way through — run the sync again to continue from where it stopped.
            </p>
          )}
        </>
      )}

      {result?.sample?.length ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">
            {result.dry_run ? "Preview — nothing was written" : "Latest sync"} · {result.fetched ?? 0} read
            {!result.dry_run && `, ${result.written ?? 0} saved, ${result.matched_to_clients ?? 0} matched`}
          </p>
          {result.sample.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {s.order_number ?? "—"} · {s.placed_at ? new Date(s.placed_at).toLocaleDateString("en-GB") : "—"} ·{" "}
              {s.total != null ? s.total.toLocaleString("en-GB", { style: "currency", currency: "EUR" }) : "—"} · {s.email ?? "guest"}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
