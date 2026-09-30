-- Persist customer identity on cash transactions so credit balances do not
-- depend on a mutable customer name. Run once in the Supabase SQL editor.

begin;

alter table public.cash_transactions
  add column if not exists customer_mobile text;

create index if not exists cash_transactions_customer_mobile_idx
  on public.cash_transactions (customer_mobile);

-- Recover mobiles from sales bills and sales-order headers referenced by
-- automatically-created receipts.
update public.cash_transactions as ct
set customer_mobile = nullif(right(regexp_replace(coalesce(sale.customer_mobile, ''), '[^0-9]', '', 'g'), 10), '')
from public.sales_details as sale
where ct.customer_mobile is null
  and ct.reference_id = sale.id
  and ct.reference_type in ('sales_credit', 'sales_pack_credit', 'sales_order_conversion_receipt')
  and nullif(right(regexp_replace(coalesce(sale.customer_mobile, ''), '[^0-9]', '', 'g'), 10), '') is not null;

update public.cash_transactions as ct
set customer_mobile = nullif(right(regexp_replace(coalesce(sales_order.customer_mobile, ''), '[^0-9]', '', 'g'), 10), '')
from public.sales_order_details as sales_order
where ct.customer_mobile is null
  and ct.reference_id = sales_order.id
  and ct.reference_type in ('sales_order', 'sales_order_advance', 'sales_order_advance_receipt')
  and nullif(right(regexp_replace(coalesce(sales_order.customer_mobile, ''), '[^0-9]', '', 'g'), 10), '') is not null;

update public.cash_transactions
set customer_mobile = right(regexp_replace(party_name, '[^0-9]', '', 'g'), 10)
where customer_mobile is null
  and party_name ~ '^[+0-9() .-]{10,18}$'
  and length(regexp_replace(party_name, '[^0-9]', '', 'g')) >= 10;

-- Backfill name-only historical transactions only where the name identifies
-- exactly one mobile number across customer, sales, and order records.
with customer_names as (
  select lower(trim(name)) as normalized_name,
         right(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), 10) as mobile
  from public.customers
  where nullif(trim(name), '') is not null
  union all
  select lower(trim(customer_name)),
         right(regexp_replace(coalesce(customer_mobile, ''), '[^0-9]', '', 'g'), 10)
  from public.sales_details
  where nullif(trim(customer_name), '') is not null
  union all
  select lower(trim(customer_name)),
         right(regexp_replace(coalesce(customer_mobile, ''), '[^0-9]', '', 'g'), 10)
  from public.sales_order_details
  where nullif(trim(customer_name), '') is not null
), unique_customer_names as (
  select normalized_name, min(mobile) as mobile
  from customer_names
  where length(mobile) = 10
  group by normalized_name
  having count(distinct mobile) = 1
)
update public.cash_transactions as ct
set customer_mobile = unique_customer_names.mobile
from unique_customer_names
where ct.customer_mobile is null
  and lower(trim(ct.party_name)) = unique_customer_names.normalized_name;

-- Separate overpayment advances point to their parent receipt. Keep the
-- advance row visible, but let balance calculations count the parent amount
-- once and inherit the parent's recovered mobile.
update public.cash_transactions as child_txn
set customer_mobile = parent_txn.customer_mobile
from public.cash_transactions as parent_txn
where child_txn.customer_mobile is null
  and child_txn.reference_type = 'customer_advance'
  and child_txn.reference_id = parent_txn.id
  and parent_txn.customer_mobile is not null;

commit;
