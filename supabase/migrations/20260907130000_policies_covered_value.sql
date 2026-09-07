-- Freeze the covered retail value on each policy at sale time.
-- covered_value = LEAST(recommended_retail_price, brand max_covered_value at that time).
-- It is the basis for Chubb Detail_2 and the activation fee; a later change of the
-- brand ceiling must not alter policies already issued (like cogs, insurance_premium, cost_pct).
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS covered_value double precision;
COMMENT ON COLUMN public.policies.covered_value IS 'Retail value (EUR, per unit) actually covered by the program, frozen at sale: LEAST(recommended_retail_price, brand max_covered_value at that time). Basis for Chubb Detail_2 and the activation fee. NULL = derive dynamically.';

-- Keep it populated even for writers that predate the column (old platform builds, manual inserts).
CREATE OR REPLACE FUNCTION public.set_policy_covered_value() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cap double precision;
BEGIN
  IF NEW.recommended_retail_price IS NULL THEN
    RETURN NEW;
  END IF;
  -- app already froze it on insert
  IF TG_OP = 'INSERT' AND NEW.covered_value IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- price unchanged: keep the frozen value
  IF TG_OP = 'UPDATE' AND NEW.recommended_retail_price IS NOT DISTINCT FROM OLD.recommended_retail_price AND NEW.covered_value IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT b.max_covered_value INTO cap FROM public.brands b WHERE b.id = NEW.brand_id;
  NEW.covered_value := LEAST(NEW.recommended_retail_price, COALESCE(cap, 100000));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_policies_covered_value ON public.policies;
CREATE TRIGGER trg_policies_covered_value
  BEFORE INSERT OR UPDATE OF recommended_retail_price, covered_value ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.set_policy_covered_value();

-- Backfill existing policies with the current brand ceiling.
UPDATE public.policies p
SET covered_value = LEAST(p.recommended_retail_price, COALESCE(b.max_covered_value, 100000))
FROM public.brands b
WHERE b.id = p.brand_id AND p.covered_value IS NULL AND p.recommended_retail_price IS NOT NULL;
