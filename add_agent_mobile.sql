-- Run once in the Supabase SQL editor before deploying the updated newsoq.html.
-- The billing page stores the selected agent contact on every supported header.
alter table if exists public.sales_details
    add column if not exists agent_mobile text;

alter table if exists public.sales_order_details
    add column if not exists agent_mobile text;

alter table if exists public.quotation_details
    add column if not exists agent_mobile text;

alter table if exists public.sales_packing_details
    add column if not exists agent_mobile text;

create index if not exists sales_details_agent_mobile_idx
    on public.sales_details (agent_mobile);
