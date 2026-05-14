-- Drop unused policies.row_id and policies.sub_order_code.
-- Added by 20260317000002 but never written or read anywhere in the codebase;
-- the canonical columns are brand_row_id and brand_sub_order_row_code.
ALTER TABLE public.policies
  DROP COLUMN IF EXISTS row_id,
  DROP COLUMN IF EXISTS sub_order_code;
