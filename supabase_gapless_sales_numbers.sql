-- Prevent failed sales-header inserts from consuming bill numbers.
-- Run this migration in the Supabase SQL editor before deploying newsoq.html.

begin;

-- This is a preview only. The authoritative number is assigned by the trigger
-- below while the sales_details row is being inserted.
create or replace function public.peek_next_sales_number(p_series text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(max(s.sales_number::bigint), 0) + 1
    from public.sales_details s
    where s.series_code = p_series;
$$;

create or replace function public.assign_sales_number_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_next bigint;
begin
    if new.series_code is null or btrim(new.series_code) = '' then
        raise exception 'A bill series is required';
    end if;

    -- Serialize allocation per series. Because this is a transaction-level
    -- lock, a failed INSERT rolls back without consuming the number.
    perform pg_advisory_xact_lock(
        hashtextextended('sales-number:' || new.series_code, 0)
    );

    select coalesce(max(s.sales_number::bigint), 0) + 1
      into v_next
      from public.sales_details s
     where s.series_code = new.series_code;

    new.sales_number := v_next;
    new.invoice_number := v_next;
    return new;
end;
$$;

drop trigger if exists assign_sales_number_before_insert
    on public.sales_details;

create trigger assign_sales_number_before_insert
before insert on public.sales_details
for each row
execute function public.assign_sales_number_on_insert();

-- Backstop against duplicate numbers from any other writer. Existing gaps are
-- intentionally retained; reusing issued/skipped numbers would be unsafe.
create unique index if not exists sales_details_series_sales_number_uidx
    on public.sales_details (series_code, sales_number);

revoke all on function public.peek_next_sales_number(text) from public;
grant execute on function public.peek_next_sales_number(text)
    to authenticated, anon;

commit;
