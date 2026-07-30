-- Which generated client should the demo login become? The one whose account
-- shows the most: most covers, and a claim if any of them has one.
create or replace function public.pick_demo_client_profile(p_brand_id bigint)
returns table (profile_id uuid, covers integer, claims integer)
language sql stable security definer set search_path = public as $$
  select p.id,
         count(distinct po.id)::int,
         count(distinct c.id)::int
  from public.profiles p
  join public.brand_demo_artifacts a
    on a.brand_id = p_brand_id and a.table_name = 'profiles' and a.row_pk = p.id::text
  join public.policies po on po.customer_id = p.id
  left join public.claims c on c.policy_id = po.id
  where p.brand_id = p_brand_id and p.user_id is null
  group by p.id
  order by count(distinct c.id) desc, count(distinct po.id) desc
  limit 1;
$$;
grant execute on function public.pick_demo_client_profile(bigint) to service_role;
