-- Add row_id and sub_order_code fields to policies table
ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS row_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_order_code TEXT;
