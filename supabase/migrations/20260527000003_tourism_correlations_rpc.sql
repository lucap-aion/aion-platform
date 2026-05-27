-- Correlate monthly tourism (arrivi/presenze) against monthly cover activations
-- per Veneto province. Uses Pearson (corr) and Spearman (corr on ranks).
-- Lag is in months: positive = tourism leads activations; negative = lags.

create or replace function public.compute_tourism_correlations(
  p_from        date    default null,
  p_to          date    default null,
  p_lag_months  int     default 0,
  p_metric      text    default 'presences',  -- 'arrivals' | 'presences'
  p_min_periods int     default 6
)
returns table (
  province         text,
  area_code        text,
  n_periods        int,
  pearson          numeric,
  spearman         numeric,
  total_activations bigint,
  total_tourism    bigint,
  series           jsonb  -- [{m,a,t}] aligned monthly points after lag
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_from date := coalesce(p_from, (now() - interval '36 months')::date);
  v_to   date := coalesce(p_to,   now()::date);
  v_metric text := case when p_metric in ('arrivals','presences') then p_metric else 'presences' end;
begin
  -- Admin guard: same pattern as ai_run_query.
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'admin role required';
  end if;

  return query
  with
  -- Map each Veneto policy to a province via shops.city -> veneto_comune_province.
  policy_months as (
    select
      vcp.province,
      vcp.area_code,
      date_trunc('month', p.start_date)::date as month_start,
      count(*)::bigint as activations
    from public.policies p
    join public.shops s              on s.id = p.shop_id
    join public.veneto_comune_province vcp
      on vcp.comune_norm = public.tourism_norm(s.city)
    where p.start_date >= v_from
      and p.start_date <  (v_to + interval '1 month')::date
      and p.status in ('live','expired','cancelled')
    group by vcp.province, vcp.area_code, date_trunc('month', p.start_date)
  ),
  -- Tourism rows, restricted to province granularity for Veneto.
  tourism_months as (
    select
      ts.province,
      ts.area_code,
      ts.period_start as month_start,
      case when v_metric = 'arrivals' then ts.arrivals else ts.presences end as tourism_val
    from public.tourism_stats ts
    where ts.granularity = 'province'
      and ts.period_start between (v_from - (p_lag_months || ' months')::interval)::date
                              and (v_to   - (p_lag_months || ' months')::interval)::date
  ),
  -- Align: a tourism observation at month T is paired with activations at T+lag.
  aligned as (
    select
      pm.province,
      pm.area_code,
      pm.month_start,
      pm.activations,
      tm.tourism_val
    from policy_months pm
    join tourism_months tm
      on tm.area_code = pm.area_code
     and tm.month_start = (pm.month_start - (p_lag_months || ' months')::interval)::date
    where tm.tourism_val is not null
  ),
  ranked as (
    select
      province, area_code, month_start, activations, tourism_val,
      rank() over (partition by province order by activations) as r_a,
      rank() over (partition by province order by tourism_val) as r_t
    from aligned
  ),
  agg as (
    select
      province,
      max(area_code) as area_code,
      count(*)::int as n_periods,
      round( corr(activations::numeric, tourism_val::numeric)::numeric, 4 ) as pearson,
      round( corr(r_a::numeric, r_t::numeric)::numeric, 4 )                 as spearman,
      sum(activations)::bigint as total_activations,
      sum(tourism_val)::bigint as total_tourism,
      jsonb_agg(
        jsonb_build_object(
          'm', to_char(month_start, 'YYYY-MM'),
          'a', activations,
          't', tourism_val
        ) order by month_start
      ) as series
    from ranked
    group by province
  )
  select
    agg.province,
    agg.area_code,
    agg.n_periods,
    agg.pearson,
    agg.spearman,
    agg.total_activations,
    agg.total_tourism,
    agg.series
  from agg
  where agg.n_periods >= greatest(p_min_periods, 2)
  order by abs(coalesce(agg.pearson, 0)) desc nulls last;
end;
$$;

grant execute on function public.compute_tourism_correlations(date, date, int, text, int)
  to authenticated;

-- Diagnostic: Italian shops.city values that don't match any Veneto comune row.
-- Surfaces gaps so admins can extend veneto_comune_province.
create or replace function public.tourism_unmatched_shops()
returns table (city text, shop_count bigint, policy_count bigint)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'admin role required';
  end if;
  return query
    select
      coalesce(s.city, '(null)') as city,
      count(distinct s.id)       as shop_count,
      count(p.id)                as policy_count
    from public.shops s
    left join public.policies p on p.shop_id = s.id
    where not exists (
      select 1 from public.veneto_comune_province vcp
      where vcp.comune_norm = public.tourism_norm(s.city)
    )
    and (s.country is null or upper(s.country) in ('ITALY','ITALIA','IT'))
    group by s.city
    order by policy_count desc nulls last
    limit 50;
end;
$$;

grant execute on function public.tourism_unmatched_shops() to authenticated;
