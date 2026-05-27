-- Fix: shops.city is declared varchar, so coalesce() inferred varchar and
-- mismatched the RETURNS TABLE (city text, ...) signature. Explicit ::text
-- cast makes the result column types match.

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
        select 1 from public.veneto_comune_province vcp
        where vcp.comune_norm = public.tourism_norm(s.city)
      )
        and (s.country is null or upper(s.country) in ('ITALY','ITALIA','IT'))
      group by s.city
    ) x
    order by x.cte_policy_count desc nulls last
    limit 50;
end;
$$;
