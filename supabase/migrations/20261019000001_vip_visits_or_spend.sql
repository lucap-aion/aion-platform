-- VIP was "≥ 3 live covers". Giulio: "cosa significa clienti VIP?" — and the
-- answer was weak: half of Roberto Coin's 56 VIPs had bought their three pieces
-- in a single visit, and what they spent never counted.
--
-- VIP is now a client who came back OR spent a lot:
--   • purchases on at least 2 different days (Rome calendar), or
--   • total spend ≥ €20,000 (≈ the top 10% of Roberto Coin's clients).
--
-- A cancelled cover is a returned piece, not a purchase: it no longer counts
-- towards LTV, last purchase or VIP. Blocked covers still do — the piece was
-- bought. Same signature and return type, so the deployed client is unaffected.
-- The threshold is a constant here; per-brand thresholds wait for a brand
-- whose tickets make €20k meaningless.

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
      count(*) filter (where status = 'live')::int                         as covers_live,
      coalesce(sum(selling_price) filter (where status is distinct from 'cancelled'), 0)::numeric as ltv,
      coalesce(sum(selling_price) filter (where status = 'live'), 0)::numeric as protected_value,
      max(start_date) filter (where status is distinct from 'cancelled')     as last_purchase_at,
      count(distinct (start_date at time zone 'Europe/Rome')::date)
        filter (where status is distinct from 'cancelled')::int             as purchase_days
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
    (coalesce(pol.purchase_days, 0) >= 2 or coalesce(pol.ltv, 0) >= 20000) as is_vip,
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
