-- customer_vault_summary — returns just what /home's Vault hero needs in a
-- single JSON payload: the aggregates (live count, total count, protected
-- value, earliest start, categories) plus a small gallery slice (up to N
-- catalogue thumbnails, live first). Avoids pulling 100+ policy rows with
-- joins via useCustomerPolicies just to render six pictures and a hero
-- number.
--
-- SECURITY INVOKER: RLS on policies/catalogues already restricts the
-- caller to their own rows.

create or replace function public.customer_vault_summary(p_gallery_limit int default 6)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with all_pol as (
    select id, status, start_date, selling_price, item_id
    from public.policies
    where customer_id = public.get_my_profile_id()
  ),
  agg as (
    select
      count(*) filter (where status = 'live')::int        as live_count,
      count(*)::int                                       as all_count,
      coalesce(sum(selling_price) filter (where status = 'live'), 0)::numeric as protected_value,
      min(start_date)                                     as earliest_start
    from all_pol
  ),
  categories as (
    select distinct btrim(coalesce(c.category, c.collection)) as category
    from all_pol p
    join public.catalogues c on c.id = p.item_id
    where p.status = 'live'
      and coalesce(c.category, c.collection) is not null
      and btrim(coalesce(c.category, c.collection)) <> ''
  ),
  gallery as (
    select p.id,
           p.status,
           c.picture,
           c.name
    from all_pol p
    left join public.catalogues c on c.id = p.item_id
    order by (p.status = 'live') desc,
             coalesce(p.start_date, current_date) desc
    limit greatest(coalesce(p_gallery_limit, 6), 1)
  )
  select jsonb_build_object(
    'live_count',      (select live_count from agg),
    'all_count',       (select all_count from agg),
    'protected_value', (select protected_value from agg),
    'earliest_start',  (select earliest_start from agg),
    'categories',      coalesce((select jsonb_agg(category order by category) from categories), '[]'::jsonb),
    'gallery',         coalesce((
                         select jsonb_agg(
                           jsonb_build_object(
                             'id', id,
                             'status', status,
                             'picture', picture,
                             'name', name
                           )
                         ) from gallery
                       ), '[]'::jsonb)
  );
$$;

grant execute on function public.customer_vault_summary(int) to authenticated;
