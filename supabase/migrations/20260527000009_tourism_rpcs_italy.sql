-- Repoint the tourism RPCs at the renamed comune_province table.
-- compute_tourism_correlations: same logic, joins comune_province (not veneto_)
-- tourism_unmatched_shops: same logic, joins comune_province

create or replace function public.compute_tourism_correlations(
  p_from        date    default null,
  p_to          date    default null,
  p_lag_months  int     default 0,
  p_metric      text    default 'presences',
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
  series           jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_from   date := coalesce(p_from, (now() - interval '36 months')::date);
  v_to     date := coalesce(p_to,   now()::date);
  v_metric text := case when p_metric in ('arrivals','presences') then p_metric else 'presences' end;
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'admin role required';
  end if;

  return query
  with
  policy_months as (
    select
      cp.province     as cte_province,
      cp.area_code    as cte_area_code,
      date_trunc('month', p.start_date)::date as month_start,
      count(*)::bigint as activations
    from public.policies p
    join public.shops s              on s.id = p.shop_id
    join public.comune_province cp
      on cp.comune_norm = public.tourism_norm(s.city)
    where p.start_date >= v_from
      and p.start_date <  (v_to + interval '1 month')::date
      and p.status in ('live','expired','cancelled')
    group by cp.province, cp.area_code, date_trunc('month', p.start_date)
  ),
  tourism_months as (
    select
      ts.area_code    as cte_area_code,
      ts.period_start as month_start,
      case when v_metric = 'arrivals' then ts.arrivals else ts.presences end as tourism_val
    from public.tourism_stats ts
    where ts.granularity = 'province'
      and ts.period_start between (v_from - (p_lag_months || ' months')::interval)::date
                              and (v_to   - (p_lag_months || ' months')::interval)::date
  ),
  aligned as (
    select
      pm.cte_province,
      pm.cte_area_code,
      pm.month_start,
      pm.activations,
      tm.tourism_val
    from policy_months pm
    join tourism_months tm
      on tm.cte_area_code = pm.cte_area_code
     and tm.month_start = (pm.month_start - (p_lag_months || ' months')::interval)::date
    where tm.tourism_val is not null
  ),
  ranked as (
    select
      a.cte_province,
      a.cte_area_code,
      a.month_start,
      a.activations,
      a.tourism_val,
      rank() over (partition by a.cte_province order by a.activations) as r_a,
      rank() over (partition by a.cte_province order by a.tourism_val) as r_t
    from aligned a
  ),
  agg as (
    select
      r.cte_province,
      max(r.cte_area_code) as cte_area_code,
      count(*)::int        as n_periods,
      round( corr(r.activations::numeric, r.tourism_val::numeric)::numeric, 4 ) as pearson,
      round( corr(r.r_a::numeric, r.r_t::numeric)::numeric, 4 )                 as spearman,
      sum(r.activations)::bigint  as total_activations,
      sum(r.tourism_val)::bigint  as total_tourism,
      jsonb_agg(
        jsonb_build_object(
          'm', to_char(r.month_start, 'YYYY-MM'),
          'a', r.activations,
          't', r.tourism_val
        ) order by r.month_start
      ) as series
    from ranked r
    group by r.cte_province
  )
  select
    agg.cte_province,
    agg.cte_area_code,
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

create or replace function public.tourism_unmatched_shops()
returns table (city text, shop_count bigint, policy_count bigint)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'admin role required';
  end if;
  return query
    select
      x.cte_city                       as city,
      x.cte_shop_count                 as shop_count,
      x.cte_policy_count               as policy_count
    from (
      select
        coalesce(s.city, '(null)')::text as cte_city,
        count(distinct s.id)             as cte_shop_count,
        count(p.id)                      as cte_policy_count
      from public.shops s
      left join public.policies p on p.shop_id = s.id
      where not exists (
        select 1 from public.comune_province cp
        where cp.comune_norm = public.tourism_norm(s.city)
      )
        and (s.country is null or upper(s.country) in ('ITALY','ITALIA','IT'))
      group by s.city
    ) x
    order by x.cte_policy_count desc nulls last
    limit 50;
end;
$$;
