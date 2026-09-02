-- Run once in the Supabase SQL editor.
-- Supports the Customer Manager duplicate panel without downloading every customer.
create index if not exists customers_mobile_lookup_idx on public.customers (mobile);

create or replace function public.customer_manager_duplicate_customers(p_limit integer default 20)
returns table (
  customer_id bigint, name text, mobile text, address text,
  gst_number text, state_code text, customer_remark text
)
language sql
security invoker
stable
set search_path = public
as $$
  with normalized_customers as (
    select c.*, regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g') as mobile_key
    from customers c
  ), duplicate_mobiles as (
    select mobile_key
    from normalized_customers
    where mobile_key <> ''
    group by mobile_key
    having count(*) > 1
    order by max(customer_id) desc
    limit 10
  ), ranked as (
    select c.*, row_number() over (partition by c.mobile_key order by c.customer_id desc) as row_no
    from normalized_customers c
    join duplicate_mobiles d on d.mobile_key = c.mobile_key
  )
  select customer_id, name, mobile, address, gst_number, state_code, customer_remark
  from ranked
  where row_no <= 2
  order by customer_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 20));
$$;

revoke all on function public.customer_manager_duplicate_customers(integer) from public;
grant execute on function public.customer_manager_duplicate_customers(integer) to authenticated;
