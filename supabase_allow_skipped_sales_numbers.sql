-- Allow sales.html to fill a genuinely unused/skipped bill number.
-- Normal sales continue to send the automatically allocated number.
begin;

create or replace function public.assign_sales_number_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_next bigint;
    v_requested bigint;
begin
    if new.series_code is null or btrim(new.series_code) = '' then
        raise exception 'A bill series is required';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended('sales-number:' || new.series_code, 0)
    );

    select coalesce(max(s.sales_number::bigint), 0) + 1
      into v_next
      from public.sales_details s
     where s.series_code = new.series_code;

    -- A supplied number is intentional (automatic or skipped-bill mode).
    -- Generate a number only for callers that leave it empty.
    if new.sales_number is null or btrim(new.sales_number::text) = '' then
        new.sales_number := v_next;
    else
        begin
            v_requested := new.sales_number::bigint;
        exception when others then
            raise exception 'Bill number must be a positive whole number';
        end;

        if v_requested < 1 then
            raise exception 'Bill number must be a positive whole number';
        end if;

        if exists (
            select 1
              from public.sales_details s
             where s.series_code = new.series_code
               and s.sales_number::bigint = v_requested
        ) then
            raise exception 'Bill number % already exists in series %', v_requested, new.series_code;
        end if;

        new.sales_number := v_requested;
    end if;

    new.invoice_number := new.sales_number;
    return new;
end;
$$;

drop trigger if exists assign_sales_number_before_insert on public.sales_details;
create trigger assign_sales_number_before_insert
before insert on public.sales_details
for each row
execute function public.assign_sales_number_on_insert();

create unique index if not exists sales_details_series_sales_number_uidx
    on public.sales_details (series_code, sales_number);

commit;
