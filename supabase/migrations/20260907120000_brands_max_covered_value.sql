-- Per-brand coverage ceiling (retail price, per unit). Items above it are covered only
-- up to this amount: COGS, premium, activation fee and Chubb Detail_2/Detail_3 are
-- computed on the covered value (see policy ROCIT0000000761, EUR 480k retail -> 100k covered).
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS max_covered_value double precision NOT NULL DEFAULT 100000; COMMENT ON COLUMN public.brands.max_covered_value IS 'Max retail value (EUR, per unit) covered by the program. Items priced above are covered only up to this amount: COGS, premium, activation fee and Chubb Detail_2/Detail_3 are computed on the covered value.';
