-- The drafted documents were unreachable, and so was approving them.
--
-- generate-brand-docs has been writing five documents per brand since July —
-- FAQ, sales-floor one-pager, cover summary, activation email, partnership
-- proposal — each with the sources it was written from. Fifteen of them sit on
-- dev right now. Nothing in the app has ever read the table.
--
-- Worse, the FAQ. Each draft is fully rendered into body_json in the exact block
-- shape the public FAQ page renders, and approve_brand_faq() exists to move it
-- onto brands.faq_en / faq_it. Nothing has ever called it, so three brands have
-- a finished, source-cited FAQ one function call away from a public page that is
-- still empty — the very complaint the original migration opens with.
--
-- Two things were missing for a review screen: the write grants (only SELECT was
-- granted, so an admin approving a draft got a permission error through RLS that
-- looked like the row not existing), and an approve function the browser can
-- actually call.

-- ── 1. Let an admin act on a draft ───────────────────────────────────────────
-- RLS still decides who: "admin: all on brand_documents" for writes, and the
-- brand's own read-only policy is untouched. This only stops the grant layer
-- from refusing before RLS is ever consulted.
grant insert, update, delete on public.brand_documents to authenticated;
grant usage, select on sequence public.brand_documents_id_seq to authenticated;

-- ── 2. Publishing the FAQ, from the browser ──────────────────────────────────
-- Was service_role only, which meant the only way to publish a FAQ was a SQL
-- client. Now callable by a signed-in admin, with the check inside the function:
-- it is SECURITY DEFINER, so RLS on brands does not apply and the gate has to be
-- explicit.
create or replace function public.approve_brand_faq(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_en jsonb; v_it jsonb;
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'AION admin only' using errcode = '42501';
  end if;

  select body_json into v_en from public.brand_documents
   where brand_id = p_brand_id and kind = 'faq' and locale = 'en';
  select body_json into v_it from public.brand_documents
   where brand_id = p_brand_id and kind = 'faq' and locale = 'it';

  if v_en is null and v_it is null then
    return jsonb_build_object('ok', false, 'reason', 'no FAQ draft to approve — generate it first');
  end if;

  update public.brands set
    faq_en = coalesce(v_en, faq_en),
    faq_it = coalesce(v_it, faq_it)
  where id = p_brand_id;

  update public.brand_documents
     set status = 'published', approved_at = now()
   where brand_id = p_brand_id and kind = 'faq';

  return jsonb_build_object('ok', true,
    'faq_en', coalesce(jsonb_array_length(v_en), 0),
    'faq_it', coalesce(jsonb_array_length(v_it), 0));
end;
$$;

revoke all on function public.approve_brand_faq(bigint) from public, anon;
grant execute on function public.approve_brand_faq(bigint) to authenticated, service_role;

-- ── 3. Taking a published FAQ back down ──────────────────────────────────────
-- Approving is not a one-way door. A FAQ that turns out to be wrong on a point
-- of cover is on a public page until someone can pull it, and "edit the brands
-- row by hand" is not a recovery plan.
create or replace function public.unpublish_brand_faq(p_brand_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'AION admin only' using errcode = '42501';
  end if;

  update public.brands set faq_en = null, faq_it = null where id = p_brand_id;
  update public.brand_documents
     set status = 'draft', approved_at = null
   where brand_id = p_brand_id and kind = 'faq';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unpublish_brand_faq(bigint) from public, anon;
grant execute on function public.unpublish_brand_faq(bigint) to authenticated, service_role;

-- ── 4. Catalogue source, editable ────────────────────────────────────────────
-- storefront_sources is how a brand's catalogue is found. Detection handles
-- Shopify and gives up on everything else, writing platform 'none' — and there
-- was no way to correct it, because only SELECT was granted. A house whose shop
-- lives on a subdomain, or behind a redirect detection could not follow, had no
-- catalogue, which in turn means no images for the intro deck and no pieces for
-- the demo book. The whole cycle stalls on a row nobody could edit.
grant insert, update on public.storefront_sources to authenticated;
