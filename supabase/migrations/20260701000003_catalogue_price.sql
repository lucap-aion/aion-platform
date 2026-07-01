-- Online price for catalogue items, matched by SKU from the brand's public
-- storefront (Roberto Coin runs Shopify; /products.json exposes name, SKU and
-- price). Filled by the sync-catalogue-prices edge function. Null price = not
-- listed online (discontinued / boutique-only / high-jewelry "price on request").
--
-- Additive + nullable, so the eplay catalogue sync (which never sets price) is
-- unaffected — it inserts new items with a null price that the price sync fills.

alter table public.catalogues
  add column if not exists price            numeric,
  add column if not exists price_currency   text,
  add column if not exists price_source     text,        -- e.g. 'website'
  add column if not exists price_updated_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the visual-search match to also return the price, so photo-search
-- product cards can show it. Return signature changes, so drop + recreate.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.match_catalogue_images(bigint, vector, integer, double precision);

create or replace function public.match_catalogue_images(
  p_brand_id        bigint,
  p_query_embedding vector(1024),
  p_match_count     integer default 8,
  p_min_similarity  double precision default 0.2
)
returns table (
  catalogue_id   bigint,
  name           text,
  collection     text,
  category       text,
  sku            text,
  picture        text,
  price          numeric,
  price_currency text,
  similarity     double precision
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    e.catalogue_id,
    c.name,
    c.collection,
    c.category,
    c.sku,
    c.picture,
    c.price,
    c.price_currency,
    1 - (e.embedding <=> p_query_embedding) as similarity
  from public.catalogue_image_embeddings e
  join public.catalogues c on c.id = e.catalogue_id
  where e.brand_id = p_brand_id
    and e.embedding is not null
    and 1 - (e.embedding <=> p_query_embedding) >= p_min_similarity
  order by e.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 24));
$$;

revoke all on function public.match_catalogue_images(bigint, vector, integer, double precision) from public;
grant execute on function public.match_catalogue_images(bigint, vector, integer, double precision) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Weekly price refresh (prices are "subject to change"). Reuses the crawl
-- pipeline's Vault secrets; no-ops without them.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.catalogue_price_sync_tick()
returns void language plpgsql security definer as $fn$
declare v_secret text; v_base text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'knowledge_batch_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'knowledge_functions_base';
  if v_secret is null or v_base is null then return; end if;
  perform net.http_post(
    url := v_base || '/sync-catalogue-prices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-secret', v_secret),
    body := jsonb_build_object()
  );
end $fn$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'catalogue-price-sync') then
    perform cron.unschedule('catalogue-price-sync');
  end if;
  perform cron.schedule('catalogue-price-sync', '30 4 * * 1', 'select public.catalogue_price_sync_tick();');
end $$;
