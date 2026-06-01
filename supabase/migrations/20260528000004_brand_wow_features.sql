-- Brand "wow" features pass: per-customer segments + LTV, per-shop scorecard
-- aggregates, customer cross-sell recommendations, and a cache table for the
-- AI-generated feedback themes tile. All read-only, all SECURITY INVOKER
-- (existing brand RLS scopes everything to the caller's brand).

-- ────────────────────────────────────────────────────────────────────────────
-- brand_customer_segments(p_brand_id) — one row per customer with derived
-- segment flags. Used by BrandCustomers as the source of truth for the LTV
-- column and the segment-chip filters.
--
-- Segment definitions (kept in SQL so the chip labels and the data stay in
-- lockstep; tweak here and the UI reflects without code change):
--   VIP           — ≥ 3 live covers
--   Lapsed        — no live covers AND most-recent start_date > 12 months ago
--   Incomplete    — any of (dob, country, city, postcode, phone) is NULL
--   HighNPS idle  — latest satisfaction_rate ≥ 4 AND last purchase > 6mo (or never)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.brand_customer_segments(p_brand_id int)
returns table (
  customer_id          uuid,
  ltv                  numeric,
  protected_value      numeric,
  covers_live          int,
  last_purchase_at     date,
  latest_satisfaction  int,
  is_vip               bool,
  is_lapsed            bool,
  is_incomplete        bool,
  is_high_nps_idle     bool
)
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select id, date_of_birth, country, city, postcode, phone_number
    from public.profiles
    where brand_id = p_brand_id
      and (role is null or role = 'customer')
  ),
  pol as (
    select customer_id,
      count(*) filter (where status = 'live')::int               as covers_live,
      coalesce(sum(selling_price), 0)::numeric                   as ltv,
      coalesce(sum(selling_price) filter (where status = 'live'), 0)::numeric as protected_value,
      max(start_date)                                            as last_purchase_at
    from public.policies
    where brand_id = p_brand_id
    group by customer_id
  ),
  fb as (
    select user_id, max(satisfaction_rate)::int as latest_satisfaction
    from public.feedback
    where brand_id = p_brand_id
    group by user_id
  )
  select
    p.id,
    coalesce(pol.ltv, 0)                                                  as ltv,
    coalesce(pol.protected_value, 0)                                      as protected_value,
    coalesce(pol.covers_live, 0)                                          as covers_live,
    pol.last_purchase_at,
    fb.latest_satisfaction,
    (coalesce(pol.covers_live, 0) >= 3)                                   as is_vip,
    (
      coalesce(pol.covers_live, 0) = 0
      and pol.last_purchase_at is not null
      and pol.last_purchase_at < (current_date - interval '12 months')
    )                                                                     as is_lapsed,
    (
      p.date_of_birth is null
      or p.country    is null
      or p.city       is null
      or p.postcode   is null
      or p.phone_number is null
    )                                                                     as is_incomplete,
    (
      coalesce(fb.latest_satisfaction, 0) >= 4
      and (
        pol.last_purchase_at is null
        or pol.last_purchase_at < (current_date - interval '6 months')
      )
    )                                                                     as is_high_nps_idle
  from p
  left join pol on pol.customer_id = p.id
  left join fb  on fb.user_id     = p.id;
$$;

grant execute on function public.brand_customer_segments(int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- brand_shop_aggregates(p_brand_id) — per-shop dashboard metrics powering the
-- shop scorecards. One row per active shop.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.brand_shop_aggregates(p_brand_id int)
returns table (
  shop_id              int,
  shop_name            text,
  shop_city            text,
  shop_country         text,
  covers_live          int,
  customers_live       int,
  protected_value      numeric,
  open_claims          int,
  total_profiles       int,
  registered_profiles  int,
  fully_profiled       int,
  feedback_count       int,
  avg_satisfaction     numeric,
  avg_recommendation   numeric,
  avg_peace_of_mind    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with shops_b as (
    select id, name, city, country
    from public.shops
    where brand_id = p_brand_id
  ),
  pol as (
    select shop_id,
      count(*) filter (where status='live')::int                      as covers_live,
      count(distinct customer_id) filter (where status='live')::int   as customers_live,
      coalesce(sum(selling_price) filter (where status='live'), 0)::numeric as protected_value
    from public.policies
    where brand_id = p_brand_id
    group by shop_id
  ),
  cl as (
    select p.shop_id, count(c.*)::int as open_claims
    from public.claims c
    join public.policies p on p.id = c.policy_id
    where p.brand_id = p_brand_id and c.status = 'open'
    group by p.shop_id
  ),
  prof as (
    select shop_id,
      count(*)::int                                                   as total_profiles,
      count(*) filter (where registered_at is not null)::int          as registered_profiles,
      count(*) filter (
        where registered_at is not null
          and date_of_birth is not null
          and country     is not null
          and city        is not null
          and postcode    is not null
          and address     is not null
          and province    is not null
          and nationality is not null
          and phone_number is not null
      )::int                                                          as fully_profiled
    from public.profiles
    where brand_id = p_brand_id
      and (role is null or role = 'customer')
    group by shop_id
  ),
  fb as (
    select p.shop_id,
      count(f.*)::int                              as feedback_count,
      avg(f.satisfaction_rate)::numeric            as avg_satisfaction,
      avg(f.recommendation_rate)::numeric          as avg_recommendation,
      avg(f.peace_of_mind_rate)::numeric           as avg_peace_of_mind
    from public.feedback f
    join public.profiles p on p.id = f.user_id
    where f.brand_id = p_brand_id
    group by p.shop_id
  )
  select
    s.id,
    s.name,
    s.city,
    s.country,
    coalesce(pol.covers_live,        0)::int,
    coalesce(pol.customers_live,     0)::int,
    coalesce(pol.protected_value,    0)::numeric,
    coalesce(cl.open_claims,         0)::int,
    coalesce(prof.total_profiles,    0)::int,
    coalesce(prof.registered_profiles, 0)::int,
    coalesce(prof.fully_profiled,    0)::int,
    coalesce(fb.feedback_count,      0)::int,
    fb.avg_satisfaction,
    fb.avg_recommendation,
    fb.avg_peace_of_mind
  from shops_b s
  left join pol  on pol.shop_id  = s.id
  left join cl   on cl.shop_id   = s.id
  left join prof on prof.shop_id = s.id
  left join fb   on fb.shop_id   = s.id;
$$;

grant execute on function public.brand_shop_aggregates(int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- brand_customer_cross_sell(p_customer_id) — 5 cross-sell candidates for one
-- customer, derived from category overlap with their past purchases and
-- excluding items they already own. Mirrors the Customer 360 playbook's
-- cross-sell step so the AI panel and the customer-detail sidebar always
-- agree.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.brand_customer_cross_sell(p_customer_id uuid)
returns table (
  catalogue_id int,
  product_name text,
  category     text,
  sku          text,
  picture      text,
  reason       text
)
language sql
stable
security invoker
set search_path = public
as $$
  with customer_brand as (
    select brand_id from public.profiles where id = p_customer_id limit 1
  ),
  past_categories as (
    select distinct c.category
    from public.policies p
    join public.catalogues c on c.id = p.item_id
    where p.customer_id = p_customer_id
      and c.category is not null
  )
  select
    cat.id,
    cat.name,
    cat.category,
    cat.sku,
    cat.picture,
    case when pc.category is not null
      then 'Same category as past purchases'
      else 'Suggested from same brand'
    end as reason
  from public.catalogues cat
  left join past_categories pc on pc.category = cat.category
  where cat.brand_id = (select brand_id from customer_brand)
    and cat.id not in (
      select item_id from public.policies
      where customer_id = p_customer_id and item_id is not null
    )
  order by (case when pc.category is not null then 0 else 1 end), cat.name
  limit 5;
$$;

grant execute on function public.brand_customer_cross_sell(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- feedback_themes_cache — AI-summarised feedback themes per brand, refreshed
-- on demand by the feedback-themes edge function. One row per (brand_id,
-- window_days). Writes are service-role only; reads are scoped to the
-- caller's brand (or admin).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.feedback_themes_cache (
  id           bigserial primary key,
  brand_id     bigint not null references public.brands(id) on delete cascade,
  window_days  int    not null,
  generated_at timestamptz not null default now(),
  payload      jsonb  not null,
  unique (brand_id, window_days)
);

create index if not exists feedback_themes_cache_brand_window_idx
  on public.feedback_themes_cache (brand_id, window_days);

alter table public.feedback_themes_cache enable row level security;

grant select on public.feedback_themes_cache to authenticated;
grant all on public.feedback_themes_cache to service_role;

drop policy if exists "feedback_themes_cache: brand select" on public.feedback_themes_cache;
create policy "feedback_themes_cache: brand select"
  on public.feedback_themes_cache for select to authenticated
  using (
    brand_id = public.get_my_brand_id()
    and public.get_my_role() in ('brand', 'brand_admin', 'brand_user')
  );

drop policy if exists "feedback_themes_cache: admin select" on public.feedback_themes_cache;
create policy "feedback_themes_cache: admin select"
  on public.feedback_themes_cache for select to authenticated
  using (public.get_my_role() = 'admin');
