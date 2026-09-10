import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, Sparkles, AlertCircle, ArrowRight, Check } from "lucide-react";

// Starting a brand: a name, a website, and the address it will live at.
//
// It used to be the full record — forty-odd fields across basic info, five image
// uploads, theme colours, fonts, FAQ JSON in two languages, Chubb reporting
// flags and four fee fields — presented to someone who has just got off a first
// call and knows two things about the prospect. Everything in it that CAN be
// discovered is discovered from the website: the logo, the colours, the
// description, the hero imagery, the catalogue, the whole knowledge base.
//
// So this asks for the facts nobody can derive, creates the brand, and starts
// the pipeline. The full record is the Record tab, for the things a human
// genuinely decides — fees, Chubb prefix, coverage ceiling — once there is
// something to decide them about.
//
// The slug is here rather than generated silently because it is the brand's
// public address: Roberto Coin is /rc, and rc.app.aioncover.com redirects onto
// it. Deriving "roberto-coin" behind someone's back and putting it in a customer
// URL is not a detail to hide.

type Existing = { id: number; name: string | null; slug: string | null; website: string | null };

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// The origin, and only the origin. Somebody pasting a deep link from the
// browser bar would otherwise register https://brand.com/en-gb/collections/x as
// the brand's website, and every crawl would start from a category page.
function normaliseUrl(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "");
  if (!t) return "";
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.hostname.toLowerCase()}`;
  } catch {
    return withScheme.replace(/\/+$/, "");
  }
}

// pomellato.com and www.pomellato.com are the same house.
const hostKey = (url: string | null | undefined) =>
  (url ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export default function NewBrand() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<Existing[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  // A ref, not the busy flag: state updates are async, so Enter and a click
  // landing in the same tick both passed the `!busy` check and created the brand
  // twice — and with the pipeline queued on create, that is two crawls.
  const submitting = useRef(false);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Every brand, once. There are four; a filtered query per keystroke would cost
  // more than the whole table, and comparing locally sidesteps having to escape
  // user input into a PostgREST filter.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("brands").select("id, name, slug, website").order("name");
      setExisting((data ?? []) as Existing[]);
    })();
  }, []);

  const url = normaliseUrl(website);
  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const urlLooksReal = /^https?:\/\/[^/\s.]+\.[^/\s]{2,}/.test(url);

  // Checked before insert AND enforced by a unique index, because a check in a
  // form is a courtesy — two admins on the same call defeat it.
  const clash = useMemo(() => {
    const byHost = urlLooksReal
      ? existing.find((b) => hostKey(b.website) && hostKey(b.website) === hostKey(url)) : undefined;
    if (byHost) return { brand: byHost, on: "website" as const };
    const bySlug = effectiveSlug
      ? existing.find((b) => (b.slug ?? "").toLowerCase() === effectiveSlug) : undefined;
    if (bySlug) return { brand: bySlug, on: "slug" as const };
    return null;
  }, [existing, url, urlLooksReal, effectiveSlug]);

  const problem =
    name.trim().length < 2 ? "Give the brand a name."
    : !website.trim() ? "Add the website — everything else is read from it."
    : !urlLooksReal ? "That does not look like a domain yet."
    : !effectiveSlug ? "The address needs at least one letter or number."
    // Deliberately terse: the banner above already names the brand and offers to
    // open it. Repeating the whole sentence beside the button says the same
    // thing twice and makes neither easier to read.
    : clash ? "Resolve the conflict above."
    : null;

  const create = async () => {
    if (submitting.current || problem) return;
    submitting.current = true;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("brands")
        .insert({ name: name.trim(), slug: effectiveSlug, website: url, status: "pending" })
        .select("id").single();

      if (error) {
        // The unique indexes are the real guarantee; translate them, because
        // "duplicate key value violates unique constraint brands_slug_unique"
        // is not something to put in front of anyone.
        const dup = /brands_slug_unique/.test(error.message) ? "address"
          : /brands_website_host_unique/.test(error.message) ? "website" : null;
        throw new Error(dup
          ? `Another brand already uses that ${dup}. Someone may have just created it — reload and check the list.`
          : error.message);
      }
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
          description: "Reading the site, pulling the catalogue and drafting the documents. This runs in the background — you can leave the page.",
        });
      }
      // Navigate without clearing `submitting`: this component is on its way out,
      // and re-enabling the button for the frame before it unmounts is one more
      // chance to double-create.
      navigate(`/admin/brands/${id}?tab=cycle`);
      return;
    } catch (e) {
      toast({ title: "Could not create the brand", description: e instanceof Error ? e.message : "unknown error", variant: "destructive" });
      submitting.current = false;
      setBusy(false);
    }
  };

  const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void create(); } };

  return (
    <form className="max-w-xl space-y-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <div className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Brand name</span>
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter}
            placeholder="Pasquale Bruni" autoComplete="off" spellCheck={false} className={field} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Website</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={onEnter}
            onBlur={() => setWebsite((w) => (normaliseUrl(w) || w.trim()))}
            placeholder="pasqualebruni.com" autoComplete="off" spellCheck={false} inputMode="url" className={field} />
          <span className="text-xs text-muted-foreground">
            {website.trim() && !urlLooksReal
              ? <span className="text-amber-600">That does not look like a domain yet.</span>
              : <>The logo, colours, catalogue and knowledge base are all read from here.</>}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Address</span>
          <input
            value={slugTouched ? slug : effectiveSlug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
            onKeyDown={onEnter}
            placeholder="pasquale-bruni" autoComplete="off" spellCheck={false} className={field} />
          <span className="text-xs text-muted-foreground">
            {effectiveSlug
              ? <>Their portal will be <span className="text-foreground">app.aioncover.com/{effectiveSlug}</span>. Follows the name unless you change it.</>
              : <>Follows the brand name.</>}
          </span>
        </label>
      </div>

      {/* Says which brand, and offers to open it — the answer to "wait, do we
          already have these people?" is one click, not a trip to the list. */}
      {clash && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            <strong>{clash.brand.name ?? `Brand ${clash.brand.id}`}</strong> already uses that {clash.on}
            {clash.on === "website" ? " — this is the same house." : "."}
          </span>
          <button type="button" onClick={() => navigate(`/admin/brands/${clash.brand.id}?tab=cycle`)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs">
            Open it <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Each line leads with the thing it produces, so the list can be scanned down the
          left edge instead of read as five sentences. */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5" /> What happens automatically
        </p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          <li><span className="font-medium text-foreground">Identity</span> — logo, colours, description and hero image, taken from the site</li>
          <li><span className="font-medium text-foreground">Knowledge base</span> — the site and recent news, indexed</li>
          <li><span className="font-medium text-foreground">Catalogue</span> — found and pulled in, with the product images made searchable</li>
          <li><span className="font-medium text-foreground">Decks</span> — the intro and operations decks, plus the data-request workbook</li>
          <li><span className="font-medium text-foreground">Client documents</span> — drafts of the FAQ, sales one-pager, cover summary, activation email and proposal</li>
        </ul>
        <p className="mt-2.5 flex items-start gap-1.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Fees, the Chubb prefix and the coverage ceiling are yours to set, on the Record tab.
            They are decisions, not facts a website can tell us.
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!!problem || busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Creating…" : "Create and start"}
        </button>
        <button type="button" onClick={() => navigate("/admin/brands")} disabled={busy}
          className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
        {/* Why the button is off, rather than a disabled button and no reason. */}
        <span className="text-xs text-muted-foreground">
          {busy ? "Creating the brand and queueing the pipeline…"
            : problem ?? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Ready — press Enter
              </span>}
        </span>
      </div>
    </form>
  );
}
