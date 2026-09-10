-- The cycle screen needs to see the pipeline, because the pipeline now builds
-- the collateral.
--
-- The intro deck, the data request and the ops deck used to be three buttons a
-- human pressed on three different screens. They are stages now — they start
-- themselves when a brand is created, they retry, and they record why they
-- failed. So each step of the cycle has to be able to show the state of its own
-- stage rather than only "a file exists / no file exists", which cannot tell
-- "running" from "never tried" from "failed an hour ago".
create or replace function public.commercial_cycle_overview(p_brand_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'AION admin only' using errcode = '42501';
  end if;

  return (select jsonb_build_object(
    'brand', (select jsonb_build_object(
                'id', b.id, 'name', b.name, 'website', b.website, 'slug', b.slug,
                'logo_small', b.logo_small,
                'legal_name', b.name,
                'address', nullif(concat_ws(', ', b.hq_address, b.hq_postcode, b.hq_city, b.hq_country), ''))
              from public.brands b where b.id = p_brand_id),
    'artifacts', coalesce((select jsonb_object_agg(o.template_key, jsonb_build_object(
                    'storage_path', o.storage_path,
                    'generated_at', o.generated_at,
                    'slots_filled', jsonb_array_length(coalesce(o.slots_filled, '[]'::jsonb))))
                  from public.brand_deck_outputs o where o.brand_id = p_brand_id), '{}'::jsonb),
    -- Per-stage pipeline state, keyed by stage, so a step can say "queued",
    -- "running", or why it failed instead of just "nothing built yet".
    'stages', coalesce((select jsonb_object_agg(s.stage, jsonb_build_object(
                    'status', s.status,
                    'queued', s.queued_at is not null and s.status = 'pending',
                    'attempts', s.attempts,
                    'error', s.error,
                    'detail', s.detail,
                    'finished_at', s.finished_at))
                  from public.brand_onboarding s where s.brand_id = p_brand_id), '{}'::jsonb),
    'progress', coalesce((select jsonb_object_agg(p.step::text, jsonb_build_object(
                    'state', p.state, 'note', p.note,
                    'happened_on', p.happened_on, 'updated_at', p.updated_at))
                  from public.brand_commercial_progress p where p.brand_id = p_brand_id), '{}'::jsonb),
    'counts', jsonb_build_object(
       'products',   (select count(*) from public.storefront_products where brand_id = p_brand_id),
       'knowledge_chunks', (select count(*) from public.brand_knowledge_chunks where brand_id = p_brand_id),
       'customers',  (select count(*) from public.profiles
                       where brand_id = p_brand_id and (role is null or role = 'customer')),
       'policies',   (select count(*) from public.policies where brand_id = p_brand_id),
       'brand_users',(select count(*) from public.profiles
                       where brand_id = p_brand_id and role in ('brand', 'brand_admin', 'brand_user'))),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
                    'category', q.category, 'coverage', q.coverage,
                    'damage_scope', q.damage_scope, 'rate_of_cogs', q.rate_of_cogs,
                    'quoted_for', q.quoted_for, 'quoted_at', q.quoted_at,
                    'own_quote', coalesce(q.brand_id = p_brand_id, false))
                    order by q.category, q.coverage)
                  from public.insurance_quotes q where q.active), '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.commercial_cycle_overview(bigint) from public, anon;
grant execute on function public.commercial_cycle_overview(bigint) to authenticated, service_role;
