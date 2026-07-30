-- Storefront category — derive it when the shop doesn't give us one.
--
-- storefront_products.category comes from Shopify's product_type. Some shops
-- (Luisa Beccaria) leave product_type empty on every product, so category was
-- NULL for all 1013 rows while collection carried the OCCASION ("Ceremony
-- Guest", "Cocktail", "Beachwear") rather than the garment type. The assistant
-- matches products on collection/name/category, so "a wedding-guest dress under
-- €1,500" resolved to the cheapest things in the Ceremony Guest occasion —
-- bucket bags, clutches and belts — presented as dresses. Same trap for every
-- occasion collection, and the house also sells homeware (glasses, tumblers,
-- vases, candles) that must never surface as clothing.
--
-- So: derive the garment type from the product name, with the description and
-- the collection as fallbacks, and keep it filled by trigger so a re-sync can't
-- blank it again. Shops that DO send product_type (Roberto Coin: 570/570) keep
-- their own value — the trigger only fills a NULL.

CREATE OR REPLACE FUNCTION public.derive_storefront_category(
  p_name text, p_description text, p_collection text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name ~* '(glass|tumbler|vase|candle|placemat|tablecloth|napkin|\mplate|\mbowl|\mtray|coaster|carafe|decanter|flute|goblet|pitcher|\mmug|\mcup\M|cups\M|\mshot\M|centrepiece|centerpiece|lampshade|cushion|cake stand|backgammon)' THEN 'HOME'
    WHEN p_name ~* '(bikini|swimsuit|swimwear|\mswim|pareo|cover.?up)' THEN 'SWIMWEAR'
    -- a kaftan is resort-wear only when it lives in a beach line; the same word
    -- in Ceremony Guest / Day-Wear is an evening or day piece.
    WHEN p_name ~* '(kaftan|caftan)' THEN
      CASE WHEN p_collection ~* '(beach|swim|resort)' THEN 'SWIMWEAR' ELSE 'DRESSES' END
    WHEN p_name ~* '(dress|gown|chemisier|abito|bottoncino)' THEN 'DRESSES'
    WHEN p_name ~* '(jumpsuit|playsuit|romper)' THEN 'JUMPSUITS'
    WHEN p_name ~* '(skirt)' THEN 'SKIRTS'
    WHEN p_name ~* '(pants|trouser|shorts|legging|culotte|palazzo|jeans)' THEN 'TROUSERS'
    WHEN p_name ~* '(jacket|blazer|coat|gilet|cape|poncho|trench|mantle|parka|kimono|bomber|puffer|redingote|redingnote|bolero|\mvest\M|cloak)' THEN 'OUTERWEAR'
    WHEN p_name ~* '(sweater|sweather|cardigan|knit|turtleneck|pullover|jumper|twinset|crewneck|crew neck|felpa|sweatshirt|hoodie)' THEN 'KNITWEAR'
    WHEN p_name ~* '(\mtop\M|shirt|blouse|bustier|bodysuit|camisole|\mtank\M|corset|bralette|\mbra\M|\mpolo|\mbody\M)' THEN 'TOPS'
    WHEN p_name ~* '(\mbag\M|bags\M|clutch|pouch|pochette|purse|\mtote|minaudiere|beauty case)' THEN 'BAGS'
    WHEN p_name ~* '(sandal|espadrille|slipper|\mshoe|\mboot|\mmule|\mheel|loafer|mary jane)' THEN 'SHOES'
    WHEN p_name ~* '(belt|scrunchie|veil|scarf|foulard|shawl|stole|\mhat\M|headband|glove|tights|\msock|umbrella|earring|necklace|bracelet|brooch|sunglass|\mlens\M|bandana|turban|beanie|\mhair|card holder|cardholder|phone cover|iphone)' THEN 'ACCESSORIES'
    -- the name didn't say: fall back to the description, then to an
    -- unambiguous collection. Leave NULL rather than guess wrong.
    WHEN p_description ~* '\m(dress|gown)\M'        THEN 'DRESSES'
    WHEN p_description ~* '\m(skirt)\M'             THEN 'SKIRTS'
    WHEN p_description ~* '\m(top|shirt|blouse|bra)\M' THEN 'TOPS'
    WHEN p_collection  ~* 'beach'                   THEN 'SWIMWEAR'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.storefront_fill_category()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS NULL OR btrim(NEW.category) = '' THEN
    NEW.category := public.derive_storefront_category(
      NEW.name, NEW.description, NEW.collection);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storefront_fill_category_trg ON public.storefront_products;
CREATE TRIGGER storefront_fill_category_trg
  BEFORE INSERT OR UPDATE ON public.storefront_products
  FOR EACH ROW EXECUTE FUNCTION public.storefront_fill_category();

-- Backfill what's already there (only the empty ones).
UPDATE public.storefront_products
SET category = public.derive_storefront_category(name, description, collection)
WHERE category IS NULL OR btrim(category) = '';

-- "New arrivals" needs an arrival date, and the table had none: updated_at is
-- bumped on every sync, and id order is ingestion order, not newness. The
-- assistant was answering "our new arrivals" with the highest ids — a claim the
-- data could not support. first_seen_at is stamped once, when a product first
-- appears (the sync upserts and never writes this column, so it survives).
-- Rows that predate this column stay NULL: unknown, not "arrived today".
ALTER TABLE public.storefront_products
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now();

UPDATE public.storefront_products SET first_seen_at = NULL WHERE first_seen_at IS NOT NULL;

COMMENT ON COLUMN public.storefront_products.first_seen_at IS
  'When this product was first seen by the storefront sync. NULL = already in the catalogue before the column existed (unknown arrival date) — never treat NULL as new.';
