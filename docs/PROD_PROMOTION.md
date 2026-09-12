# Promoting to production

Everything you need to move work from DEV to PROD on the AION platform, and the
traps that will bite if you don't. Written 2026-09-11; every number in the
"measured gap" section was read off the live projects that day, so re-measure
before trusting them (§9 has the commands).

Read §1–§4 before touching anything. §5 is the small, self-contained security
promotion. §6 is the large feature-parity promotion. They are different jobs
with different risk, and doing the first does not commit you to the second.

---

## 1. What "production" actually is

Five separate things have to move, and nothing moves any of them together.
There is no CI: no `.github/workflows`, no deploy pipeline. Every one of these
is a deliberate, separate act.

| # | Component | Where it lives | How it moves |
|---|-----------|----------------|--------------|
| 1 | Git history | branch `main` (`lucap-aion/aion-platform`) | merge / cherry-pick + push |
| 2 | Frontend bundle | Vercel, `app.aioncover.com` | **automatic on push to the deploy branch** — you never run a deploy |
| 3 | Database schema | Supabase project `dvmhwsmunvfdxnvckdom` (Frankfurt) | SQL via the management API, by hand |
| 4 | Edge functions | same project | `supabase functions deploy` with the PAT |
| 5 | Secrets + Auth config | same project | management API / dashboard |

**Component 2 is the one you cannot do and cannot watch.** The Vercel project
is not in the CLI-logged-in account, so `vercel` can't see it. Pushing the
branch *is* the deploy; then you wait a few minutes for the build. Do not try
to deploy the frontend yourself and do not read a stale page as a broken
deploy — see `vercel_dev_autodeploy` in memory.

> **Unverified:** DEV auto-deploys from `dev` (confirmed by the user 2026-07-01).
> That PROD auto-deploys from `main` is the obvious counterpart but has never
> been confirmed. **Ask before relying on it.** If prod is instead pinned to a
> tag or deployed by hand from the Vercel dashboard, every "ship the client
> first" step below changes shape.

---

## 2. The two rules that override everything

### 2.1 Database and client ship in lockstep, client first

Never apply a migration that the deployed bundle isn't already ready for. This
is not a style preference — it has broken production here before (2026-05-15,
`brands_public` + bucket privacy: every `<img>` 404'd instantly).

The order is always:

1. Ship the client (push → wait for the Vercel build → hard-refresh → verify).
2. Confirm the new bundle still works against the **old** schema. It should: a
   correctly written client change is forward-compatible.
3. Apply the migration.
4. Verify again.

If you cannot deploy the client from this session, **do not apply the
migration**. Stop and hand it back. See `feedback_db_client_lockstep`.

### 2.2 Never run `supabase db push` against either project

`supabase_migrations.schema_migrations` is not a truthful record:

* DEV: 82 rows, newest `20260702205627` — but 141 migration files on the branch.
* PROD: 64 rows, newest `20260528000001` — 78 files on `main`.

Everything since those dates was applied through
`POST /v1/projects/<ref>/database/query` and never recorded. `db push` would
try to replay ~60 already-applied migrations on prod. Most are idempotent;
the seed `INSERT`s are not. Keep applying by management API, and keep *not*
writing tracking rows — consistently untracked beats half-tracked. See
`aion_migrations_untracked`.

---

## 3. The measured gap, 2026-09-11

### 3.1 Git

`dev` is **154 commits ahead** of `origin/main`; `main` is **8 ahead** of dev.

Those 8 are not lost work. Four are merge commits from `dev`; the other four
are the 2026-09-07 RRP/coverage-cap dashboard work, which exists on `dev` as
well under different SHAs (`e6aeb16 6b633bd 2392c3a 1d17f8c` vs
`a8fe54a a50cb0b 29865d1 d665ec8`). They were committed on both branches
rather than merged across. Confirm before promoting:

```bash
git cherry dev origin/main      # every line should start with "-" (already applied)
```

A `+` line means main carries something dev does not, and a merge would drop
it. Handle that first. The branches diverged at `c484d7f` (2026-06-16), so a
plain `git merge dev` into main will be a large, real merge — expect conflicts
in `AdminBrands.tsx`, `BrandDashboard.tsx` and `TenantContext.tsx`, which is
where main's unique lines sit (older versions of files dev has since rewritten).

### 3.2 Database

**PROD is a strict subset of DEV.** No table, column, or function exists on
prod that does not exist on dev. That is the single most reassuring fact in
this document: promotion is additive, never reconciliatory.

| | DEV | PROD |
|---|---|---|
| public tables | 54 | 22 |
| RLS policies | 138 | 81 |
| extensions | pg_cron, pg_net, pgsodium, supabase_vault, **vector** | pg_cron, pg_net, pgsodium, supabase_vault |
| cron jobs | 7 | **0** |

Prod's 22 tables: `admin_impersonation_log, admins, ai_chats, ai_chats_brand,
ai_query_log, brand_leads, brands, catalogues, claims, comune_province,
external_api_credentials, external_requests, feedback, feedback_themes_cache,
manufacturing_costs, policies, profiles, reports, returns, shops,
support_messages, tourism_stats`.

The 32 dev-only tables are the knowledge base, the assistant, storefront/
Shopify, onboarding, decks, events and the commercial cycle — i.e. everything
built since June.

Columns dev has that prod lacks, **on tables prod already has**:

| table | missing columns |
|---|---|
| `brands` | `is_prospect, legal_name, min_covered_value, product_focus, registered_address` |
| `catalogues` | `price, price_currency, price_source, price_updated_at` |
| `ai_chats_brand` | `impersonated_by` |
| `ai_query_log` | `impersonated_profile_id` |

`pgvector` is not installed on prod. Anything touching embeddings (knowledge
base, visual search, assistant) needs `create extension vector` there first.

### 3.3 Edge functions

Prod runs **8** functions; dev runs **28**. Every shared function on prod is
older than dev's:

| function | dev | prod |
|---|---|---|
| `send-email` | v41 (2026-09-11) | v15 (2026-04-26) |
| `auth-email-hook` | v33 (2026-09-11) | v15 (2026-04-26) |
| `query-ai` | v31 (2026-09-11) | v14 (2026-05-26) |
| `feedback-themes` | v11 (2026-09-11) | v5 (2026-06-04) |
| `generate-daily-chubb-export` | v9 (2026-09-11) | v4 (2026-05-14) |
| `generate-internal-report` | v9 (2026-09-11) | v4 (2026-05-14) |
| `tourism-ingest` | v19 (2026-09-11) | v10 (2026-05-27) |
| `tourism-narrate` | v9 (2026-09-11) | v4 (2026-05-27) |

The 20 dev-only ones: `brand-assistant, brand-deck, build-collateral,
claim-photo-prefill, crawl-worker, customer-outreach-draft, faq-polish,
generate-brand-docs, image-proxy, import-cards, index-catalogue-images,
ingest-knowledge, onboard-brand, parse-knowledge, promote-brand, seed-crawl,
shopify-orders, sync-catalogue-prices, sync-storefront, update-knowledge`.

(The whole dev set was redeployed on 2026-09-11 — that is the origin-allowlist
change `54dd8cf` touching 18 functions, not 18 unrelated changes.)

### 3.4 Secrets

On DEV, missing on PROD: **`AUTH_HOOK_SECRET`**, `KNOWLEDGE_BATCH_SECRET`,
`JINA_API_KEY`, `VOYAGE_API_KEY`.

On PROD, missing on DEV: `ENV` (= `production`, verified by hash). That is
correct and must stay: it is what suppresses the `[DEV]` subject prefix. Never
set `ENV` on dev.

`AUTH_HOOK_SECRET` is a production outage waiting to happen — see §4.1.

---

## 4. The traps

### 4.1 ☠️ Deploying `auth-email-hook` without setting `AUTH_HOOK_SECRET` kills all auth mail

The fixed function verifies a Standard Webhooks HMAC and **fails closed**:
`verifyWebhookSignature` returns `false` when the secret is empty
(`supabase/functions/_shared/auth-hook.ts`), and the handler answers
`401 invalid signature`. Prod has no `AUTH_HOOK_SECRET`.

Prod's Auth hook is live and pointed at that function
(`hook_send_email_enabled = true`,
`hook_send_email_uri = …/functions/v1/auth-email-hook`), so the blast radius is
every transactional auth email: signup confirmation, password reset, magic
link, invite. Silently. Nothing errors in the UI — the mail just never arrives.

Correct order, no gap:

1. Read prod's current hook secret from the dashboard (Auth → Hooks → Send Email).
2. Set it as the `AUTH_HOOK_SECRET` **function secret** on prod, identical value.
3. Verify both read the same string.
4. *Then* deploy the function.
5. Immediately trigger a real password reset on prod and confirm the mail lands.

Rotating the secret later is a separate, also-ordered operation: add the new
secret to the hook config while the function still accepts the old one, deploy
a function that accepts both, then drop the old. Do not rotate and deploy in
one step.

The `whsec_…` string committed in `supabase/config.toml` is the **local** value
only. Both hosted projects have their own random secrets. Do not copy it.

### 4.2 ☠️ The `brands` anon-column migration must land *after* the client

`20260911000008_brands_anon_columns.sql` revokes `select` on `public.brands`
from `anon` and re-grants only the 17 safe columns. Prod's deployed client
(`main`'s `TenantContext.tsx`) still asks for:

```
email, hq_address, hq_city, hq_country, hq_postcode,
activation_fee, insurance_premium, aion_premium_fee
```

Apply the migration first and **every anonymous visitor's brand page returns
42501** — no theming, no tenant resolution, on every branded portal at once.
The fix is commit `f2a8ce7`, which narrows `BRAND_SELECT`. It must be live on
prod's bundle before the SQL runs.

Verified 2026-09-11: all 17 granted columns exist on prod's `brands`, so the
migration itself will not error there.

### 4.3 `query-ai` is not schema-clean against prod

Dev's `query-ai` reads `brand_knowledge_docs`, which prod does not have. Deploy
it to prod as-is and that code path fails. Either ship the knowledge-base
tables first, or hold `query-ai` back from a security-only promotion.

Pre-flighted 2026-09-11 — the other seven shared functions touch no table or
RPC that prod lacks:

```
✅ send-email  ✅ auth-email-hook  ✅ feedback-themes
✅ generate-daily-chubb-export    ✅ generate-internal-report
✅ tourism-ingest                 ✅ tourism-narrate
⚠️ query-ai → brand_knowledge_docs
```

### 4.4 Prod's schema is not `main`'s migration history

Some wave-era backend was applied to prod by hand even though the files never
reached `main`: `ai_chats_brand`, `ai_run_query_user`, `feedback_themes_cache`
(+ locale), the `feedback-themes` function, and the `20260528*` brand_ai_query /
brand_wow / aggregates migrations. Prod's tracked migrations stop at
`20260528000001` for exactly this reason.

So never reason about prod from the file list. Reason from the live schema
(§9). The good news from §3.2 is that prod holds nothing dev lacks, so
reconciliation means "skip what is already there", not "merge two histories".

### 4.5 No cron on prod

Seven scheduled jobs run on dev (`onboarding-tick`, `knowledge-crawl-tick`,
`storefront-sync`, `storefront-orders-sync`, `knowledge-seed-weekly`,
`purge-deleted-knowledge`, `background-job-watch`). None exist on prod. Any
feature whose work happens in the background is inert on prod until its job is
scheduled — and it will look deployed and broken rather than absent.

Cron jobs call edge functions with an auth header
(`20260730000012_cron_auth_header.sql`); that header has to be right for the
prod project, not copied from dev.

Schedule them from the **current** tick definitions, not from an older
migration. Every tick dispatches through `net.http_post`, and pg_net's default
timeout is 5 s — which it enforces by cancelling the request. A cold
`onboard-brand` needs longer than that just to boot, so the function never runs
a line and the queued stage stays `pending` with `queued_at` set, no error, no
attempt spent: the screen says "queued, it runs on the server" forever.
Measured on dev 2026-09-12 — three consecutive ticks dispatched Pomellato's
branding stage and none of them started it; the same call by hand took 6.5 s
and worked. `20260912000001_tick_http_timeout.sql` puts
`timeout_milliseconds := 20000` on all five, and that migration has to be in
before the jobs are worth scheduling.

### 4.6 Storage buckets are public on both

`claims_media`, `profile_pictures`, `purchase_receipts` are `public=true` on
dev *and* prod. This is audit item 3 and it is still open in both places.
Promotion neither fixes nor worsens it — but do not "tidy" it during a
promotion. It is a lockstep change of its own (~15 render sites, ~6 upload
sites, 24 `profiles.avatar` rows holding public URLs) and belongs in its own
session.

---

## 5. Promotion A — the security fixes only

The smallest useful unit. Six commits, four of them server-only. Nothing here
depends on the 32 missing tables, so it can ship years before feature parity.

What it closes on prod: send-email being usable by anyone holding the bundled
anon key; the `transfer_request` policy takeover; unsigned auth webhooks; and
`Access-Control-Allow-Origin: *` on 18 functions.

| commit | what | kind |
|---|---|---|
| `f439b25` | send-email authenticates + authorises per type | function only |
| `a85fa88` | send-email `transfer_request` ownership check | function only |
| `8c6d7d3` | auth-email-hook HMAC verification (+ `_shared/auth-hook.ts`, 9 tests) | function only, **needs a secret** |
| `54dd8cf` | `_shared/origin.ts` on 18 functions | function only |
| `f2a8ce7` | `TenantContext` stops selecting commercial columns | **client** |
| `8bab6c5` | `20260911000008` anon column grants | **migration** |

### Order

**Step 0 — pre-flight.** Run §9. Confirm: prod still has no `AUTH_HOOK_SECRET`;
prod's `brands` still has all 17 columns; `git cherry` is clean.

**Step 1 — set `AUTH_HOOK_SECRET` on prod** to prod's existing hook secret
(§4.1). Nothing is deployed yet, so this is inert and reversible.

**Step 2 — get the code onto `main`.** Cherry-pick the six commits rather than
merging `dev`: a merge drags 154 commits of unreleased features into the branch
Vercel builds prod from, and every one of them expects tables prod lacks.

```bash
git checkout main && git pull
git cherry-pick f439b25 a85fa88 8c6d7d3 54dd8cf f2a8ce7   # NOT 8bab6c5 yet
```

Expect a conflict in `send-email/index.ts` (prod's copy is v15-era) and in
`TenantContext.tsx`. Resolve toward dev's version.

**Step 3 — push `main`.** This is the client deploy. Wait for the Vercel build.

**Step 4 — verify the old schema still works with the new bundle.** Open a
branded portal signed out: theming, logo, FAQ all correct. The narrowed
`BRAND_SELECT` asks for fewer columns than prod still grants, so this must pass.
If it doesn't, stop — do not apply the migration.

**Step 5 — deploy the functions** to prod. Seven of the eight; hold `query-ai`
unless the knowledge tables went too (§4.3):

```bash
SUPABASE_ACCESS_TOKEN=$PAT supabase functions deploy send-email \
  --project-ref dvmhwsmunvfdxnvckdom
```

Deploy `auth-email-hook` **last**, and only after step 1 is confirmed.

**Step 6 — verify auth mail immediately.** Trigger a real password reset
against prod. If it does not arrive within a minute, roll the function back
(§8) before doing anything else.

**Step 7 — apply the migration.**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/dvmhwsmunvfdxnvckdom/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json;print(json.dumps({"query":open("supabase/migrations/20260911000008_brands_anon_columns.sql").read()}))')"
```

Then commit `8bab6c5` onto main (the file, for the record — the SQL is already
applied).

**Step 8 — verify.** Signed-out landing page lists houses; a branded portal
themes correctly; an anonymous request for `activation_fee` returns 42501:

```bash
curl -s "https://dvmhwsmunvfdxnvckdom.supabase.co/rest/v1/brands?select=activation_fee&limit=1" \
  -H "apikey: <prod anon key>"     # expect 42501
```

**Step 9 — send one real email of each type** that prod uses (claim submitted,
support, invite) and confirm they still send. The new authorisation table
(`POLICY` in `send-email/index.ts`) is the most behaviour-changing part of this
promotion and the failure mode is a refusal, not an error.

### What this promotion does *not* close

Audit item 3 (public buckets), item 4's signed-in half (a brand user can still
read another brand's commercial columns — needs the `brands_public` view split),
items 6, 7, 8. See `security_audit_unfixed`.

---

## 6. Promotion B — feature parity

Much larger: 32 tables, 63 migration files, 20 new functions, an extension, 7
cron jobs, 4 secrets, and a 154-commit merge. Do not attempt it as one act.

Suggested slices, each independently shippable and each one a §2.1 lockstep:

1. **Extension + commercial cycle** — `create extension vector`; the
   `20260910*` series plus `20260912000001/2`; `onboard-brand`,
   `build-collateral` and `brand-deck`. Check first
   whether prod already has `20260910000008/9` (applied to dev out of band).
   Watch `commercial_cycle_overview`: `legal_name` changed from an alias of
   `brands.name` to a real nullable column, so the DB must not land ahead of
   the client. `is_prospect` defaults to `false`, so every existing prod brand
   stays a client. See `commercial_cycle_prod_gap`.

   **Two binaries no migration carries.** `deck_templates` rows name storage
   paths in the private `decks` bucket, and the bucket is created empty:

   | path | what it is |
   |------|------------|
   | `templates/AION_Teaser_New.pptx` | the intro deck. Every generated deck — teaser, ops, business case — is built *into* this package for its theme, so without it all three fail at the first download. |
   | `templates/AION_Data_Request_Pilot_Blank.xlsx` | the blank data-request workbook. Committed at `docs/templates/AION_Data_Request_Pilot_Blank.xlsx`, and reproducible from a revised source with `scripts/blank-data-request-template.py`. |

   Copy the teaser from dev; upload the workbook from the repo. Do **not** register
   `templates/AION_Data_Request_Pilot.xlsx` on prod, and do not "restore" it if
   you find it there: that file is the first house's own returned workbook, and
   the generator only ever replaced three strings in it — everything else, their
   revenues, units, average prices, COGS ratios, price-band volumes, their
   answers on group payment structure and on their broker, and their tenant's
   Microsoft sensitivity labels, went out to every prospect who received a data
   request. `20260912000002` repoints the row; `build-collateral` now also reads
   the file back before it leaves and refuses it with "DO NOT SEND" if any
   figure is already filled in.
2. **Knowledge base + assistant** — `20260625*`, `20260707*`, the
   `brand_knowledge_*` tables, `VOYAGE_API_KEY` + `JINA_API_KEY` +
   `KNOWLEDGE_BATCH_SECRET`, the crawl/ingest/assistant functions, and the
   crawl cron jobs. This is what unblocks `query-ai` (§4.3).
3. **Storefront / Shopify** — `20260701*`, `20260911000003/4`, sync functions,
   the two storefront cron jobs. Never run against a real shop yet (see
   `shopify_integration_state`), so it is prod-inert until a shop connects.
4. **Onboarding + decks + events** — `20260730*` series, the background runner
   and its `onboarding-tick` job. The background runner is the piece most
   likely to look deployed and do nothing without §4.5.

Before any slice: re-run §9 and diff again. And note that a large part of the
customer/brand "wave" is **not on `dev` at all** — it is parked on `wave-stash`
and has its own prod reconciliation story (`wave_stash_unreleased_features`).
Do not conflate "promote dev to prod" with "release the wave".

---

## 7. Data that lives only on prod

Prod carries the real customers, policies and claims for the live programme.
Nothing in a promotion should write to those tables. Two specific things to
refuse:

* **Demo/seed data.** `20260730000005_brand_demo_data.sql` and the
  `generate_brand_demo_data` family exist to populate prospect houses. Demo
  tooling is refused unless a brand is flagged `is_prospect`, which defaults to
  `false` — so it is safe by default, and it stays safe only if nobody flags a
  real client.
* **`demo_purge`.** `20260730000006_demo_purge.sql` deletes. Never run it on
  prod as part of a migration sweep; it is a manual, deliberate tool.

---

## 8. Rollback

* **Edge function** — redeploy the previous source. The old version is on
  `main` (or the commit before the cherry-pick). This is the fastest rollback
  available and it is the one to reach for first.
* **`20260911000008`** — `grant select on public.brands to anon;` restores the
  old behaviour immediately.
* **Frontend** — Vercel keeps previous deployments; promote the prior one from
  the dashboard. You cannot do this from the CLI here.
* **A dropped/altered table** — there is no rollback. Prod has no
  point-in-time restore configured that this document can confirm. **Check
  before any destructive DDL.** Nothing in Promotion A is destructive.

---

## 9. Pre-flight: measure, don't assume

Every number in §3 came from these. Re-run them; they take a minute.

```bash
PAT=$(grep -oE 'sbp_[A-Za-z0-9_-]+' \
  ~/.claude/projects/-Users-lucapontone-Downloads-AION-aion-platform/memory/aion_supabase_pat.md | head -1)
DEV=tlmdlskiubfdhywmzgzb; PROD=dvmhwsmunvfdxnvckdom

q(){ curl -s -X POST "https://api.supabase.com/v1/projects/$1/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d "{\"query\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$2")}"; }

# tables / columns / functions — diff dev against prod
q $PROD "select table_name||'.'||column_name c from information_schema.columns
         where table_schema='public' order by 1"
# functions deployed, with versions and dates
curl -s "https://api.supabase.com/v1/projects/$PROD/functions" -H "Authorization: Bearer $PAT"
# secret NAMES (values come back as sha256 digests, not plaintext)
curl -s "https://api.supabase.com/v1/projects/$PROD/secrets" -H "Authorization: Bearer $PAT"
# auth hook + redirect allow-list
curl -s "https://api.supabase.com/v1/projects/$PROD/config/auth" -H "Authorization: Bearer $PAT"
# cron, buckets, extensions
q $PROD "select jobname, schedule from cron.job"
q $PROD "select id, public from storage.buckets order by id"
q $PROD "select extname from pg_extension order by 1"
```

The secrets endpoint returns each value as a sha256 digest. To test a guess
without ever printing the secret: `printf 'production' | shasum -a 256`.

Git side:

```bash
git fetch origin
git cherry dev origin/main                 # "+" = main has work dev lacks. Investigate.
git rev-list --count origin/main..dev      # size of the promotion
git diff --numstat dev origin/main | awk '$1>0'   # where main's unique lines are
```

---

## 10. Open questions to settle with the user before the first promotion

1. **Does prod's Vercel project deploy from `main`?** Everything in §5 assumes
   push-to-`main` = prod deploy. Unconfirmed.
2. **Is there a staging/RC environment?** `rc.app.aioncover.com` redirects to
   `app.aioncover.com/rc` in `vercel.json`, and dev's auth allow-list mentions
   `rc.app.aioncover.com`, but no third Supabase project exists. If RC is just
   a path on prod, there is no rehearsal environment and §5 runs straight at
   production.
3. **Is prod backed up / is PITR on?** Determines whether §8's "no rollback for
   DDL" is really true.
4. **Promotion A now, or wait for parity?** A is self-contained and closes four
   confirmed vulnerabilities. B is weeks. They do not have to be the same
   decision.

---

## 11. Related memory

`aion_migrations_untracked` · `feedback_db_client_lockstep` ·
`vercel_dev_autodeploy` · `commercial_cycle_prod_gap` ·
`wave_stash_unreleased_features` · `security_audit_unfixed` ·
`aion_supabase_projects` · `aion_supabase_pat`
