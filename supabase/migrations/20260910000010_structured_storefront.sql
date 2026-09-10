-- A catalogue for the houses that are not on Shopify.
--
-- storefront_sources.platform allowed exactly two values: 'shopify', or 'none'
-- meaning give up. 'none' was most of the luxury market — Ferragamo 403s a plain
-- fetch and runs its own commerce stack, Buccellati answers 406, Damiani 403 —
-- and a brand with no catalogue has no intro deck imagery and no demo book of
-- business, because both are built from the brand's own pieces.
--
-- They all publish their catalogue anyway, as schema.org Product JSON-LD, because
-- Google requires it to show them in shopping results. One Ferragamo category
-- page carries an ItemList of sixty products with name, image, price and
-- currency. So 'structured' is a third platform: read what the site already
-- publishes for search engines, out of the pages the crawler has already visited.
alter table public.storefront_sources
  drop constraint if exists storefront_sources_platform_check;

alter table public.storefront_sources
  add constraint storefront_sources_platform_check
  check (platform in ('shopify', 'structured', 'none'));

comment on column public.storefront_sources.platform is
  'shopify = /products.json feed. structured = schema.org Product JSON-LD read from crawled pages. none = neither works, so this brand has no catalogue.';
