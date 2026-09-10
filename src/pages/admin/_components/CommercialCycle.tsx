import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh object every
// render, so a fetcher that lists it as a dependency re-runs on every render — which for a
// fetcher that sets a loading flag is an infinite loop that never leaves the spinner.
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Download, FileText, ChevronDown, ChevronRight, Check, Circle,
  CircleDot, SkipForward, AlertCircle, RefreshCw, ExternalLink, ArrowUpRight,
} from "lucide-react";
import PipelinePanel from "./PipelinePanel";
import DemoPanel from "./DemoPanel";
import CatalogueSource from "./CatalogueSource";
import BusinessCasePanel, { type StoredBusinessCase } from "./BusinessCasePanel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CYCLE_STEPS, STEP_STATES, PIPELINE_STAGES, stepStateLabel, stepIsBuilding,
  summarisePipeline, type StageState, type StepNumber,
} from "@/lib/commercialCycle";

// The commercial cycle for one brand.
//
// The five steps are NOT a wizard. They genuinely swap around — pricing sometimes precedes
// the demo, the ops review sometimes comes early — so nothing here gates anything. Each
// step says what it needs, what it produces, and where this prospect got to.
//
// Two things this screen used to do that it no longer does. It drew the pipeline twice —
// a chip banner here and a full second stage list inside step 3, with its own Run buttons
// and its own Refresh — and it ran TWO pollers against two edge functions, one every six
// seconds and one every eight, for the whole length of a crawl. The pipeline is one panel
// now, and the only thing on a timer is a single RPC that the screen was already reading.

type Brand = { id: number; name: string | null; website: string | null; slug: string | null; logo_small: string | null; logo_big: string | null };
type Artifact = { kind: string; file_name: string; generated_at: string; slots_filled: number; download_url: string | null };
type ProgressRow = { state: string; note: string | null; happened_on: string | null; updated_at: string };
type OverviewBrand = {
  id: number; name: string | null; website: string | null;
  is_prospect: boolean;
  legal_name: string | null;
  product_focus: string | null;
  address: string | null;
  address_is_override: boolean;
};
type Overview = {
  brand: OverviewBrand | null;
  artifacts: Record<string, { storage_path: string; generated_at: string; slots_filled: number }>;
  progress: Record<string, ProgressRow>;
  stages: Record<string, StageState>;
  business_case: StoredBusinessCase | null;
  counts: Record<string, number>;
  quotes: { category: string; coverage: string; own_quote: boolean }[];
};

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

export default function CommercialCycle({ brand, brands }: { brand: Brand; brands: { id: number; name: string | null }[] }) {
  const [params, setParams] = useSearchParams();
  const brandId = brand.id;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [links, setLinks] = useState<Record<string, Artifact>>({});
  const [loadingBrand, setLoadingBrand] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState<Record<number, string[]>>({});
  // Whether demo tooling may run for THIS brand. Fetched once on mount, never polled: it
  // is a property of the brand and the project, and neither changes while you look at it.
  const [demo, setDemo] = useState<{ allowed: boolean; reason: string | null } | null>(null);

  // Step 2's fields. Seeded from the brand record and saved back to it — they used to be
  // component state that nothing ever persisted, so the legal entity on a data request was
  // retyped every session and the product focus was lost the moment you left the tab.
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [focus, setFocus] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    const { data, error } = await untyped.rpc("commercial_cycle_overview", { p_brand_id: brandId });
    if (error) {
      toast({ title: "Could not load the cycle", description: error.message, variant: "destructive" });
    } else {
      setOverview(data as unknown as Overview);
    }
    setLoadingBrand(false);
  }, [brandId]);

  useEffect(() => { setLoadingBrand(true); void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.functions.invoke("onboard-brand", { body: { brand_id: brandId, action: "status" } });
      if (cancelled) return;
      const d = data as { demo_allowed?: boolean; demo_blocked_reason?: string | null } | null;
      // Fails closed: while this is in flight, and if it never answers, demo controls stay
      // hidden rather than flashing up somewhere they should not.
      setDemo({ allowed: d?.demo_allowed === true, reason: d?.demo_blocked_reason ?? null });
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  const visibleStages = useMemo(
    () => PIPELINE_STAGES.filter((s) => demo?.allowed || !s.demo),
    [demo?.allowed],
  );
  const pipeline = summarisePipeline(overview?.stages, visibleStages);

  // ONE poller, and only while something is in flight. It used to be two — this screen
  // every six seconds (an RPC *and* an edge-function invoke, the second one purely to
  // re-sign download links) and the panel inside step 3 every eight, against a third.
  useEffect(() => {
    if (!pipeline.active) return;
    const t = setInterval(() => { void load(); }, 6000);
    return () => clearInterval(t);
  }, [pipeline.active, load]);

  // Signed download links, refreshed when the FILES change rather than on every tick.
  //
  // A signed URL lasts a week, so the one minted at generation time is dead by the time a
  // deal comes back round — but that is a reason to re-sign on load, not sixty times during
  // a crawl. The overview already carries each artifact's timestamp, so the moment a new
  // one lands the fingerprint changes and exactly one call goes out.
  const artifactSig = useMemo(
    () => Object.entries(overview?.artifacts ?? {})
      .map(([k, v]) => `${k}:${v.generated_at}`).sort().join("|"),
    [overview?.artifacts],
  );
  const signedFor = useRef<string | null>(null);
  useEffect(() => { signedFor.current = null; setLinks({}); }, [brandId]);
  useEffect(() => {
    if (!brandId || !artifactSig || signedFor.current === artifactSig) return;
    signedFor.current = artifactSig;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.functions.invoke("build-collateral", { body: { brand_id: brandId, kind: "list" } });
      if (cancelled) return;
      const list = data as { artifacts?: Artifact[] } | null;
      setLinks(Object.fromEntries((list?.artifacts ?? []).map((a) => [a.kind, a])));
    })();
    return () => { cancelled = true; };
  }, [brandId, artifactSig]);

  // Seed step 2 once per brand. Not `v => v || incoming`, which the old version used: that
  // can never clear a field, and it silently kept the previous brand's value on the screen.
  const seededFor = useRef<number | null>(null);
  useEffect(() => {
    const b = overview?.brand;
    if (!b || seededFor.current === brandId) return;
    seededFor.current = brandId;
    setLegalName(b.legal_name ?? "");
    setAddress(b.address ?? "");
    setFocus(b.product_focus ?? "");
  }, [overview, brandId]);

  // Opening on the first unfinished step is what an admin picking a deal back up wants —
  // but ONCE per brand, not on every reload. Marking a step done updates progress, which
  // would otherwise re-run this and collapse the step out from under the person who ticked it.
  const autoOpened = useRef<number | null>(null);
  useEffect(() => {
    if (!overview || !brandId || autoOpened.current === brandId) return;
    autoOpened.current = brandId;
    const asked = Number(params.get("step"));
    if (asked >= 1 && asked <= CYCLE_STEPS.length) { setOpen(asked); return; }
    const next = CYCLE_STEPS.find((s) => overview.progress?.[String(s.n)]?.state !== "done");
    setOpen(next?.n ?? 1);
    // params is read once per brand on purpose — re-running when the URL changes would
    // fight the accordion, which itself writes to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, brandId]);

  // Opening a step is a navigation, so it is bookmarkable and shareable.
  const openStep = useCallback((n: number | null) => {
    setOpen(n);
    // MERGE, never replace: the page owns ?tab in the same query string, and clobbering it
    // sends the reader back to the Record tab mid-step.
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (n) next.set("step", String(n)); else next.delete("step");
      return next;
    }, { replace: true });
  }, [setParams]);

  const isRaster = (u: string | null | undefined) => !!u && !/\.svg(\?|$)/i.test(u);
  const hasRasterLogo = isRaster(brand?.logo_big) || isRaster(brand?.logo_small);
  const artifactFor = (n: StepNumber) => {
    const kind = CYCLE_STEPS.find((s) => s.n === n)?.artifact;
    return kind ? links[kind] ?? null : null;
  };
  const builtAt = (n: StepNumber) => {
    const kind = CYCLE_STEPS.find((s) => s.n === n)?.artifact;
    return kind ? overview?.artifacts?.[kind]?.generated_at ?? null : null;
  };

  const setProgress = async (step: number, patch: Partial<ProgressRow>) => {
    if (!brandId) return;
    const current = overview?.progress?.[String(step)];
    const row = {
      brand_id: brandId, step,
      state: patch.state ?? current?.state ?? "not_started",
      note: patch.note !== undefined ? patch.note : current?.note ?? null,
      happened_on: patch.happened_on !== undefined ? patch.happened_on : current?.happened_on ?? null,
      updated_at: new Date().toISOString(),
    };
    // Optimistic: a status dropdown that waits on a round trip feels broken.
    setOverview((o) => o && ({ ...o, progress: { ...o.progress, [String(step)]: { ...row } as ProgressRow } }));
    const { error } = await untyped.from("brand_commercial_progress")
      .upsert(row as never, { onConflict: "brand_id,step" });
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      void load();
    }
  };

  // Step 2's fields go back to the brand record on blur, so the next data request — and the
  // next person — starts from what was decided rather than from a blank box.
  const saveBrandField = async (column: "legal_name" | "registered_address" | "product_focus", value: string) => {
    const trimmed = value.trim();
    const current = overview?.brand;
    const existing = column === "legal_name" ? current?.legal_name
      : column === "product_focus" ? current?.product_focus
      : current?.address_is_override ? current?.address : null;
    if ((existing ?? "") === trimmed) return;
    setSavingField(column);
    const { error } = await supabase.from("brands").update({ [column]: trimmed || null }).eq("id", brandId);
    setSavingField(null);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    await load();
  };

  const build = async (step: number, fn: string, body: Record<string, unknown>) => {
    setBusy(`step${step}`);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { brand_id: brandId, ...body } });
      if (error) throw new Error(error.message);
      const d = data as Record<string, unknown>;
      if (d.error || d.ok === false) throw new Error(String(d.error ?? d.reason));
      setReview((r) => ({ ...r, [step]: (d.review as string[]) ?? [] }));
      toast({
        title: `${String(d.file_name ?? "File")} ready`,
        description: d.slots_total ? `${d.slots_filled}/${d.slots_total} images swapped for their own pieces.` : undefined,
      });
      // A generated artifact means the step is under way, if nobody has said otherwise.
      if ((overview?.progress?.[String(step)]?.state ?? "not_started") === "not_started") {
        await setProgress(step, { state: "in_progress" });
      }
      // The file is new, so its link must be too.
      signedFor.current = null;
      await load();
    } catch (e) {
      toast({ title: "Build failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const c = overview?.counts ?? {};

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">
        The five steps from first meeting to operations review, and everything they produce.
        The order is a default — steps swap around, and nothing here stops you doing them out of sequence.
      </p>

      {/* The pipeline, once. */}
      <PipelinePanel
        brandId={brandId}
        brandName={brand.name ?? "this brand"}
        website={brand.website}
        stages={overview?.stages}
        demoAllowed={demo?.allowed === true}
        demoBlockedReason={demo?.reason}
        onQueued={() => void load()}
      />

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
        {loadingBrand ? (
          <div className="flex flex-wrap items-center gap-2">
            {[16, 20, 28, 16, 16].map((w, i) => <Skeleton key={i} className="h-4" style={{ width: `${w * 4}px` }} />)}
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <CycleProgress progress={overview?.progress} onJump={openStep} />
            <span>{c.products ?? 0} products</span>
            <span>{c.knowledge_chunks ?? 0} chunks indexed</span>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
          <button onClick={() => { signedFor.current = null; void load(); }}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <Link to={`/admin/brands/${brandId}?tab=knowledge`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Knowledge <ArrowUpRight className="h-3 w-3" />
          </Link>
          {brand?.website && (
            <a href={brand.website.startsWith("http") ? brand.website : `https://${brand.website}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              {brand.website} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {!brand.website && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>This brand has no website on its record. The deck, the catalogue and the demo are all built from it.</span>
        </div>
      )}

      <div className="space-y-3">
        {CYCLE_STEPS.map((step) => {
          const p = overview?.progress?.[String(step.n)];
          const state = p?.state ?? "not_started";
          const art = artifactFor(step.n);
          const isOpen = open === step.n;
          const building = stepIsBuilding(step.n, overview?.stages);
          return (
            <div key={step.n} className={`rounded-xl border ${!loadingBrand && state === "done" ? "border-emerald-500/40" : "border-border"}`}>
              <button onClick={() => openStep(isOpen ? null : step.n)}
                className="flex w-full items-start gap-3 p-4 text-left">
                <span className="mt-0.5 shrink-0">
                  {loadingBrand ? <Skeleton className="h-5 w-5 rounded-full" />
                    : state === "done" ? <Check className="h-5 w-5 text-emerald-600" />
                    : state === "in_progress" ? <CircleDot className="h-5 w-5 text-primary" />
                    : state === "skipped" ? <SkipForward className="h-5 w-5 text-muted-foreground" />
                    : <Circle className="h-5 w-5 text-muted-foreground/50" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    <span className="text-muted-foreground">{step.n}.</span> {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.blurb}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {loadingBrand ? <Skeleton className="h-3.5 w-32" /> : (
                      <>
                        {building ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" /> Building
                          </span>
                        ) : builtAt(step.n) ? (
                          <span className="text-emerald-700 dark:text-emerald-400">Built {when(builtAt(step.n))}</span>
                        ) : step.artifact ? (
                          <span className="text-muted-foreground">Nothing built yet</span>
                        ) : null}
                        {p?.happened_on && <span className="text-muted-foreground">Met {when(p.happened_on)}</span>}
                        {p?.note && <span className="truncate text-muted-foreground">“{p.note}”</span>}
                      </>
                    )}
                  </div>
                </div>
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  {loadingBrand
                    ? <Skeleton className="h-16 w-full rounded-lg" />
                    : <StepTracker step={step.n} row={p} onChange={setProgress} />}

                  {step.n === 1 && (loadingBrand ? <StepSkeleton /> :
                    <StepAction
                      produces={step.produces}
                      busy={busy === "step1"}
                      disabled={!brand?.website}
                      building={building}
                      label="Build intro deck"
                      onRun={() => void build(1, "brand-deck", {})}
                      artifact={art}
                      review={review[1]}
                      warning={(c.products ?? 0) === 0
                        ? "No catalogue yet, so there are no pieces to swap into the deck. Run the Catalogue stage in the pipeline above first."
                        : !hasRasterLogo
                        ? `${c.products} products available, but no PNG or JPEG logo on the brand record — the deck will carry only AION's mark, which is most of what makes one look generic. A vector logo cannot be embedded.`
                        : `${c.products} products available — the most valuable ones go into the deck.`}
                    />
                  )}

                  {step.n === 2 && (loadingBrand ? <StepSkeleton /> :
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <PersistedField
                          label="Legal entity" value={legalName} onChange={setLegalName}
                          onCommit={(v) => void saveBrandField("legal_name", v)}
                          saving={savingField === "legal_name"}
                          placeholder="Pasquale Bruni S.p.A."
                        />
                        <PersistedField
                          label="Registered address" value={address} onChange={setAddress}
                          onCommit={(v) => void saveBrandField("registered_address", v)}
                          saving={savingField === "registered_address"}
                          placeholder="from the brand record"
                          hint={overview?.brand?.address_is_override ? undefined : "from the brand record"}
                        />
                        <PersistedField
                          label="Product focus" value={focus} onChange={setFocus}
                          onCommit={(v) => void saveBrandField("product_focus", v)}
                          saving={savingField === "product_focus"}
                          placeholder="High jewellery, EU boutiques"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">Saved to the brand record as you leave each field.</p>
                      <StepAction
                        produces={step.produces}
                        busy={busy === "step2"}
                        building={building}
                        label="Build data request"
                        onRun={() => void build(2, "build-collateral", { kind: "data_request" })}
                        artifact={art}
                        review={review[2]}
                        warning={legalName.trim() ? undefined
                          : "No legal entity set — the workbook will go out with that field blank."}
                      />
                      {links.data_request_returned && (
                        <p className="text-xs text-muted-foreground">
                          The workbook {brand.name ?? "the brand"} sent back is attached:{" "}
                          <a href={links.data_request_returned.download_url ?? "#"} target="_blank" rel="noreferrer"
                            className="underline">{links.data_request_returned.file_name}</a>. Its figures are in step 4.
                        </p>
                      )}
                    </div>
                  )}

                  {step.n === 3 && brand && (
                    <div className="space-y-6">
                      <DemoPanel
                        brandId={brand.id}
                        brandName={brand.name ?? "the brand"}
                        stages={overview?.stages}
                        counts={overview?.counts}
                        demoAllowed={demo?.allowed === true}
                        demoBlockedReason={demo?.reason}
                        onChanged={() => void load()}
                      />
                      {/* Where the catalogue comes from — the input the pipeline depends on. */}
                      <CatalogueSource brandId={brand.id} products={c.products ?? 0} onSaved={() => void load()} />
                      <p className="text-xs text-muted-foreground">
                        The FAQ, one-pager, cover summary, activation email and proposal this run drafts
                        are on the Documents tab.
                      </p>
                    </div>
                  )}

                  {/* Waits for the overview: the panel seeds its perimeter from `stored`
                      exactly once per brand, so handing it a null while the read is still
                      in flight would open the pricing conversation on a blank form. */}
                  {step.n === 4 && (!overview ? <StepSkeleton /> : (
                    <BusinessCasePanel
                      brandId={brandId}
                      brands={brands}
                      stored={overview.business_case}
                      onArtifact={() => { signedFor.current = null; void load(); }}
                    />
                  ))}

                  {step.n === 5 && (loadingBrand ? <StepSkeleton /> :
                    <StepAction
                      produces={step.produces}
                      busy={busy === "step5"}
                      building={building}
                      label="Build ops deck"
                      onRun={() => void build(5, "build-collateral", { kind: "operations" })}
                      artifact={art}
                      review={review[5]}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// How far along this deal is, at a glance.
//
// Five segments, one per step, in the step's own colour. It gives progress its due, it is
// honest about what is and is not finished, and each segment jumps to its step.
function CycleProgress({ progress, onJump }: {
  progress?: Record<string, ProgressRow>;
  onJump: (step: number) => void;
}) {
  const stateOf = (n: number) => progress?.[String(n)]?.state ?? "not_started";
  const count = (st: string) => CYCLE_STEPS.filter((s) => stateOf(s.n) === st).length;
  const done = count("done"), active = count("in_progress"), skipped = count("skipped");

  const parts = [
    done ? `${done} done` : null,
    active ? `${active} in progress` : null,
    skipped ? `${skipped} skipped` : null,
  ].filter(Boolean);

  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center gap-0.5" aria-hidden>
        {CYCLE_STEPS.map((s) => {
          const st = stateOf(s.n);
          return (
            <button key={s.n} onClick={() => onJump(s.n)} title={`${s.n}. ${s.title} — ${stepStateLabel(st)}`}
              className={`h-1.5 w-5 rounded-full transition-opacity hover:opacity-70 ${
                st === "done" ? "bg-emerald-500"
                  : st === "in_progress" ? "bg-primary"
                  : st === "skipped" ? "bg-muted-foreground/40"
                  : "bg-border"}`} />
          );
        })}
      </span>
      <span>{parts.length ? parts.join(" · ") : "not started"}</span>
    </span>
  );
}

function StepSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3.5 w-64" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <Skeleton className="h-9 w-56 rounded-lg" />
      </div>
    </div>
  );
}

// A field that lives on the brand record, edited here. Commits on blur rather than on every
// keystroke: this is one PATCH per decision, not one per character.
function PersistedField({ label, value, onChange, onCommit, saving, placeholder, hint }: {
  label: string; value: string; placeholder?: string; hint?: string; saving: boolean;
  onChange: (v: string) => void; onCommit: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
        placeholder={placeholder}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm normal-case tracking-normal text-foreground"
      />
      {hint && <span className="normal-case tracking-normal text-[10px]">{hint}</span>}
    </label>
  );
}

// The manual half of a step: where this prospect actually got to. Nothing here is derived —
// a deck existing does not mean the meeting happened.
function StepTracker({ step, row, onChange }: {
  step: number; row?: ProgressRow;
  onChange: (step: number, patch: Partial<ProgressRow>) => void | Promise<void>;
}) {
  const [note, setNote] = useState(row?.note ?? "");
  useEffect(() => { setNote(row?.note ?? ""); }, [row?.note]);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/30 p-3">
      <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Status
        <select value={row?.state ?? "not_started"} onChange={(e) => void onChange(step, { state: e.target.value })}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
          {STEP_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Date
        <input type="date" value={row?.happened_on ?? ""}
          onChange={(e) => void onChange(step, { happened_on: e.target.value || null })}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (row?.note ?? "")) void onChange(step, { note: note || null }); }}
          placeholder="Who was in the room, what they pushed back on"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm normal-case tracking-normal text-foreground" />
      </label>
    </div>
  );
}

function StepAction({ produces, busy, disabled, label, onRun, artifact, review, warning, building }: {
  produces: string; busy: boolean; disabled?: boolean; label: string; building: boolean;
  onRun: () => void; artifact: Artifact | null; review?: string[]; warning?: string;
}) {
  // While the pipeline owns this step, it owns it completely. The old screen could show
  // "Queued — you do not need to press anything" directly above "Run the Catalogue stage in
  // step 3 first" and an enabled build button that would have failed on the missing
  // catalogue: three messages, two of them wrong.
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{produces}</p>

      {building && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <span>The pipeline is building this — it will appear here when it lands, and nothing needs pressing.</span>
        </div>
      )}
      {warning && !building && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>{warning}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onRun} disabled={busy || disabled || building}
          title={building ? "The pipeline is handling this — no need to press anything" : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy || building ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {building ? "Building…" : artifact ? `Rebuild ${label.replace(/^Build /, "")}` : label}
        </button>
        {artifact?.download_url && (
          <a href={artifact.download_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <Download className="h-4 w-4" /> {artifact.file_name}
          </a>
        )}
        {artifact && artifact.slots_filled > 0 && (
          <span className="text-xs text-muted-foreground">{artifact.slots_filled} images from their catalogue</span>
        )}
      </div>
      {review?.length ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Before you send it</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {review.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
