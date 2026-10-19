-- Storefront collection — drop the machine codes, merge the spelling variants.
--
-- collection comes from a Shopify tag, so whatever the shop types lands here.
-- Luisa Beccaria's catalogue carried ~50 products whose "collection" was an
-- internal code ("SAPG::9370 ~ Color") and three spellings of the same line
-- ("Ceremony Guest" / "cerimony guest" / "Ceremony guests"), plus Beach vs
-- Beachwear and Bride vs Bridal. The assistant matches collections with ILIKE,
-- so a split line means a "show me the Ceremony Guest pieces" answer silently
-- misses 19 of them, and a machine code is noise an associate can't use.
--
-- Codes become NULL rather than a guess: category now says what the piece is,
-- which is the useful half. Season codes (P26, W25, H04) are LEFT alone — they
-- are a real grouping, just an internal one, and the prompt explains them.

CREATE OR REPLACE FUNCTION public.normalize_storefront_collection(p_collection text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_collection IS NULL OR btrim(p_collection) = '' THEN NULL
    -- internal ERP/tag codes, e.g. "SAPG::9370 ~ Color"
    WHEN btrim(p_collection) ~* '^SAPG::' OR btrim(p_collection) ~* '~ *Color$' THEN NULL
    -- one spelling per line
    WHEN btrim(p_collection) ~* '^c[ei]r[ei]mony *guests?$' THEN 'Ceremony Guest'
    WHEN btrim(p_collection) ~* '^beach$'                THEN 'Beachwear'
    WHEN btrim(p_collection) ~* '^bride$'                THEN 'Bridal'
    ELSE btrim(p_collection)
  END;
$$;

-- Fold it into the insert/update trigger that already fills category, so a
-- re-sync can't reintroduce the codes.
CREATE OR REPLACE FUNCTION public.storefront_fill_category()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.collection := public.normalize_storefront_collection(NEW.collection);
  IF NEW.category IS NULL OR btrim(NEW.category) = '' THEN
    NEW.category := public.derive_storefront_category(
      NEW.name, NEW.description, NEW.collection);
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.storefront_products
SET collection = public.normalize_storefront_collection(collection)
WHERE collection IS DISTINCT FROM public.normalize_storefront_collection(collection);
