-- Two things a brand record could not say, both raised on the same review of the
-- dev brand flow.
--
-- 1. A PRODUCT FOCUS A PERSON OWNS.
--
--    The focus is read off the catalogue, and the catalogue is a sample of a
--    website: it arrives page by page over the hour after a brand is created, so
--    the reading taken in minute one was frozen by an "only fill what is empty"
--    guard and never revisited. Prada was written as "Eyewear, Fragrance and
--    beauty" off a handful of rows and still said so at 260 pieces.
--
--    The fix in onboard-brand is to re-read it every run. That is only safe if a
--    person's own wording is protected, because the focus is a commercial
--    judgement — which categories a pilot covers — and the catalogue only gets a
--    vote. This flag is that protection: set the moment an admin edits the field,
--    and never cleared by anything automatic.
--
-- 2. FEE RATES PER CATEGORY.
--
--    "Fee rates are per category — in Ferragamo there is Bags and Watches, two
--    different categories with different fee rates." The record had exactly one
--    set of rates for a whole house, so a bag and a watch were priced the same
--    or somebody kept the difference in their head.
--
--    The brand-level columns stay, and stay authoritative where nothing more
--    specific is set: policies, the Chubb export, the internal report and the
--    analyst's schema all read brands.insurance_premium, and moving those is a
--    separate piece of work with a separate blast radius. What this adds is the
--    per-category override, which is what an admin edits and what the pricing
--    step reads.

-- ── 1. The focus, once a person has said what it is ─────────────────────────
alter table public.brands
  add column if not exists product_focus_manual boolean not null default false;

comment on column public.brands.product_focus_manual is
  'Set when an admin types the product focus by hand. While true, onboarding never rewrites '
  'brands.product_focus — the catalogue reading is a draft, a person''s wording is not.';

-- Every focus on the table today was written by the catalogue reader, so none of
-- them is claimed as a person''s: they are all free to be re-read, which is the
-- point of the change that ships with this.

-- ── 2. Fee rates, per category ──────────────────────────────────────────────
create table if not exists public.brand_category_fees (
  id                bigserial primary key,
  brand_id          bigint not null references public.brands(id) on delete cascade,
  -- One of the pricing model's categories (see src/pages/admin/_components/pricing-model.ts:
  -- jewellery | watches | bags | apparel | leather | other). Lower case, so the
  -- business case can join it against insurance_quotes.category without guessing.
  category          text not null,
  -- All nullable: a category row exists to say what is DIFFERENT about it. A null
  -- here is not zero, it is "whatever the house-wide rate is" — which is why
  -- nothing downstream may coalesce it to 0.
  insurance_premium numeric,
  activation_fee    numeric,
  aion_premium_fee  numeric,
  min_covered_value numeric,
  max_covered_value numeric,
  -- Where the number came from: a Chubb quote reference, a meeting, a dataroom.
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (brand_id, category),
  constraint brand_category_fees_category_lower check (category = lower(category)),
  -- A band that cannot contain anything is a typo, and it would silently refuse
  -- every cover in that category.
  constraint brand_category_fees_band check (
    min_covered_value is null or max_covered_value is null
    or min_covered_value < max_covered_value)
);

create index if not exists brand_category_fees_brand_idx
  on public.brand_category_fees (brand_id);

comment on table public.brand_category_fees is
  'Per-category overrides of the brand-level fee rates. A null column means "use the '
  'brand-level value" — never zero. Read by the commercial cycle; brands.* stays the '
  'fallback and stays what live policies and the Chubb export are priced from.';

alter table public.brand_category_fees enable row level security;

-- AION admins only, like the quote library it sits next to. Deliberately NOT
-- readable by a brand user: these are our commercial terms per category, and a
-- brand portal has no screen that needs them.
drop policy if exists "admin: all on brand_category_fees" on public.brand_category_fees;
create policy "admin: all on brand_category_fees" on public.brand_category_fees
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- public has no updated_at trigger helper — the one that exists is storage's.
create or replace function public.touch_brand_category_fees()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists brand_category_fees_touch on public.brand_category_fees;
create trigger brand_category_fees_touch
  before update on public.brand_category_fees
  for each row execute function public.touch_brand_category_fees();

-- ── The rates a house actually charges, per category ────────────────────────
-- One place that answers "what is the rate for bags at this house", so a caller
-- never has to remember that a null in the override table means the brand-level
-- value rather than zero.
create or replace function public.brand_fee_rates(p_brand_id bigint)
returns table (
  category          text,
  insurance_premium numeric,
  activation_fee    numeric,
  aion_premium_fee  numeric,
  min_covered_value numeric,
  max_covered_value numeric,
  -- Which of the five came from the category row rather than from the record.
  overridden        text[],
  note              text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    f.category,
    coalesce(f.insurance_premium, b.insurance_premium),
    coalesce(f.activation_fee,    b.activation_fee),
    coalesce(f.aion_premium_fee,  b.aion_premium_fee),
    coalesce(f.min_covered_value, b.min_covered_value),
    coalesce(f.max_covered_value, b.max_covered_value),
    array_remove(array[
      case when f.insurance_premium is not null then 'insurance_premium' end,
      case when f.activation_fee    is not null then 'activation_fee'    end,
      case when f.aion_premium_fee  is not null then 'aion_premium_fee'  end,
      case when f.min_covered_value is not null then 'min_covered_value' end,
      case when f.max_covered_value is not null then 'max_covered_value' end
    ], null),
    f.note
  from public.brand_category_fees f
  join public.brands b on b.id = f.brand_id
  where f.brand_id = p_brand_id
  order by f.category;
$$;

revoke all on function public.brand_fee_rates(bigint) from public;
grant execute on function public.brand_fee_rates(bigint) to authenticated;

-- ── 3. A demo that shows only what is being demonstrated ────────────────────
-- "If we give them the AI assistant to test, I'd make sure only the relevant
-- content is there — I'd take out the Cover, Claim etc."
--
-- Those screens belong to the insurance programme. When the meeting is about the
-- assistant, they are four sidebar entries of somebody else's product, and a
-- prospect clicking Claims during their own demo finds seeded claims for a
-- programme they have not bought.
--
-- Per brand, and off by default, so no live client's portal changes. Read by the
-- brand portal through the tenant lookup, which is why this column ships BEFORE
-- the bundle that selects it.
alter table public.brands
  add column if not exists demo_assistant_only boolean not null default false;

comment on column public.brands.demo_assistant_only is
  'Brand portal shows only the assistant and the knowledge base — covers, claims, customers, '
  'shops and insights are hidden. For assistant-only demos. Never set on a live programme.';
