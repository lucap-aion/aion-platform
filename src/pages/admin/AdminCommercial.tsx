import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untyped } from "@/integrations/supabase/untyped";
// The standalone `toast`, not `useToast().toast`: the hook returns a fresh
// object every render, so a fetcher that lists it as a dependency re-runs on
// every render — which for a fetcher that sets a loading flag is an infinite
// loop that never leaves the spinner. This one is module-scoped and stable.
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Download, FileText, ChevronDown, ChevronRight, Check, Circle,
  CircleDot, SkipForward, AlertCircle, RefreshCw, ExternalLink,
} from "lucide-react";
import BrandOnboarding from "./_components/BrandOnboarding";
import BusinessCasePanel from "./_components/BusinessCasePanel";

// The commercial cycle, on one screen.
//
// Every step here already had code behind it, but each was reached from
// somewhere different: the intro deck and the data request were buttons inside a
// drawer opened from a "Demo" link on a row of the brands table, the business
// case was an unrelated item in the sidebar, and nothing anywhere said what the
// five steps were or which of them had been done for a given prospect. Finding
// out whether Pasquale Bruni had a data request yet meant regenerating one.
//
// The steps are NOT a wizard. They genuinely swap around — pricing sometimes
// precedes the demo, ops review sometimes comes early — so nothing here gates
// anything. Each step says what it needs, what it produces, and where this
// prospect got to; the order is a default, not a rule.

type Brand = { id: number; name: string | null; website: string | null; slug: string | null; logo_small: string | null };
type Artifact = { kind: string; file_name: string; generated_at: string; slots_filled: number; download_url: string | null };
type ProgressRow = { state: string; note: string | null; happened_on: string | null; updated_at: string };
type Overview = {
  brand: { id: number; name: string | null; website: string | null; legal_name: string | null; address: string | null } | null;
  artifacts: Record<string, { storage_path: string; generated_at: string; slots_filled: number }>;
  progress: Record<string, ProgressRow>;
  counts: Record<string, number>;
  quotes: { category: string; coverage: string; own_quote: boolean }[];
};

const STEPS = [
  {
    n: 1, title: "First meeting",
    blurb: "Intro to the service — objective, value, cost, how it works. Thirty minutes with one or two stakeholders, and it repeats with the others.",
    produces: "A teaser deck rebranded with their own pieces.",
  },
  {
    n: 2, title: "NDA & data request",
    blurb: "They share an indicative pilot and roll-out perimeter so AION can go to Chubb for a formal quotation.",
    produces: "The data-request workbook, in their name.",
  },
  {
    n: 3, title: "Platform demo",
    blurb: "The platform on their own catalogue, brand side and client side, with a book of business that looks real.",
    produces: "A demo-ready account and logins for both portals.",
  },
  {
    n: 4, title: "Pricing",
    blurb: "The business case, on the quotes received so far. A formal Chubb quotation takes one to two months and supersedes it.",
    produces: "The pricing model and a deck built from it.",
  },
  {
    n: 5, title: "Operations review",
    blurb: "How the service works step by step, from the blueprint built across clients.",
    produces: "The ops deck, in the intro deck's own style.",
  },
] as const;

const STATES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
];

const ARTIFACT_FOR: Record<number, string | null> = {
  1: "intro_teaser", 2: "data_request", 3: null, 4: "business_case", 5: "operations",
};

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

export default function AdminCommercial() {
  const [params, setParams] = useSearchParams();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState<Record<number, string[]>>({});

  // Step 2's fields. Seeded from the brand record, overridable — the entity on a
  // data request is a legal question and often is not the trading name.
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [focus, setFocus] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("brands").select("id, name, website, slug, logo_small").order("name");
      const list = (data ?? []) as Brand[];
      setBrands(list);
      const fromUrl = Number(params.get("brand"));
      setBrandId(list.some((b) => b.id === fromUrl) ? fromUrl : list[0]?.id ?? null);
      setLoading(false);
    })();
    // Deliberately once: the brand list does not change while this screen is open,
    // and re-running on every param change would fight the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!brandId) return;
    const [ov, list] = await Promise.all([
      untyped.rpc("commercial_cycle_overview", { p_brand_id: brandId }),
      supabase.functions.invoke("build-collateral", { body: { brand_id: brandId, kind: "list" } }),
    ]);
    if (ov.error) {
      toast({ title: "Could not load the cycle", description: ov.error.message, variant: "destructive" });
    } else {
      const o = ov.data as unknown as Overview;
      setOverview(o);
      setLegalName((v) => v || o?.brand?.legal_name || "");
      setAddress((v) => v || o?.brand?.address || "");
    }
    const l = list.data as { artifacts?: Artifact[] } | null;
    setArtifacts(l?.artifacts ?? []);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  // Opening on the first step that is not finished is what an admin picking a
  // deal back up actually wants to see — but ONCE per brand, not on every
  // reload of the overview. Marking a step done updates progress, which would
  // otherwise re-run this and collapse the step out from under the person who
  // just ticked it.
  const autoOpened = useRef<number | null>(null);
  useEffect(() => {
    if (!overview || !brandId || autoOpened.current === brandId) return;
    autoOpened.current = brandId;
    const next = STEPS.find((s) => overview.progress?.[String(s.n)]?.state !== "done");
    setOpen(next?.n ?? 1);
  }, [overview, brandId]);

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const artifactFor = (n: number) => {
    const kind = ARTIFACT_FOR[n];
    return kind ? artifacts.find((a) => a.kind === kind) ?? null : null;
  };

  const pickBrand = (id: number) => {
    setBrandId(id);
    setParams({ brand: String(id) }, { replace: true });
    setOverview(null); setArtifacts([]); setReview({});
    setLegalName(""); setAddress(""); setFocus("");
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
      await load();
    } catch (e) {
      toast({ title: "Build failed", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const c = overview?.counts ?? {};
  const doneCount = STEPS.filter((s) => overview?.progress?.[String(s.n)]?.state === "done").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">Commercial cycle</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The five steps from first meeting to operations review, and everything they produce, per prospect.
            The order is a default — steps swap around, and nothing here stops you doing them out of sequence.
          </p>
        </div>
        <button onClick={() => void load()} disabled={!brandId}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Prospect
          <select value={brandId ?? ""} onChange={(e) => pickBrand(Number(e.target.value))}
            className="min-w-56 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name ?? `Brand ${b.id}`}</option>)}
          </select>
        </label>
        {brand?.logo_small && (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-white p-1">
            <img src={brand.logo_small} alt="" className="h-full w-full object-contain" />
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{doneCount}/5 steps done</span>
          <span>{c.products ?? 0} products</span>
          <span>{c.knowledge_chunks ?? 0} chunks indexed</span>
          <span>{c.policies ?? 0} covers</span>
          <span>{c.brand_users ?? 0} logins</span>
        </div>
        {brand?.website && (
          <a href={brand.website.startsWith("http") ? brand.website : `https://${brand.website}`}
            target="_blank" rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            {brand.website} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {!brand?.website && brand && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>This brand has no website on its record. The deck, the catalogue and the demo are all built from it.</span>
        </div>
      )}

      <div className="space-y-3">
        {STEPS.map((step) => {
          const p = overview?.progress?.[String(step.n)];
          const state = p?.state ?? "not_started";
          const art = artifactFor(step.n);
          const isOpen = open === step.n;
          return (
            <div key={step.n} className={`rounded-xl border ${state === "done" ? "border-emerald-500/40" : "border-border"}`}>
              <button onClick={() => setOpen(isOpen ? null : step.n)}
                className="flex w-full items-start gap-3 p-4 text-left">
                <span className="mt-0.5 shrink-0">
                  {state === "done" ? <Check className="h-5 w-5 text-emerald-600" />
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
                    {art ? (
                      <span className="text-emerald-700 dark:text-emerald-400">Built {when(art.generated_at)}</span>
                    ) : ARTIFACT_FOR[step.n] ? (
                      <span className="text-muted-foreground">Nothing built yet</span>
                    ) : null}
                    {p?.happened_on && <span className="text-muted-foreground">Met {when(p.happened_on)}</span>}
                    {p?.note && <span className="truncate text-muted-foreground">“{p.note}”</span>}
                  </div>
                </div>
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <StepTracker step={step.n} row={p} onChange={setProgress} />

                  {step.n === 1 && (
                    <StepAction
                      produces={step.produces}
                      busy={busy === "step1"}
                      disabled={!brand?.website}
                      label="Build intro deck"
                      onRun={() => void build(1, "brand-deck", {})}
                      artifact={art}
                      review={review[1]}
                      warning={(c.products ?? 0) === 0
                        ? "No catalogue yet, so there are no pieces to swap into the deck. Run the Catalogue stage in step 3 first."
                        : `${c.products} products available — the most valuable ones go into the deck.`}
                    />
                  )}

                  {step.n === 2 && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Legal entity
                          <input value={legalName} onChange={(e) => setLegalName(e.target.value)}
                            placeholder="Pasquale Bruni S.p.A."
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Registered address
                          <input value={address} onChange={(e) => setAddress(e.target.value)}
                            placeholder="from the brand record"
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          Product focus
                          <input value={focus} onChange={(e) => setFocus(e.target.value)}
                            placeholder="High jewellery, EU boutiques"
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                        </label>
                      </div>
                      <StepAction
                        produces={step.produces}
                        busy={busy === "step2"}
                        label="Build data request"
                        onRun={() => void build(2, "build-collateral", {
                          kind: "data_request",
                          legal_name: legalName.trim() || undefined,
                          address: address.trim() || undefined,
                          focus: focus.trim() || undefined,
                        })}
                        artifact={art}
                        review={review[2]}
                        warning={legalName.trim() ? undefined
                          : "No legal entity set — the workbook will go out with that field blank."}
                      />
                    </div>
                  )}

                  {step.n === 3 && brand && (
                    <BrandOnboarding brandId={brand.id} brandName={brand.name ?? ""} website={brand.website} />
                  )}

                  {step.n === 4 && (
                    <BusinessCasePanel brandId={brandId} brands={brands} onArtifact={() => void load()} />
                  )}

                  {step.n === 5 && (
                    <StepAction
                      produces={step.produces}
                      busy={busy === "step5"}
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

// The manual half of a step: where this prospect actually got to. Nothing here
// is derived — a deck existing does not mean the meeting happened.
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
          {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
      </label>
    </div>
  );
}

function StepAction({ produces, busy, disabled, label, onRun, artifact, review, warning }: {
  produces: string; busy: boolean; disabled?: boolean; label: string;
  onRun: () => void; artifact: Artifact | null; review?: string[]; warning?: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{produces}</p>
      {warning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>{warning}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onRun} disabled={busy || disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {artifact ? `Rebuild ${label.replace(/^Build /, "")}` : label}
        </button>
        {/* The link is signed afresh on every load, so a deal picked back up a
            month later still downloads instead of 404ing on an expired URL. */}
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
