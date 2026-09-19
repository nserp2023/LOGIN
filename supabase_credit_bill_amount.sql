-- Preserve the original bill amount for VAJRA credit accounts.
-- Run this once in the Supabase SQL editor.

alter table public.sales_details
  add column if not exists credit_bill_amount numeric;

-- Existing rows can only be seeded from their current stored bill amount.
update public.sales_details
set credit_bill_amount = invoice_amount
where upper(trim(coalesce(salesman, ''))) = 'VAJRA'
  and credit_bill_amount is null;

create or replace function public.preserve_vajra_credit_bill_amount()
returns trigger
language plpgsql
as $$
begin
  if upper(trim(coalesce(new.salesman, ''))) = 'VAJRA'
     and new.credit_bill_amount is null then
    new.credit_bill_amount := case
      when tg_op = 'UPDATE' then old.invoice_amount
      else new.invoice_amount
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preserve_vajra_credit_bill_amount on public.sales_details;
create trigger trg_preserve_vajra_credit_bill_amount
before insert or update of salesman, invoice_amount on public.sales_details
for each row
execute function public.preserve_vajra_credit_bill_amount();
