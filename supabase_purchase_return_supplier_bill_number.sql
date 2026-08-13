-- Run once in the Supabase SQL editor before using the new purchase-return field.
alter table public.purchase_return_details
  add column if not exists supplier_return_bill_number text;

comment on column public.purchase_return_details.supplier_return_bill_number is
  'Credit note number or purchase return bill number issued by the supplier.';
