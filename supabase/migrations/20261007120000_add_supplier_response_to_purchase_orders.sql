ALTER TABLE public.purchase_order_details
ADD COLUMN IF NOT EXISTS supplier_response text;