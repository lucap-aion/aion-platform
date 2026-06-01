-- Brand-side fraud-suspicion flags on claims and a small helper for the
-- renewal pipeline. Both read-only, SECURITY INVOKER, RLS scopes rows to the
-- caller's brand.
--
-- Flag definitions (encoded in SQL so the labels and the data stay in
-- lockstep with the UI):
--   fresh_cover           — claim created within 30 days of the cover's
--                           start_date. Strong fraud signal for ad-hoc
--                           policies bought right before an "incident".
--   frequent_claimer      — customer has ≥3 claims (any status) in the last
--                           12 months on this brand's policies.
--   repeat_incident_city  — customer has ≥2 claims in the same incident_city
--                           (any time window). Either pattern of behaviour
--                           or sloppy data, both worth flagging.

create or replace function public.brand_claim_flags(p_brand_id int)
returns table (claim_id bigint, flags text[])
language sql
stable
security invoker
set search_path = public
as $$
  with cl as (
    select c.id,
           c.incident_city,
           c.created_at,
           p.start_date as cover_start_date,
           p.customer_id
    from public.claims c
    join public.policies p on p.id = c.policy_id
    where p.brand_id = p_brand_id
  ),
  cust_recent as (
    select customer_id, count(*)::int as n
    from cl
    where created_at > (now() - interval '12 months')
    group by customer_id
  ),
  cust_city as (
    select customer_id, incident_city, count(*)::int as n
    from cl
    where incident_city is not null
    group by customer_id, incident_city
  ),
  scored as (
    select
      cl.id,
      array_remove(array[
        case
          when cl.cover_start_date is not null
            and cl.created_at::date < cl.cover_start_date + interval '30 days'
            then 'fresh_cover'
        end,
        case when coalesce(cr.n, 0) >= 3       then 'frequent_claimer'    end,
        case when coalesce(cc.n, 0) >= 2       then 'repeat_incident_city' end
      ], null) as flags
    from cl
    left join cust_recent cr on cr.customer_id = cl.customer_id
    left join cust_city   cc on cc.customer_id = cl.customer_id
                            and cc.incident_city = cl.incident_city
  )
  select id, flags
  from scored
  where array_length(flags, 1) is not null;
$$;

grant execute on function public.brand_claim_flags(int) to authenticated;
