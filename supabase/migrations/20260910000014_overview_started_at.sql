-- The cycle screen has to be able to tell a stage that is working from one that stopped.
--
-- A stage claims 'running' before it starts and is only moved off it by the code that
-- finishes; an invocation killed mid-run leaves the claim standing. The screen had no way to
-- notice, because the overview returned status, queued, attempts, error, detail and
-- finished_at — everything except the one field that says how long the claim has stood.
-- So it showed "Running now. It will land here when it finishes" about a stage that had
-- already died, and disabled the button that would have retried it.
--
-- started_at is all it needs: older than any invocation could live means abandoned.

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
                'is_prospect', b.is_prospect,
                'legal_name', b.legal_name,
                'product_focus', b.product_focus,
                -- The override when there is one, the composed hq_* fields when
                -- there is not. The screen shows one address either way.
                'address', coalesce(
                  nullif(b.registered_address, ''),
                  nullif(concat_ws(', ', b.hq_address, b.hq_postcode, b.hq_city, b.hq_country), '')),
                'address_is_override', nullif(b.registered_address, '') is not null)
              from public.brands b where b.id = p_brand_id),
    'artifacts', coalesce((select jsonb_object_agg(o.template_key, jsonb_build_object(
                    'storage_path', o.storage_path,
                    'generated_at', o.generated_at,
                    'slots_filled', jsonb_array_length(coalesce(o.slots_filled, '[]'::jsonb))))
                  from public.brand_deck_outputs o where o.brand_id = p_brand_id), '{}'::jsonb),
    'stages', coalesce((select jsonb_object_agg(s.stage, jsonb_build_object(
                    'status', s.status,
                    'queued', s.queued_at is not null and s.status = 'pending',
                    'attempts', s.attempts,
                    'error', s.error,
                    'detail', s.detail,
                    'started_at', s.started_at,
                    'finished_at', s.finished_at))
                  from public.brand_onboarding s where s.brand_id = p_brand_id), '{}'::jsonb),
    'progress', coalesce((select jsonb_object_agg(p.step::text, jsonb_build_object(
                    'state', p.state, 'note', p.note,
                    'happened_on', p.happened_on, 'updated_at', p.updated_at))
                  from public.brand_commercial_progress p where p.brand_id = p_brand_id), '{}'::jsonb),
    -- The perimeter, so step 4 opens on what was left there rather than on one
    -- blank segment. Null when the conversation has not started.
    'business_case', (select jsonb_build_object(
                    'months', c.months, 'setup_discounted', c.setup_discounted,
                    'include_api', c.include_api, 'segments', c.segments,
                    'imported_from', c.imported_from, 'imported_at', c.imported_at,
                    'updated_at', c.updated_at)
                  from public.brand_business_case c where c.brand_id = p_brand_id),
    'counts', jsonb_build_object(
       'products',   (select count(*) from public.storefront_products where brand_id = p_brand_id),
       'knowledge_docs', (select count(*) from public.brand_knowledge_docs where brand_id = p_brand_id),
       'knowledge_chunks', (select count(*) from public.brand_knowledge_chunks where brand_id = p_brand_id),
       'customers',  (select count(*) from public.profiles
                       where brand_id = p_brand_id and (role is null or role = 'customer')),
       'policies',   (select count(*) from public.policies where brand_id = p_brand_id),
       'shops',      (select count(*) from public.shops where brand_id = p_brand_id),
       -- A crawl still draining is the difference between "the catalogue stage
       -- finished and found nothing" and "give it another minute".
       'crawl_pending', (select count(*) from public.knowledge_crawl_queue
                          where brand_id = p_brand_id and status = 'pending'),
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
