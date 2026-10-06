


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."apply_purchase_to_po_items"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_remaining numeric(12,2);
  v_po_item record;
  v_take numeric(12,2);
begin
  v_remaining := coalesce(new.quantity, 0);

  if v_remaining <= 0 then
    return new;
  end if;

  for v_po_item in
    select
      poi.id,
      poi.purchase_order_id,
      poi.quantity,
      poi.received_qty
    from public.purchase_order_item_details poi
    join public.purchase_order_details po
      on po.id = poi.purchase_order_id
    where coalesce(po.is_cancelled,false) = false
      and coalesce(poi.received_qty,0) < coalesce(poi.quantity,0)
      and (
        (coalesce(new.item_code,'') <> '' and poi.item_code = new.item_code)
        or
        (coalesce(new.item_code,'') = '' and upper(coalesce(poi.item_name,'')) = upper(coalesce(new.item_name,'')))
      )
    order by po.order_date asc, poi.id asc
  loop
    exit when v_remaining <= 0;

    v_take := least(
      v_remaining,
      greatest(coalesce(v_po_item.quantity,0) - coalesce(v_po_item.received_qty,0), 0)
    );

    if v_take > 0 then
      update public.purchase_order_item_details
      set received_qty = coalesce(received_qty,0) + v_take
      where id = v_po_item.id;

      perform public.refresh_purchase_order_status(v_po_item.purchase_order_id);

      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."apply_purchase_to_po_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_sales_number_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."assign_sales_number_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_purchase_order"("p_po_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.purchase_order_details
  set
    is_cancelled = true,
    cancelled_at = now(),
    status = 'CANCELLED'
  where id = p_po_id;

  update public.purchase_order_item_details
  set status = 'CANCELLED'
  where purchase_order_id = p_po_id;
end;
$$;


ALTER FUNCTION "public"."cancel_purchase_order"("p_po_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update bill_edit_grants set used_at=now(), used_sale_id=p_sale_id
  where id=p_grant_id and user_id=auth.uid() and used_at is null
    and exists (select 1 from get_bill_edit_grant(p_sale_id) x where x.grant_id=p_grant_id);
  return found;
end; $$;


ALTER FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cash_transactions" (
    "id" bigint NOT NULL,
    "voucher_no" "text" NOT NULL,
    "txn_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "txn_type" "text" NOT NULL,
    "party_id" bigint,
    "party_name" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "text",
    "approved_at" timestamp with time zone,
    "approval_note" "text",
    "reference_id" bigint,
    "reference_type" "text",
    "is_checked" boolean DEFAULT false,
    "customer_mobile" "text",
    CONSTRAINT "cash_transactions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "cash_transactions_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "cash_transactions_txn_type_check" CHECK (("txn_type" = ANY (ARRAY['payment'::"text", 'receipt'::"text"])))
);


ALTER TABLE "public"."cash_transactions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_cash_transaction_safe"("p_txn_type" "text", "p_txn_date" "date", "p_party_id" bigint, "p_party_name" "text", "p_amount" numeric, "p_remarks" "text", "p_approval_status" "text", "p_reference_type" "text") RETURNS "public"."cash_transactions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_prefix text;
    v_next integer;
    v_voucher text;
    v_row public.cash_transactions;
    v_try integer := 0;
begin
    if p_txn_type not in ('payment', 'receipt') then
        raise exception 'Invalid transaction type: %', p_txn_type;
    end if;

    if p_approval_status not in ('pending', 'approved', 'rejected') then
        raise exception 'Invalid approval status: %', p_approval_status;
    end if;

    if p_party_name is null or length(trim(p_party_name)) = 0 then
        raise exception 'Party name is required';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'Amount must be greater than zero';
    end if;

    v_prefix := case when p_txn_type = 'payment' then 'PAY' else 'REC' end;

    loop
        update public.cash_voucher_counters
        set last_no = last_no + 1,
            updated_at = now()
        where txn_type = p_txn_type
        returning last_no into v_next;

        if v_next is null then
            insert into public.cash_voucher_counters (txn_type, last_no)
            values (p_txn_type, 0)
            on conflict (txn_type) do nothing;
            continue;
        end if;

        v_voucher := v_prefix || '-' || lpad(v_next::text, 4, '0');

        begin
            insert into public.cash_transactions (
                voucher_no,
                txn_date,
                txn_type,
                party_id,
                party_name,
                amount,
                remarks,
                approval_status,
                reference_type
            ) values (
                v_voucher,
                coalesce(p_txn_date, current_date),
                p_txn_type,
                p_party_id,
                trim(p_party_name),
                p_amount,
                nullif(trim(coalesce(p_remarks, '')), ''),
                p_approval_status,
                p_reference_type
            )
            returning * into v_row;

            return v_row;

        exception when unique_violation then
            v_try := v_try + 1;
            if v_try > 100 then
                raise exception 'Could not create unique voucher after many attempts';
            end if;
        end;
    end loop;
end;
$$;


ALTER FUNCTION "public"."create_cash_transaction_safe"("p_txn_type" "text", "p_txn_date" "date", "p_party_id" bigint, "p_party_name" "text", "p_amount" numeric, "p_remarks" "text", "p_approval_status" "text", "p_reference_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer DEFAULT 20) RETURNS TABLE("customer_id" bigint, "name" "text", "mobile" "text", "address" "text", "gst_number" "text", "state_code" "text", "customer_remark" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrease_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
    update public.stock_items
    set quantity = coalesce(quantity, 0) - p_qty
    where item_code = p_item_code;

    insert into public.stock_ledger(
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id,
        created_at
    )
    values(
        p_item_code,
        'SALES_RETURN_EDIT_REVERSE',
        0,
        p_qty,
        p_reference_id,
        now()
    );
end;
$$;


ALTER FUNCTION "public"."decrease_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update stock_items
  set quantity = quantity - new.quantity
  where item_code = new.item_code;

  return new;
end;
$$;


ALTER FUNCTION "public"."deduct_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
    update stock_items
    set quantity = quantity - p_qty
    where item_code = p_item_code;
end;
$$;


ALTER FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into stock_ledger(
      item_code,
      txn_type,
      qty_in,
      qty_out,
      reference_id
  )
  values(
      p_item_code,
      p_txn_type,
      0,
      p_qty,
      p_reference_id
  );
end;
$$;


ALTER FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_stock_quantity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update stock_items
  set quantity = coalesce(quantity,0) - new.quantity
  where item_code = new.item_code;

  return new;
end;
$$;


ALTER FUNCTION "public"."deduct_stock_quantity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_po_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
    next_no bigint;
begin
    next_no := nextval('purchase_order_no_seq');

    return 'PO-' || lpad(next_no::text, 6, '0');
end;
$$;


ALTER FUNCTION "public"."generate_po_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) RETURNS TABLE("allowed" boolean, "grant_id" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select true, g.id from sales_details s join bill_edit_grants g on g.user_id=auth.uid() and g.used_at is null
  where s.id=p_sale_id and (
    (g.grant_type in ('single','bill_range') and (g.series_code is null or g.series_code=s.series_code)
      and s.sales_number::bigint between g.bill_from and g.bill_to)
    or (g.grant_type='date_range' and s.bill_date between g.date_from and g.date_to)
    or (g.grant_type='month' and to_char(s.bill_date,'YYYY-MM')=g.month_value)
  ) order by g.created_at limit 1;
$$;


ALTER FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bulk_sales_bills"("p_from_date" "date", "p_to_date" "date", "p_salesman" "text") RETURNS TABLE("sales_id" bigint, "sales_number" bigint, "series_code" "text", "bill_date" "date", "customer_name" "text", "customer_mobile" "text", "address" "text", "salesman" "text", "item_id" bigint, "item_code" "text", "item_name" "text", "quantity" numeric, "price" numeric, "gst_percent" numeric, "hsn_code" "text", "balance_qty" numeric, "landing" numeric, "price1" numeric, "price1_gst" numeric, "price2" numeric, "price2_gst" numeric, "price3" numeric, "price3_gst" numeric)
    LANGUAGE "sql"
    AS $$
  select
    sd.id as sales_id,
    sd.sales_number,
    sd.series_code,
    sd.bill_date,
    sd.customer_name,
    sd.customer_mobile,
    sd.address,
    sd.salesman,
    sid.id as item_id,
    sid.item_code,
    sid.item_name,
    coalesce(sid.quantity, 0) as quantity,
    coalesce(sid.price, 0) as price,
    coalesce(sid.gst_percent, 0) as gst_percent,
    sid.hsn_code,
    coalesce(sbv.balance, 0) as balance_qty,
    coalesce(si.landing, 0) as landing,
    coalesce(si.price1, 0) as price1,
    coalesce(si.price1_gst, 0) as price1_gst,
    coalesce(si.price2, 0) as price2,
    coalesce(si.price2_gst, 0) as price2_gst,
    coalesce(si.price3, 0) as price3,
    coalesce(si.price3_gst, 0) as price3_gst
  from public.sales_details sd
  join public.sales_item_details sid
    on sid.sales_id = sd.id
  left join public.stock_items si
    on si.item_code = sid.item_code
  left join public.stock_balance_view sbv
    on sbv.item_code = sid.item_code
  where sd.bill_date between p_from_date and p_to_date
    and (
      p_salesman is null
      or p_salesman = ''
      or upper(coalesce(sd.salesman, '')) = upper(p_salesman)
    )
  order by sd.bill_date, sd.sales_number, sid.id;
$$;


ALTER FUNCTION "public"."get_bulk_sales_bills"("p_from_date" "date", "p_to_date" "date", "p_salesman" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_quotation_number"("p_series" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
    next_no integer;
begin
    update quotation_series
    set quotation_number = quotation_number + 1
    where series_code = p_series
    returning quotation_number into next_no;

    return next_no;
end;
$$;


ALTER FUNCTION "public"."get_next_quotation_number"("p_series" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_sales_number"() RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
declare
    new_number bigint;
begin
    select coalesce(max(sales_number), 0) + 1
    into new_number
    from sales_details;

    return new_number;
end;
$$;


ALTER FUNCTION "public"."get_next_sales_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_sales_number"("p_series" "text") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
declare
    new_number bigint;
begin
    update bill_series
    set bill_number = bill_number + 1
    where series_code = p_series
    returning bill_number into new_number;

    return new_number;
end;
$$;


ALTER FUNCTION "public"."get_next_sales_number"("p_series" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_sales_order_number"("p_series" "text") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
declare next_no bigint;
begin
  update bill_series
  set sales_order_number = coalesce(sales_order_number,0) + 1
  where series_code = p_series
  returning sales_order_number into next_no;

  return next_no;
end;
$$;


ALTER FUNCTION "public"."get_next_sales_order_number"("p_series" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_sales_return_number"() RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
declare next_no bigint;
begin
  select coalesce(max(return_number),0)+1
  into next_no
  from sales_return_details;

  return next_no;
end;
$$;


ALTER FUNCTION "public"."get_next_sales_return_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_table_names"() RETURNS TABLE("table_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  select tablename::text as table_name
  from pg_tables
  where schemaname = 'public'
    and tablename not like 'pg_%'
    and tablename not like 'sql_%'
  order by tablename;
$$;


ALTER FUNCTION "public"."get_public_table_names"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_today_dashboard_sales_split"() RETURNS TABLE("today_cash_sales" numeric, "today_credit_sales" numeric)
    LANGUAGE "sql"
    AS $$
  select
    coalesce(sum(
      case
        when upper(coalesce(payment_type, 'CASH')) like 'CASH%'
        then coalesce(payable, invoice_amount, 0)
        else 0
      end
    ), 0) as today_cash_sales,
    coalesce(sum(
      case
        when upper(coalesce(payment_type, 'CASH')) like 'CREDIT%'
        then coalesce(payable, invoice_amount, 0)
        else 0
      end
    ), 0) as today_credit_sales
  from public.sales_details
  where bill_date = current_date;
$$;


ALTER FUNCTION "public"."get_today_dashboard_sales_split"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_today_dashboard_summary"() RETURNS TABLE("today_cash_sales" numeric, "today_credit_sales" numeric, "today_receipt" numeric, "today_sales_return" numeric, "today_payment" numeric, "pending_payments" bigint, "pending_returns" bigint, "today_balance" numeric)
    LANGUAGE "plpgsql"
    AS $$
declare
  v_today date := current_date;
  v_cash_sales numeric := 0;
  v_credit_sales numeric := 0;
  v_receipt numeric := 0;
  v_sales_return numeric := 0;
  v_payment numeric := 0;
  v_pending_payments bigint := 0;
  v_pending_returns bigint := 0;
begin
  -- CASH SALES ONLY
  select coalesce(sum(coalesce(payable, invoice_amount, 0)), 0)
  into v_cash_sales
  from public.sales_details
  where bill_date = v_today
    and upper(coalesce(payment_type, 'CASH')) like 'CASH%';

  -- CREDIT SALES ONLY
  select coalesce(sum(coalesce(payable, invoice_amount, 0)), 0)
  into v_credit_sales
  from public.sales_details
  where bill_date = v_today
    and upper(coalesce(payment_type, '')) like 'CREDIT%';

  -- RECEIPTS
  select coalesce(sum(coalesce(amount, 0)), 0)
  into v_receipt
  from public.cash_transactions
  where txn_date = v_today
    and lower(coalesce(txn_type, '')) = 'receipt'
    and (
      approval_status is null
      or trim(approval_status) = ''
      or lower(approval_status) = 'approved'
    );

  -- PAYMENTS
  select coalesce(sum(coalesce(amount, 0)), 0)
  into v_payment
  from public.cash_transactions
  where txn_date = v_today
    and lower(coalesce(txn_type, '')) = 'payment'
    and lower(coalesce(approval_status, 'pending')) = 'approved';

  -- SALES RETURN
  select coalesce(sum(coalesce(total_return_amount, 0)), 0)
  into v_sales_return
  from public.sales_return_details
  where coalesce(is_accepted, false) = true
    and return_date::date = v_today;

  -- PENDING PAYMENTS
  select count(*)
  into v_pending_payments
  from public.cash_transactions
  where lower(coalesce(txn_type, '')) = 'payment'
    and lower(coalesce(approval_status, 'pending')) = 'pending';

  -- PENDING RETURNS
  select count(*)
  into v_pending_returns
  from public.sales_return_details
  where coalesce(is_accepted, false) = false;

  return query
  select
    v_cash_sales,
    v_credit_sales,
    v_receipt,
    v_sales_return,
    v_payment,
    v_pending_payments,
    v_pending_returns,
    (v_cash_sales + v_receipt - v_sales_return - v_payment);
end;
$$;


ALTER FUNCTION "public"."get_today_dashboard_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  user_count int;
begin
  select count(*) into user_count from public.user_profiles;

  insert into public.user_profiles (
    id,
    email,
    full_name,
    role,
    approved
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case 
      when user_count = 0 then 'OWNER'
      else 'PENDING'
    end,
    case 
      when user_count = 0 then true
      else false
    end
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_sales_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    update stock_items
    set quantity = quantity - new.quantity
    where item_code = new.item_code;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update stock_items
    set quantity = quantity + old.quantity
    where item_code = old.item_code;
    return old;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."handle_sales_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
    update public.stock_items
    set quantity = coalesce(quantity, 0) + p_qty
    where item_code = p_item_code;

    insert into public.stock_ledger(
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id,
        created_at
    )
    values(
        p_item_code,
        'SALES RETURN',
        p_qty,
        0,
        p_reference_id,
        now()
    );
end;
$$;


ALTER FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into stock_ledger(
      item_code,
      txn_type,
      qty_in,
      qty_out,
      reference_id
  )
  values(
      p_item_code,
      p_txn_type,
      p_qty,
      0,
      p_reference_id
  );
end;
$$;


ALTER FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_bill_number"("series_code_input" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  new_number integer;
begin
  update bill_counters
  set current_number = current_number + 1
  where series_code = series_code_input
  returning current_number into new_number;

  return new_number;
end;
$$;


ALTER FUNCTION "public"."increment_bill_number"("series_code_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."opening_stock_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into stock_ledger (
      item_code,
      txn_type,
      qty_in,
      qty_out,
      reference_id
  )
  values (
      new.item_code,
      'OPENING',
      new.quantity,
      0,
      0
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."opening_stock_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."peek_next_sales_number"("p_series" "text") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select coalesce(max(s.sales_number::bigint), 0) + 1
    from public.sales_details s
    where s.series_code = p_series;
$$;


ALTER FUNCTION "public"."peek_next_sales_number"("p_series" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preserve_vajra_credit_bill_amount"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."preserve_vajra_credit_bill_amount"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_return_stock_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.stock_ledger (
      item_code,
      qty_in,
      qty_out,
      txn_type,
      reference_id,
      created_at
    )
    values (
      new.item_code,
      0,
      coalesce(new.quantity, 0),
      'PURCHASE_RETURN',
      new.purchase_return_id,
      now()
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.stock_ledger (
      item_code,
      qty_in,
      qty_out,
      txn_type,
      reference_id,
      created_at
    )
    values (
      old.item_code,
      coalesce(old.quantity, 0),
      0,
      'PURCHASE_RETURN_DELETE',
      old.purchase_return_id,
      now()
    );
    return old;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."purchase_return_stock_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_stock_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if tg_op = 'INSERT' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            new.item_code,
            new.quantity,
            0,
            'PURCHASE',
            new.purchase_id,
            now()
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            old.item_code,
            0,
            old.quantity,
            'PURCHASE_EDIT_REVERSAL',
            old.purchase_id,
            now()
        );

        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            new.item_code,
            new.quantity,
            0,
            'PURCHASE_EDIT',
            new.purchase_id,
            now()
        );

        return new;
    end if;

    if tg_op = 'DELETE' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            old.item_code,
            0,
            old.quantity,
            'PURCHASE_DELETE_REVERSAL',
            old.purchase_id,
            now()
        );

        return old;
    end if;

    return null;
end;
$$;


ALTER FUNCTION "public"."purchase_stock_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_stock_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into stock_items (item_code, quantity)
  values (new.item_code, new.quantity)
  on conflict (item_code)
  do update set quantity = stock_items.quantity + new.quantity;

  return new;
end;
$$;


ALTER FUNCTION "public"."purchase_stock_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_purchase_order_status"("p_po_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_total_items int := 0;
  v_received_items int := 0;
  v_partial_items int := 0;
  v_cancelled boolean := false;
begin
  select coalesce(is_cancelled, false)
  into v_cancelled
  from public.purchase_order_details
  where id = p_po_id;

  if v_cancelled then
    update public.purchase_order_details
    set status = 'CANCELLED'
    where id = p_po_id;
    return;
  end if;

  update public.purchase_order_item_details
  set status =
    case
      when coalesce(received_qty,0) <= 0 then 'PENDING'
      when coalesce(received_qty,0) < coalesce(quantity,0) then 'PARTIAL'
      else 'RECEIVED'
    end
  where purchase_order_id = p_po_id;

  select count(*),
         count(*) filter (where status = 'RECEIVED'),
         count(*) filter (where status = 'PARTIAL')
  into v_total_items, v_received_items, v_partial_items
  from public.purchase_order_item_details
  where purchase_order_id = p_po_id;

  update public.purchase_order_details
  set status =
    case
      when v_total_items = 0 then 'PENDING'
      when v_received_items = v_total_items then 'COMPLETED'
      when v_received_items > 0 or v_partial_items > 0 then 'PARTIAL'
      else 'PENDING'
    end
  where id = p_po_id;
end;
$$;


ALTER FUNCTION "public"."refresh_purchase_order_status"("p_po_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_stock"("p_item_code" "text", "p_qty" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
    update stock_items
    set quantity = quantity + p_qty
    where item_code = p_item_code;
end;
$$;


ALTER FUNCTION "public"."restore_stock"("p_item_code" "text", "p_qty" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_ledger_entry"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into stock_ledger (
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id
    )
    values (
        new.item_code,
        'SALE',
        0,
        new.quantity,
        new.sales_id
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into stock_ledger (
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id
    )
    values (
        old.item_code,
        'SALE_EDIT_REVERSE',
        old.quantity,
        0,
        old.sales_id
    );

    insert into stock_ledger (
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id
    )
    values (
        new.item_code,
        'SALE',
        0,
        new.quantity,
        new.sales_id
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into stock_ledger (
        item_code,
        txn_type,
        qty_in,
        qty_out,
        reference_id
    )
    values (
        old.item_code,
        'SALE_DELETE_REVERSE',
        old.quantity,
        0,
        old.sales_id
    );
    return old;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."sales_ledger_entry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_stock_ledger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if tg_op = 'INSERT' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            new.item_code,
            0,
            new.quantity,
            'SALE',
            new.sales_id,
            now()
        );
        return new;
    end if;

    if tg_op = 'UPDATE' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            old.item_code,
            old.quantity,
            0,
            'SALE_EDIT_REVERSAL',
            old.sales_id,
            now()
        );

        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            new.item_code,
            0,
            new.quantity,
            'SALE_EDIT',
            new.sales_id,
            now()
        );

        return new;
    end if;

    if tg_op = 'DELETE' then
        insert into stock_ledger (
            item_code,
            qty_in,
            qty_out,
            txn_type,
            reference_id,
            created_at
        )
        values (
            old.item_code,
            old.quantity,
            0,
            'SALE_DELETE_REVERSAL',
            old.sales_id,
            now()
        );

        return old;
    end if;

    return null;
end;
$$;


ALTER FUNCTION "public"."sales_stock_ledger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sales_stock_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update stock_items
  set quantity = quantity - new.quantity
  where item_code = new.item_code;

  return new;
end;
$$;


ALTER FUNCTION "public"."sales_stock_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_bulk_sales_edit"("p_bills" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_bill jsonb;
  v_item jsonb;
  v_sales_id bigint;
  v_saved_bills int := 0;
  v_skipped_bills int := 0;
begin
  for v_bill in
    select * from jsonb_array_elements(p_bills)
  loop
    v_sales_id := (v_bill->>'sales_id')::bigint;

    if v_bill->'items' is null or jsonb_array_length(v_bill->'items') = 0 then
      v_skipped_bills := v_skipped_bills + 1;
      continue;
    end if;

    -- remove old stock effect for this sales bill
    delete from public.stock_ledger
    where reference_id = v_sales_id
      and upper(coalesce(txn_type, '')) = 'SALE';

    -- remove old item rows
    delete from public.sales_item_details
    where sales_id = v_sales_id;

    -- insert only rows with qty > 0
    for v_item in
      select * from jsonb_array_elements(v_bill->'items')
    loop
      if coalesce((v_item->>'quantity')::numeric, 0) > 0 then
        insert into public.sales_item_details (
          sales_id,
          item_code,
          item_name,
          quantity,
          price,
          gst_percent,
          hsn_code
        )
        values (
          v_sales_id,
          v_item->>'item_code',
          v_item->>'item_name',
          coalesce((v_item->>'quantity')::numeric, 0),
          coalesce((v_item->>'price')::numeric, 0),
          coalesce((v_item->>'gst_percent')::numeric, 0),
          v_item->>'hsn_code'
        );
      end if;
    end loop;

    -- rebuild stock ledger
    insert into public.stock_ledger (
      item_code,
      txn_type,
      qty_in,
      qty_out,
      reference_id,
      created_at
    )
    select
      sid.item_code,
      'SALE',
      0,
      sid.quantity,
      sid.sales_id,
      now()
    from public.sales_item_details sid
    where sid.sales_id = v_sales_id
      and coalesce(sid.quantity, 0) > 0;

    -- update bill totals
    update public.sales_details sd
    set
      invoice_amount = x.invoice_amount,
      payable = x.payable
    from (
      select
        sales_id,
        coalesce(sum(coalesce(quantity,0) * coalesce(price,0)), 0) as invoice_amount,
        coalesce(sum(coalesce(quantity,0) * coalesce(price,0)), 0) as payable
      from public.sales_item_details
      where sales_id = v_sales_id
      group by sales_id
    ) x
    where sd.id = x.sales_id;

    v_saved_bills := v_saved_bills + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'saved_bills', v_saved_bills,
    'skipped_bills', v_skipped_bills,
    'message', 'Saved ' || v_saved_bills || ' bill(s). Skipped ' || v_skipped_bills || ' empty bill(s).'
  );
end;
$$;


ALTER FUNCTION "public"."save_bulk_sales_edit"("p_bills" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_cash_closing" (
    "id" bigint NOT NULL,
    "closing_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "closing_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "closing_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "system_expected_cash" numeric DEFAULT 0,
    "shift_no" integer,
    "remaining_cash" numeric DEFAULT 0,
    "staff_name" "text"
);


ALTER TABLE "public"."daily_cash_closing" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_daily_cash_closing"("p_closing_amount" numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "public"."daily_cash_closing"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.daily_cash_closing;
begin
  insert into public.daily_cash_closing (
    closing_date,
    closing_time,
    user_id,
    closing_amount,
    notes
  )
  values (
    current_date,
    now(),
    auth.uid(),
    coalesce(p_closing_amount, 0),
    p_notes
  )
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."save_daily_cash_closing"("p_closing_amount" numeric, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_purchase_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
    new_number text;
begin
    new_number := 'PN-' || to_char(current_date, 'YYYYMMDD') || '-' || nextval('purchase_number_seq');
    new.purchase_number := new_number;
    return new;
end;
$$;


ALTER FUNCTION "public"."set_purchase_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_stock_from_purchase_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  delta numeric;
begin
  if tg_op = 'INSERT' then
    delta := new.quantity;
    insert into stock_items (item_code, quantity)
    values (new.item_code, delta)
    on conflict (item_code) do update
      set quantity = stock_items.quantity + excluded.quantity;
    return new;
  elsif tg_op = 'DELETE' then
    delta := coalesce(old.quantity, 0);
    update stock_items
    set quantity = greatest(coalesce(quantity,0) - delta, 0)
    where item_code = old.item_code;
    return old;
  elsif tg_op = 'UPDATE' then
    delta := coalesce(new.quantity,0) - coalesce(old.quantity,0);
    if delta = 0 and new.item_code = old.item_code then
      return new;
    end if;

    if new.item_code <> old.item_code then
      update stock_items
      set quantity = greatest(coalesce(quantity,0) - coalesce(old.quantity,0), 0)
      where item_code = old.item_code;

      insert into stock_items (item_code, quantity)
      values (new.item_code, coalesce(new.quantity,0))
      on conflict (item_code) do update
        set quantity = stock_items.quantity + excluded.quantity;
    else
      if delta > 0 then
        insert into stock_items (item_code, quantity)
        values (new.item_code, delta)
        on conflict (item_code) do update
          set quantity = stock_items.quantity + excluded.quantity;
      else
        update stock_items
        set quantity = greatest(coalesce(quantity,0) + delta, 0)
        where item_code = new.item_code;
      end if;
    end if;

    return new;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."trg_sync_stock_from_purchase_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_stock_quantity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update stock_items
  set quantity = coalesce(quantity,0) + new.quantity
  where item_code = new.item_code;

  if not found then
    insert into stock_items (
      hsn_code, item_code, item_name, quantity, price, discount_percent,
      purchase_price, purchase_price_gst, landing,
      price1_percent, price1, price1_gst,
      price2_percent, price2, price2_gst,
      price3_percent, price3, price3_gst
    )
    values (
      new.hsn_code, new.item_code, new.item_name, new.quantity, new.price, new.discount_percent,
      new.purchase_price, new.purchase_price_gst, new.landing,
      new.price1_percent, new.price1, new.price1_gst,
      new.price2_percent, new.price2, new.price2_gst,
      new.price3_percent, new.price3, new.price3_gst
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."update_stock_quantity"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_counters" (
    "series_code" "text" NOT NULL,
    "current_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."bill_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_edit_grants" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "granted_by" "uuid" NOT NULL,
    "grant_type" "text" NOT NULL,
    "series_code" "text",
    "bill_from" bigint,
    "bill_to" bigint,
    "date_from" "date",
    "date_to" "date",
    "month_value" "text",
    "used_at" timestamp with time zone,
    "used_sale_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bill_edit_grants_check" CHECK ((("bill_from" IS NULL) OR ("bill_to" IS NULL) OR ("bill_from" <= "bill_to"))),
    CONSTRAINT "bill_edit_grants_check1" CHECK ((("date_from" IS NULL) OR ("date_to" IS NULL) OR ("date_from" <= "date_to"))),
    CONSTRAINT "bill_edit_grants_grant_type_check" CHECK (("grant_type" = ANY (ARRAY['single'::"text", 'bill_range'::"text", 'date_range'::"text", 'month'::"text"]))),
    CONSTRAINT "bill_edit_grants_month_value_check" CHECK ((("month_value" IS NULL) OR ("month_value" ~ '^[0-9]{4}-[0-9]{2}$'::"text")))
);


ALTER TABLE "public"."bill_edit_grants" OWNER TO "postgres";


ALTER TABLE "public"."bill_edit_grants" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."bill_edit_grants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bill_series" (
    "id" integer NOT NULL,
    "series_code" "text" NOT NULL,
    "bill_number" numeric,
    "sales_order_number" bigint DEFAULT 0
);


ALTER TABLE "public"."bill_series" OWNER TO "postgres";


ALTER TABLE "public"."bill_series" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."bill_series_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."cash_transactions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cash_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cash_voucher_counters" (
    "txn_type" "text" NOT NULL,
    "last_no" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "cash_voucher_counters_txn_type_check" CHECK (("txn_type" = ANY (ARRAY['payment'::"text", 'receipt'::"text"])))
);


ALTER TABLE "public"."cash_voucher_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_note_items" (
    "id" bigint NOT NULL,
    "credit_note_id" bigint,
    "item_id" bigint,
    "qty" numeric,
    "rate" numeric,
    "gst_percent" numeric,
    "amount" numeric
);


ALTER TABLE "public"."credit_note_items" OWNER TO "postgres";


ALTER TABLE "public"."credit_note_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."credit_note_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."credit_notes" (
    "id" bigint NOT NULL,
    "credit_note_no" "text",
    "return_date" "date" DEFAULT CURRENT_DATE,
    "customer_id" bigint,
    "original_bill_no" "text",
    "total_amount" numeric,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_notes" OWNER TO "postgres";


ALTER TABLE "public"."credit_notes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."credit_notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."credit_receipt_allocations" (
    "id" bigint NOT NULL,
    "cash_transaction_id" bigint NOT NULL,
    "sales_id" bigint NOT NULL,
    "allocated_amount" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_receipt_allocations" OWNER TO "postgres";


ALTER TABLE "public"."credit_receipt_allocations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."credit_receipt_allocations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."crm_customers" (
    "id" bigint NOT NULL,
    "name" "text",
    "mobile" "text",
    "salesman" "text",
    "address" "text",
    "gst_number" "text",
    "state_code" "text",
    "priority" "text" DEFAULT 'LOW'::"text",
    "next_followup_date" "date",
    "interests" "text"[],
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crm_customers" OWNER TO "postgres";


ALTER TABLE "public"."crm_customers" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."crm_customers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_ledger" (
    "id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "txn_type" "text" NOT NULL,
    "qty_in" numeric DEFAULT 0,
    "qty_out" numeric DEFAULT 0,
    "reference_id" bigint,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "remarks" "text"
);


ALTER TABLE "public"."stock_ledger" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."current_stock" AS
 SELECT "item_code",
    ("sum"("qty_in") - "sum"("qty_out")) AS "available_stock"
   FROM "public"."stock_ledger"
  GROUP BY "item_code";


ALTER VIEW "public"."current_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "customer_id" bigint NOT NULL,
    "createdat" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "name" "text",
    "mobile" "text",
    "address" "text",
    "gst_number" "text",
    "state_code" "text",
    "customer_remark" "text"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers_backup_before_merge" (
    "customer_id" bigint,
    "createdat" timestamp without time zone,
    "name" "text",
    "mobile" "text",
    "address" "text",
    "gst_number" "text",
    "state_code" "text"
);


ALTER TABLE "public"."customers_backup_before_merge" OWNER TO "postgres";


ALTER TABLE "public"."customers" ALTER COLUMN "customer_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."customers_customer_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."daily_cash_closing" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."daily_cash_closing_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."damage_entries" (
    "id" bigint NOT NULL,
    "damage_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "supplier_name" "text",
    "reference_no" "text",
    "reason" "text",
    "remark" "text",
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "resolution_type" "text",
    "resolution_note" "text",
    "solved_at" timestamp with time zone,
    "solved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "damage_entries_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "damage_entries_resolution_type_check" CHECK ((("resolution_type" IS NULL) OR ("resolution_type" = ANY (ARRAY['REPLACEMENT'::"text", 'CREDIT NOTE'::"text", 'SERVICE'::"text", 'OTHER'::"text"])))),
    CONSTRAINT "damage_entries_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'SOLVED'::"text"])))
);


ALTER TABLE "public"."damage_entries" OWNER TO "postgres";


ALTER TABLE "public"."damage_entries" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."damage_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."dashboard_work_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "body" "text" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_name" "text" DEFAULT 'Team member'::"text" NOT NULL,
    "parent_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_work_messages_body_check" CHECK ((("char_length"(TRIM(BOTH FROM "body")) >= 1) AND ("char_length"(TRIM(BOTH FROM "body")) <= 500)))
);


ALTER TABLE "public"."dashboard_work_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hsn_codes" (
    "hsn_id" bigint NOT NULL,
    "hsn_code" "text" NOT NULL,
    "description" "text",
    "gst_percent" numeric(5,2) NOT NULL,
    "cgst_percent" numeric(5,2) NOT NULL,
    "sgst_percent" numeric(5,2) NOT NULL,
    "igst_percent" numeric(5,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."hsn_codes" OWNER TO "postgres";


ALTER TABLE "public"."hsn_codes" ALTER COLUMN "hsn_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."hsn_codes_hsn_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."invoiceitems" (
    "itemid" integer NOT NULL,
    "invoiceid" integer NOT NULL,
    "productname" character varying(100) NOT NULL,
    "quantity" integer NOT NULL,
    "unitprice" numeric(10,2) NOT NULL,
    "price_type" "text",
    "price_with_gst" numeric,
    "gst_percent" numeric,
    "gst_amount" numeric,
    "cgst_percent" numeric,
    "cgst_amount" numeric,
    "sgst_percent" numeric,
    "sgst_amount" numeric
);


ALTER TABLE "public"."invoiceitems" OWNER TO "postgres";


ALTER TABLE "public"."invoiceitems" ALTER COLUMN "itemid" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."invoiceitems_itemid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "invoiceid" integer NOT NULL,
    "customerid" integer,
    "invoicedate" "date" NOT NULL,
    "duedate" "date",
    "totalamount" numeric(10,2) NOT NULL,
    "status" character varying(20) DEFAULT 'Pending'::character varying,
    "grand_total" numeric DEFAULT 0 NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "customer_name" "text",
    "customer_address" "text",
    "customer_mobile" "text",
    "bill_series" "text",
    "bill_number" "text",
    "salesman" "text",
    "vehicle_number" "text"
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


ALTER TABLE "public"."invoices" ALTER COLUMN "invoiceid" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."invoices_invoiceid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."logins" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "username" "text",
    "password" "text"
);


ALTER TABLE "public"."logins" OWNER TO "postgres";


ALTER TABLE "public"."logins" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."logins_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."opening_stock" (
    "id" bigint NOT NULL,
    "item_code" "text",
    "quantity" numeric,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."opening_stock" OWNER TO "postgres";


ALTER TABLE "public"."opening_stock" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."opening_stock_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parties" (
    "id" bigint NOT NULL,
    "party_name" "text" NOT NULL,
    "normalized_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."parties" OWNER TO "postgres";


ALTER TABLE "public"."parties" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."parties_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "paymentid" integer NOT NULL,
    "invoiceid" integer NOT NULL,
    "paymentdate" "date" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "method" character varying(50)
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


ALTER TABLE "public"."payments" ALTER COLUMN "paymentid" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."payments_paymentid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."po_series" (
    "id" integer DEFAULT 1 NOT NULL,
    "last_number" integer DEFAULT 0
);


ALTER TABLE "public"."po_series" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "product_id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name" "text" NOT NULL,
    "hsn_code" bigint,
    "purchase_price" numeric(12,2) NOT NULL,
    "purchase_price_gst" numeric(12,2) NOT NULL,
    "landing_price_gst" numeric(12,2) NOT NULL,
    "retail_price" numeric(12,2),
    "retail_price_gst" numeric(12,2),
    "wholesale_price" numeric(12,2),
    "wholesale_price_gst" numeric(12,2),
    "special_price" numeric(12,2),
    "special_price_gst" numeric(12,2),
    "department" "text" NOT NULL,
    "online_offline" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "gst_percent" numeric,
    "landing_price" numeric,
    "retail_percent" numeric,
    "wholesale_percent" numeric,
    "special_percent" numeric,
    "offline_status" numeric,
    "product_hsn_code" numeric,
    "product_mrp" numeric,
    "product_purchase_rate" numeric,
    "selling_price" "text",
    "selling_price_2" "text",
    "selling_price_3" "text",
    "selling_price_4" "text",
    "selling_price_5" "text",
    "special_percent_2" "text",
    "special_percent_3" "text",
    "special_percent_4" "text",
    "special_percent_5" "text",
    "special_price_2" "text",
    "special_price_3" "text",
    "special_price_4" "text",
    "special_price_5" "text",
    "selling_type" "text",
    "special_status" "text",
    CONSTRAINT "products_online_offline_check" CHECK (("online_offline" = ANY (ARRAY['Online'::"text", 'Offline'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


ALTER TABLE "public"."products" ALTER COLUMN "product_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."products_product_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_details" (
    "id" bigint NOT NULL,
    "purchase_number" "text",
    "bill_date" "date" DEFAULT CURRENT_DATE,
    "gst_number" "text",
    "supplier_name" "text",
    "invoice_number" "text",
    "invoice_date" "date",
    "invoice_amount" numeric,
    "round_off" numeric,
    "payable" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "address" "text",
    "created_by" "text",
    "special_discount" numeric DEFAULT 0
);


ALTER TABLE "public"."purchase_details" OWNER TO "postgres";


ALTER TABLE "public"."purchase_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_item_details" (
    "id" bigint NOT NULL,
    "purchase_id" bigint,
    "hsn_code" "text",
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "discount_percent" numeric,
    "purchase_price" numeric,
    "purchase_price_gst" numeric,
    "landing" numeric,
    "price1_percent" numeric,
    "price1" numeric,
    "price1_gst" numeric,
    "price2_percent" numeric,
    "price2" numeric,
    "price2_gst" numeric,
    "price3_percent" numeric,
    "price3" numeric,
    "price3_gst" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "purchase_quantity" numeric,
    "updates_stock" numeric,
    "barcode" "text",
    "gst_percent" numeric,
    "department" "text"
);


ALTER TABLE "public"."purchase_item_details" OWNER TO "postgres";


ALTER TABLE "public"."purchase_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_items" (
    "purchase_item_id" bigint NOT NULL,
    "purchase_id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "discount_percent" numeric,
    "total_before_gst" numeric,
    "gst_percent" numeric,
    "total_with_gst" numeric,
    "purchase_price" numeric,
    "purchase_price_gst" numeric,
    "landing_price" numeric,
    "landing_price_gst" numeric,
    "retail_percent" numeric,
    "retail_price" numeric,
    "retail_price_gst" numeric,
    "wholesale_percent" numeric,
    "wholesale_price" numeric,
    "wholesale_price_gst" numeric,
    "special_percent" numeric,
    "special_price" numeric,
    "special_price_gst" numeric,
    "hsn_code" "text"
);


ALTER TABLE "public"."purchase_items" OWNER TO "postgres";


ALTER TABLE "public"."purchase_items" ALTER COLUMN "purchase_item_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_items_purchase_item_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."purchase_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."purchase_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_details" (
    "id" bigint NOT NULL,
    "po_number" "text",
    "supplier_name" "text",
    "supplier_gst" "text",
    "order_date" "date" DEFAULT CURRENT_DATE,
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "supplier_address" "text",
    "remark" "text",
    "is_cancelled" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "created_by" "text",
    "supplier_mobile" "text",
    "supplier_response" "text"
);

ALTER TABLE public.purchase_order_details
ADD COLUMN IF NOT EXISTS supplier_response text;


ALTER TABLE "public"."purchase_order_details" OWNER TO "postgres";


ALTER TABLE "public"."purchase_order_details" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."purchase_order_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_order_item_details" (
    "id" bigint NOT NULL,
    "purchase_order_id" bigint NOT NULL,
    "item_code" "text",
    "item_name" "text" NOT NULL,
    "is_new_item" boolean DEFAULT false NOT NULL,
    "quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "received_qty" numeric(12,2) DEFAULT 0 NOT NULL,
    "price" numeric(12,2),
    "remark" "text",
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."purchase_order_item_details" OWNER TO "postgres";


ALTER TABLE "public"."purchase_order_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_order_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_order_items" (
    "id" bigint NOT NULL,
    "po_id" bigint,
    "item_code" "text",
    "item_name" "text",
    "is_new_item" boolean DEFAULT false,
    "qty" numeric,
    "received_qty" numeric DEFAULT 0,
    "price" numeric,
    "remark" "text",
    "status" "text" DEFAULT 'PENDING'::"text"
);


ALTER TABLE "public"."purchase_order_items" OWNER TO "postgres";


ALTER TABLE "public"."purchase_order_items" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."purchase_order_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."purchase_order_no_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."purchase_order_no_seq" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."purchase_order_pending_view" AS
 SELECT "item_code",
    "item_name",
    COALESCE("sum"((COALESCE("quantity", (0)::numeric) - COALESCE("received_qty", (0)::numeric))), (0)::numeric) AS "total_pending"
   FROM "public"."purchase_order_item_details"
  WHERE ((COALESCE("status", 'PENDING'::"text") <> 'CANCELLED'::"text") AND ((COALESCE("quantity", (0)::numeric) - COALESCE("received_qty", (0)::numeric)) > (0)::numeric))
  GROUP BY "item_code", "item_name";


ALTER VIEW "public"."purchase_order_pending_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."purchase_order_report_view" AS
 SELECT "po"."id" AS "purchase_order_id",
    "po"."po_number",
    "po"."order_date",
    "po"."supplier_name",
    "po"."supplier_gst",
    "po"."supplier_address",
    "po"."status" AS "po_status",
    "po"."is_cancelled",
    "poi"."id" AS "po_item_id",
    "poi"."item_code",
    "poi"."item_name",
    "poi"."is_new_item",
    "poi"."quantity",
    "poi"."received_qty",
    GREATEST((COALESCE("poi"."quantity", (0)::numeric) - COALESCE("poi"."received_qty", (0)::numeric)), (0)::numeric) AS "pending_qty",
    "poi"."price",
    "poi"."remark",
    "poi"."status" AS "item_status",
    "poi"."created_at"
   FROM ("public"."purchase_order_details" "po"
     JOIN "public"."purchase_order_item_details" "poi" ON (("po"."id" = "poi"."purchase_order_id")))
  ORDER BY "po"."id" DESC, "poi"."id";


ALTER VIEW "public"."purchase_order_report_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_return_details" (
    "id" bigint NOT NULL,
    "purchase_return_number" "text",
    "return_date" "date" DEFAULT CURRENT_DATE,
    "gst_number" "text",
    "supplier_name" "text",
    "address" "text",
    "original_invoice_number" "text",
    "original_invoice_date" "date",
    "total_amount" numeric,
    "round_off" numeric,
    "payable" numeric,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "purchase_id" bigint,
    "purchase_number" "text",
    "supplier_return_bill_number" "text"
);


ALTER TABLE "public"."purchase_return_details" OWNER TO "postgres";


COMMENT ON COLUMN "public"."purchase_return_details"."supplier_return_bill_number" IS 'Credit note number or purchase return bill number issued by the supplier.';



ALTER TABLE "public"."purchase_return_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_return_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchase_return_item_details" (
    "id" bigint NOT NULL,
    "purchase_return_id" bigint,
    "item_code" "text",
    "item_name" "text",
    "barcode" "text",
    "department" "text",
    "quantity" numeric,
    "price" numeric,
    "discount_percent" numeric,
    "purchase_price" numeric,
    "purchase_price_gst" numeric,
    "landing" numeric,
    "gst_percent" numeric,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "purchase_id" bigint,
    "purchase_number" "text",
    "hsn_code" "text",
    "original_quantity" numeric,
    "balance_quantity" numeric,
    "total" numeric,
    "total_gst" numeric
);


ALTER TABLE "public"."purchase_return_item_details" OWNER TO "postgres";


ALTER TABLE "public"."purchase_return_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchase_return_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "purchase_id" bigint NOT NULL,
    "bill_number" "text" NOT NULL,
    "entry_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "invoice_date" "date" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "supplier_name" "text" NOT NULL,
    "supplier_gst" "text" NOT NULL,
    "invoice_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "round_off" numeric(12,2) DEFAULT 0 NOT NULL,
    "net_payable" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "purchase_no" "text" NOT NULL
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


ALTER TABLE "public"."purchases" ALTER COLUMN "purchase_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."purchases_purchase_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotation_compare_details" (
    "id" bigint NOT NULL,
    "compare_number" bigint NOT NULL,
    "compare_date" "date" DEFAULT CURRENT_DATE,
    "series_code" "text" DEFAULT 'CMP'::"text" NOT NULL,
    "quotation_series_code" "text",
    "customer_name" "text",
    "customer_mobile" "text",
    "gst_number" "text",
    "address" "text",
    "salesman" "text",
    "remarks" "text",
    "total_amount" numeric(14,2) DEFAULT 0,
    "item_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand1_total" numeric(14,2) DEFAULT 0,
    "brand2_total" numeric(14,2) DEFAULT 0,
    "brand3_total" numeric(14,2) DEFAULT 0,
    "selected_total" numeric(14,2) DEFAULT 0
);


ALTER TABLE "public"."quotation_compare_details" OWNER TO "postgres";


ALTER TABLE "public"."quotation_compare_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotation_compare_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotation_compare_item_details" (
    "id" bigint NOT NULL,
    "compare_id" bigint NOT NULL,
    "row_no" integer,
    "item_code" "text",
    "item_name" "text",
    "brand" "text",
    "category" "text",
    "model_no" "text",
    "quantity" numeric(14,3) DEFAULT 0,
    "price_type" "text",
    "gst_percent" numeric(10,2) DEFAULT 0,
    "hsn_code" "text",
    "price1" numeric(14,2) DEFAULT 0,
    "price2" numeric(14,2) DEFAULT 0,
    "price3" numeric(14,2) DEFAULT 0,
    "selected_option" "text",
    "final_price" numeric(14,2) DEFAULT 0,
    "final_price_gst" numeric(14,2) DEFAULT 0,
    "line_total" numeric(14,2) DEFAULT 0,
    "stock_balance" numeric(14,3) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand1_amount" numeric(14,2) DEFAULT 0,
    "brand2_amount" numeric(14,2) DEFAULT 0,
    "brand3_amount" numeric(14,2) DEFAULT 0
);


ALTER TABLE "public"."quotation_compare_item_details" OWNER TO "postgres";


ALTER TABLE "public"."quotation_compare_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotation_compare_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotation_details" (
    "id" bigint NOT NULL,
    "series_code" "text",
    "quotation_number" integer,
    "bill_date" "date",
    "customer_name" "text",
    "customer_mobile" "text",
    "gst_number" "text",
    "invoice_number" integer,
    "quotation_date" "date",
    "total_amount" numeric(12,2),
    "round_off" numeric(12,2),
    "created_at" timestamp without time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'OPEN'::"text",
    "converted" boolean DEFAULT false,
    "created_by" "text",
    "salesman" "text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "cancel_reason" "text",
    "remark" "text",
    "follow_up" "text",
    "agent_mobile" "text"
);


ALTER TABLE "public"."quotation_details" OWNER TO "postgres";


ALTER TABLE "public"."quotation_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotation_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotation_item_details" (
    "quotation_id" bigint NOT NULL,
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric(12,2),
    "price" numeric(12,2),
    "sales_price" numeric(12,2),
    "sales_price_gst" numeric(12,2),
    "gst_percent" numeric(5,2),
    "hsn_code" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "id" bigint NOT NULL,
    "discount_percent" numeric(12,2)
);


ALTER TABLE "public"."quotation_item_details" OWNER TO "postgres";


ALTER TABLE "public"."quotation_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotation_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotation_series" (
    "series_code" "text" NOT NULL,
    "quotation_number" integer DEFAULT 0
);


ALTER TABLE "public"."quotation_series" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_details" (
    "id" bigint NOT NULL,
    "sales_number" bigint,
    "bill_date" "date" DEFAULT CURRENT_DATE,
    "gst_number" "text",
    "customer_name" "text",
    "invoice_number" "text",
    "invoice_date" "date",
    "invoice_amount" numeric,
    "round_off" numeric,
    "payable" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "series" numeric,
    "series_code" "text",
    "customer_mobile" "text",
    "salesman" "text",
    "created_by" "text",
    "address" "text",
    "payment_type" "text" DEFAULT 'CASH'::"text",
    "paid_amount" numeric DEFAULT 0,
    "balance_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "cancel_reason" "text",
    "is_checked" boolean DEFAULT false,
    "department" "text" DEFAULT 'ALL'::"text" NOT NULL,
    "agent_mobile" "text",
    "credit_bill_amount" numeric
);


ALTER TABLE "public"."sales_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_item_details" (
    "id" bigint NOT NULL,
    "sales_id" bigint,
    "hsn_code" "text",
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "discount_percent" numeric,
    "sales_price" numeric,
    "sales_price_gst" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "gst_percent" numeric
);


ALTER TABLE "public"."sales_item_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_order_details" (
    "id" bigint NOT NULL,
    "series_code" "text",
    "order_number" bigint,
    "order_date" "date",
    "customer_name" "text",
    "customer_mobile" "text",
    "gst_number" "text",
    "total_amount" numeric,
    "converted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "text",
    "salesman" "text",
    "payment_type" "text" DEFAULT 'CASH'::"text",
    "advance_amount" numeric DEFAULT 0,
    "balance_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "cancel_reason" "text",
    "agent_mobile" "text"
);


ALTER TABLE "public"."sales_order_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_order_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_order_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_order_item_details" (
    "id" bigint NOT NULL,
    "sales_order_id" bigint,
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "sales_price" numeric,
    "sales_price_gst" numeric,
    "hsn_code" "text",
    "gst_percent" numeric,
    "discount_percent" numeric(12,2)
);


ALTER TABLE "public"."sales_order_item_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_order_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_order_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_packing_details" (
    "id" bigint NOT NULL,
    "sales_id" bigint,
    "series_code" "text",
    "packing_number" bigint,
    "packing_date" "date",
    "customer_name" "text",
    "customer_mobile" "text",
    "gst_number" "text",
    "salesman" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "packing_amount" numeric,
    "created_by" "text",
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "cancel_reason" "text",
    "agent_mobile" "text"
);


ALTER TABLE "public"."sales_packing_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_packing_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_packing_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_packing_item_details" (
    "id" bigint NOT NULL,
    "packing_id" bigint,
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "sales_price_gst" numeric,
    "hsn_code" "text",
    "gst_percent" numeric,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "discount_percent" numeric(12,2)
);


ALTER TABLE "public"."sales_packing_item_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_packing_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_packing_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_return_details" (
    "id" bigint NOT NULL,
    "return_number" bigint,
    "return_date" "date",
    "original_sales_id" bigint,
    "customer_name" "text",
    "customer_mobile" "text",
    "total_return_amount" numeric,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "text",
    "approved_at" timestamp with time zone,
    "approval_note" "text",
    "is_accepted" boolean DEFAULT false,
    "accepted_at" timestamp with time zone,
    "accepted_by" "text",
    "gst_number" "text",
    "return_payment_type" "text" DEFAULT 'CASH'::"text",
    "settlement_mode" "text" DEFAULT 'CASH'::"text",
    "cash_refund_amount" numeric DEFAULT 0,
    "credit_adjustment_amount" numeric DEFAULT 0,
    CONSTRAINT "sales_return_details_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."sales_return_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_return_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_return_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_return_item_details" (
    "id" bigint NOT NULL,
    "return_id" bigint,
    "item_code" "text",
    "item_name" "text",
    "sold_qty" numeric,
    "return_qty" numeric,
    "price" numeric,
    "price_gst" numeric,
    "hsn_code" "text",
    "gst_percent" numeric
);


ALTER TABLE "public"."sales_return_item_details" OWNER TO "postgres";


ALTER TABLE "public"."sales_return_item_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_return_item_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_returns" (
    "salesreturnid" bigint NOT NULL,
    "invoiceid" bigint,
    "customer_id" bigint,
    "return_date" "date" DEFAULT CURRENT_DATE,
    "total_amount" numeric,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_returns" OWNER TO "postgres";


ALTER TABLE "public"."sales_returns" ALTER COLUMN "salesreturnid" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_returns_salesreturnid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_items" (
    "id" bigint NOT NULL,
    "hsn_code" "text",
    "item_code" "text",
    "item_name" "text",
    "quantity" numeric,
    "price" numeric,
    "discount_percent" numeric,
    "purchase_price" numeric,
    "purchase_price_gst" numeric,
    "landing" numeric,
    "price1_percent" numeric,
    "price1" numeric,
    "price1_gst" numeric,
    "price2_percent" numeric,
    "price2" numeric,
    "price2_gst" numeric,
    "price3_percent" numeric,
    "price3" numeric,
    "price3_gst" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "gst_percent" numeric,
    "barcode" "text",
    "brand" "text",
    "category" "text",
    "model_no" "text",
    "department" "text" DEFAULT 'ALL'::"text" NOT NULL,
    "minimum_qty" numeric DEFAULT 0,
    "maximum_qty" numeric DEFAULT 0,
    "product_image_url" "text",
    "product_image_alt" "text",
    "product_image_updated_at" timestamp with time zone,
    CONSTRAINT "stock_items_department_check" CHECK (("department" = ANY (ARRAY['ALL'::"text", 'ELECTRICAL'::"text", 'PLUMBING'::"text", 'INTERLOCK'::"text"])))
);


ALTER TABLE "public"."stock_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."stock_balance_view" AS
 SELECT "si"."item_code",
    "si"."item_name",
    "si"."barcode",
    "si"."price1",
    "si"."price1_gst",
    "si"."price2",
    "si"."price2_gst",
    "si"."price3",
    "si"."price3_gst",
    "si"."landing",
    "si"."purchase_price",
    "si"."purchase_price_gst",
    "si"."gst_percent",
    "si"."hsn_code",
    "si"."department",
    "si"."minimum_qty",
    "si"."maximum_qty",
    (COALESCE("sum"("sl"."qty_in"), (0)::numeric) - COALESCE("sum"("sl"."qty_out"), (0)::numeric)) AS "balance"
   FROM ("public"."stock_items" "si"
     LEFT JOIN "public"."stock_ledger" "sl" ON (("si"."item_code" = "sl"."item_code")))
  GROUP BY "si"."item_code", "si"."item_name", "si"."barcode", "si"."price1", "si"."price1_gst", "si"."price2", "si"."price2_gst", "si"."price3", "si"."price3_gst", "si"."landing", "si"."purchase_price", "si"."purchase_price_gst", "si"."gst_percent", "si"."hsn_code", "si"."department", "si"."minimum_qty", "si"."maximum_qty";


ALTER VIEW "public"."stock_balance_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_conversion_details" (
    "id" bigint NOT NULL,
    "conversion_no" "text" NOT NULL,
    "conversion_date" "date" DEFAULT CURRENT_DATE,
    "from_item_code" "text",
    "from_item_name" "text",
    "from_qty" numeric DEFAULT 0,
    "to_item_code" "text",
    "to_item_name" "text",
    "to_qty" numeric DEFAULT 0,
    "remarks" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_conversion_details" OWNER TO "postgres";


ALTER TABLE "public"."stock_conversion_details" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_conversion_details_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_conversion_items" (
    "id" bigint NOT NULL,
    "conversion_no" "text",
    "item_code" "text",
    "item_name" "text",
    "qty_in" numeric DEFAULT 0,
    "qty_out" numeric DEFAULT 0
);


ALTER TABLE "public"."stock_conversion_items" OWNER TO "postgres";


ALTER TABLE "public"."stock_conversion_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_conversion_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stock_conversion_templates" (
    "id" bigint NOT NULL,
    "template_name" "text",
    "from_item_code" "text",
    "from_item_name" "text",
    "to_items" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_conversion_templates" OWNER TO "postgres";


ALTER TABLE "public"."stock_conversion_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_conversion_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."stock_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."stock_ledger" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."stock_ledger_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."stock_ledger_view" AS
 SELECT "reference_id",
    "item_code",
    "max"("created_at") AS "date",
    "sum"("qty_in") AS "total_in",
    "sum"("qty_out") AS "total_out",
    ("sum"("qty_in") - "sum"("qty_out")) AS "net_movement"
   FROM "public"."stock_ledger"
  GROUP BY "reference_id", "item_code"
  ORDER BY ("max"("created_at"));


ALTER VIEW "public"."stock_ledger_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."stock_transaction_final" AS
 SELECT "reference_id",
    "item_code",
    ("sum"("qty_in") - "sum"("qty_out")) AS "final_effect",
    "max"("created_at") AS "last_updated",
    "max"("txn_type") AS "txn_type"
   FROM "public"."stock_ledger"
  GROUP BY "reference_id", "item_code"
  ORDER BY ("max"("created_at")) DESC;


ALTER VIEW "public"."stock_transaction_final" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "supplier_id" bigint NOT NULL,
    "createdat" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "name" "text",
    "mobile" "text",
    "address" "text",
    "gst_number" "text",
    "state_code" "text"
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


ALTER TABLE "public"."suppliers" ALTER COLUMN "supplier_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."suppliers_supplier_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_page_access" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "page_key" "text" NOT NULL,
    "allowed" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_page_access" OWNER TO "postgres";


ALTER TABLE "public"."user_page_access" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_page_access_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "approved" boolean DEFAULT false,
    CONSTRAINT "user_profiles_role_check" CHECK (("role" = ANY (ARRAY['PENDING'::"text", 'OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text", 'SALES BILLER'::"text", 'SALES & PURCHASE'::"text", 'ROUTE EXECUTIVE'::"text", 'SALES MAN'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."website_enquiries" (
    "id" bigint NOT NULL,
    "customer_name" "text",
    "mobile" "text" NOT NULL,
    "note" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "item_count" integer DEFAULT 0 NOT NULL,
    "estimated_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source" "text" DEFAULT 'website'::"text" NOT NULL,
    "notified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "website_enquiries_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'closed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."website_enquiries" OWNER TO "postgres";


ALTER TABLE "public"."website_enquiries" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."website_enquiries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."bill_counters"
    ADD CONSTRAINT "bill_counters_pkey" PRIMARY KEY ("series_code");



ALTER TABLE ONLY "public"."bill_edit_grants"
    ADD CONSTRAINT "bill_edit_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_series"
    ADD CONSTRAINT "bill_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_series"
    ADD CONSTRAINT "bill_series_series_code_key" UNIQUE ("series_code");



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_voucher_no_key" UNIQUE ("voucher_no");



ALTER TABLE ONLY "public"."cash_voucher_counters"
    ADD CONSTRAINT "cash_voucher_counters_pkey" PRIMARY KEY ("txn_type");



ALTER TABLE ONLY "public"."credit_note_items"
    ADD CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_credit_note_no_key" UNIQUE ("credit_note_no");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_receipt_allocations"
    ADD CONSTRAINT "credit_receipt_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_customers"
    ADD CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id");



ALTER TABLE ONLY "public"."daily_cash_closing"
    ADD CONSTRAINT "daily_cash_closing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."damage_entries"
    ADD CONSTRAINT "damage_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dashboard_work_messages"
    ADD CONSTRAINT "dashboard_work_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hsn_codes"
    ADD CONSTRAINT "hsn_codes_hsn_code_key" UNIQUE ("hsn_code");



ALTER TABLE ONLY "public"."hsn_codes"
    ADD CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("hsn_id");



ALTER TABLE ONLY "public"."invoiceitems"
    ADD CONSTRAINT "invoiceitems_pkey" PRIMARY KEY ("itemid");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoiceid");



ALTER TABLE ONLY "public"."logins"
    ADD CONSTRAINT "logins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opening_stock"
    ADD CONSTRAINT "opening_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_party_name_key" UNIQUE ("party_name");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("paymentid");



ALTER TABLE ONLY "public"."po_series"
    ADD CONSTRAINT "po_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."purchase_details"
    ADD CONSTRAINT "purchase_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_details"
    ADD CONSTRAINT "purchase_details_purchase_number_key" UNIQUE ("purchase_number");



ALTER TABLE ONLY "public"."purchase_details"
    ADD CONSTRAINT "purchase_details_supplier_invoice_unique" UNIQUE ("gst_number", "invoice_number", "invoice_date");



ALTER TABLE ONLY "public"."purchase_item_details"
    ADD CONSTRAINT "purchase_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("purchase_item_id");



ALTER TABLE ONLY "public"."purchase_order_details"
    ADD CONSTRAINT "purchase_order_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_details"
    ADD CONSTRAINT "purchase_order_details_po_number_key" UNIQUE ("po_number");



ALTER TABLE ONLY "public"."purchase_order_item_details"
    ADD CONSTRAINT "purchase_order_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_return_details"
    ADD CONSTRAINT "purchase_return_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_return_item_details"
    ADD CONSTRAINT "purchase_return_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("purchase_id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_purchase_no_key" UNIQUE ("purchase_no");



ALTER TABLE ONLY "public"."quotation_compare_details"
    ADD CONSTRAINT "quotation_compare_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_compare_item_details"
    ADD CONSTRAINT "quotation_compare_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_details"
    ADD CONSTRAINT "quotation_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_item_details"
    ADD CONSTRAINT "quotation_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_series"
    ADD CONSTRAINT "quotation_series_pkey" PRIMARY KEY ("series_code");



ALTER TABLE ONLY "public"."sales_details"
    ADD CONSTRAINT "sales_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_item_details"
    ADD CONSTRAINT "sales_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_order_details"
    ADD CONSTRAINT "sales_order_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_order_item_details"
    ADD CONSTRAINT "sales_order_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_packing_details"
    ADD CONSTRAINT "sales_packing_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_packing_item_details"
    ADD CONSTRAINT "sales_packing_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_return_details"
    ADD CONSTRAINT "sales_return_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_return_item_details"
    ADD CONSTRAINT "sales_return_item_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_return_item_details"
    ADD CONSTRAINT "sales_return_item_unique" UNIQUE ("return_id", "item_code");



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("salesreturnid");



ALTER TABLE ONLY "public"."stock_conversion_details"
    ADD CONSTRAINT "stock_conversion_details_conversion_no_key" UNIQUE ("conversion_no");



ALTER TABLE ONLY "public"."stock_conversion_details"
    ADD CONSTRAINT "stock_conversion_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_conversion_items"
    ADD CONSTRAINT "stock_conversion_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_conversion_templates"
    ADD CONSTRAINT "stock_conversion_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_items"
    ADD CONSTRAINT "stock_items_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."stock_items"
    ADD CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_ledger"
    ADD CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("supplier_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "unique_full_name" UNIQUE ("full_name");



ALTER TABLE ONLY "public"."purchase_details"
    ADD CONSTRAINT "unique_invoice" UNIQUE ("invoice_number", "invoice_date", "gst_number");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "unique_invoice_per_supplier" UNIQUE ("supplier_name", "supplier_gst", "invoice_number", "invoice_date");



ALTER TABLE ONLY "public"."sales_details"
    ADD CONSTRAINT "unique_series_salesnumber" UNIQUE ("series_code", "sales_number");



ALTER TABLE ONLY "public"."user_page_access"
    ADD CONSTRAINT "user_page_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."website_enquiries"
    ADD CONSTRAINT "website_enquiries_pkey" PRIMARY KEY ("id");



CREATE INDEX "cash_transactions_customer_mobile_idx" ON "public"."cash_transactions" USING "btree" ("customer_mobile");



CREATE INDEX "customers_mobile_lookup_idx" ON "public"."customers" USING "btree" ("mobile");



CREATE INDEX "damage_entries_date_idx" ON "public"."damage_entries" USING "btree" ("damage_date" DESC);



CREATE INDEX "damage_entries_item_status_idx" ON "public"."damage_entries" USING "btree" ("item_code", "status");



CREATE INDEX "dashboard_work_messages_created_at_idx" ON "public"."dashboard_work_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "dashboard_work_messages_parent_id_idx" ON "public"."dashboard_work_messages" USING "btree" ("parent_id");



CREATE INDEX "idx_cash_transactions_party_id" ON "public"."cash_transactions" USING "btree" ("party_id");



CREATE INDEX "idx_cash_transactions_party_name" ON "public"."cash_transactions" USING "btree" ("lower"("party_name"));



CREATE INDEX "idx_cash_transactions_txn_date" ON "public"."cash_transactions" USING "btree" ("txn_date");



CREATE INDEX "idx_cash_transactions_txn_type" ON "public"."cash_transactions" USING "btree" ("txn_type");



CREATE INDEX "idx_daily_cash_closing_date" ON "public"."daily_cash_closing" USING "btree" ("closing_date");



CREATE INDEX "idx_daily_cash_closing_time" ON "public"."daily_cash_closing" USING "btree" ("closing_time" DESC);



CREATE INDEX "idx_parties_normalized_name" ON "public"."parties" USING "btree" ("normalized_name");



CREATE INDEX "idx_po_items_code" ON "public"."purchase_order_item_details" USING "btree" ("item_code");



CREATE INDEX "idx_po_items_name" ON "public"."purchase_order_item_details" USING "btree" ("item_name");



CREATE INDEX "idx_po_items_po_id" ON "public"."purchase_order_item_details" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_purchase_order_details_supplier_mobile" ON "public"."purchase_order_details" USING "btree" ("supplier_mobile");



CREATE INDEX "idx_purchase_return_items_item_code" ON "public"."purchase_return_item_details" USING "btree" ("item_code");



CREATE INDEX "idx_purchase_return_items_purchase_id" ON "public"."purchase_return_item_details" USING "btree" ("purchase_id");



CREATE INDEX "idx_purchase_return_items_purchase_return_id" ON "public"."purchase_return_item_details" USING "btree" ("purchase_return_id");



CREATE INDEX "idx_qc_details_number" ON "public"."quotation_compare_details" USING "btree" ("compare_number");



CREATE INDEX "idx_qc_details_series" ON "public"."quotation_compare_details" USING "btree" ("series_code");



CREATE INDEX "idx_qc_items_compare_id" ON "public"."quotation_compare_item_details" USING "btree" ("compare_id");



CREATE INDEX "idx_quotation_compare_item_details_item_code" ON "public"."quotation_compare_item_details" USING "btree" ("item_code");



CREATE INDEX "idx_quotation_items" ON "public"."quotation_item_details" USING "btree" ("quotation_id");



CREATE INDEX "idx_quotation_number" ON "public"."quotation_details" USING "btree" ("series_code", "quotation_number");



CREATE INDEX "idx_stock_items_barcode" ON "public"."stock_items" USING "btree" ("barcode");



CREATE INDEX "purchase_details_supplier_invoice_idx" ON "public"."purchase_details" USING "btree" ("gst_number", "invoice_number");



CREATE INDEX "purchase_item_details_purchase_idx" ON "public"."purchase_item_details" USING "btree" ("purchase_id");



CREATE INDEX "sales_details_agent_mobile_idx" ON "public"."sales_details" USING "btree" ("agent_mobile");



CREATE UNIQUE INDEX "sales_details_series_sales_number_uidx" ON "public"."sales_details" USING "btree" ("series_code", "sales_number");



CREATE INDEX "sales_item_details_sales_idx" ON "public"."sales_item_details" USING "btree" ("sales_id");



CREATE INDEX "stock_items_code_idx" ON "public"."stock_items" USING "btree" ("item_code");



CREATE INDEX "stock_items_name_idx" ON "public"."stock_items" USING "btree" ("item_name");



CREATE UNIQUE INDEX "user_page_access_user_page_idx" ON "public"."user_page_access" USING "btree" ("user_id", "page_key");



CREATE INDEX "website_enquiries_created_at_idx" ON "public"."website_enquiries" USING "btree" ("created_at" DESC);



CREATE INDEX "website_enquiries_mobile_idx" ON "public"."website_enquiries" USING "btree" ("mobile");



CREATE INDEX "website_enquiries_status_idx" ON "public"."website_enquiries" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "assign_sales_number_before_insert" BEFORE INSERT ON "public"."sales_details" FOR EACH ROW EXECUTE FUNCTION "public"."assign_sales_number_on_insert"();



CREATE OR REPLACE TRIGGER "trg_apply_purchase_to_po_items" AFTER INSERT ON "public"."purchase_item_details" FOR EACH ROW EXECUTE FUNCTION "public"."apply_purchase_to_po_items"();



CREATE OR REPLACE TRIGGER "trg_cash_transactions_updated_at" BEFORE UPDATE ON "public"."cash_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_opening_stock" AFTER INSERT ON "public"."opening_stock" FOR EACH ROW EXECUTE FUNCTION "public"."opening_stock_ledger"();



CREATE OR REPLACE TRIGGER "trg_preserve_vajra_credit_bill_amount" BEFORE INSERT OR UPDATE OF "salesman", "invoice_amount" ON "public"."sales_details" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_vajra_credit_bill_amount"();



CREATE OR REPLACE TRIGGER "trg_purchase_return_stock" AFTER INSERT OR DELETE ON "public"."purchase_return_item_details" FOR EACH ROW EXECUTE FUNCTION "public"."purchase_return_stock_ledger"();



CREATE OR REPLACE TRIGGER "trg_purchase_stock" AFTER INSERT OR DELETE OR UPDATE ON "public"."purchase_item_details" FOR EACH ROW EXECUTE FUNCTION "public"."purchase_stock_ledger"();



CREATE OR REPLACE TRIGGER "trg_sales_stock" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_item_details" FOR EACH ROW EXECUTE FUNCTION "public"."sales_stock_ledger"();



CREATE OR REPLACE TRIGGER "trg_set_purchase_number" BEFORE INSERT ON "public"."purchase_details" FOR EACH ROW EXECUTE FUNCTION "public"."set_purchase_number"();



ALTER TABLE ONLY "public"."bill_edit_grants"
    ADD CONSTRAINT "bill_edit_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."bill_edit_grants"
    ADD CONSTRAINT "bill_edit_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_transactions"
    ADD CONSTRAINT "cash_transactions_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."credit_note_items"
    ADD CONSTRAINT "credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_note_items"
    ADD CONSTRAINT "credit_note_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id");



ALTER TABLE ONLY "public"."credit_notes"
    ADD CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id");



ALTER TABLE ONLY "public"."credit_receipt_allocations"
    ADD CONSTRAINT "credit_receipt_allocations_cash_transaction_id_fkey" FOREIGN KEY ("cash_transaction_id") REFERENCES "public"."cash_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_receipt_allocations"
    ADD CONSTRAINT "credit_receipt_allocations_sales_id_fkey" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_cash_closing"
    ADD CONSTRAINT "daily_cash_closing_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."damage_entries"
    ADD CONSTRAINT "damage_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."damage_entries"
    ADD CONSTRAINT "damage_entries_solved_by_fkey" FOREIGN KEY ("solved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dashboard_work_messages"
    ADD CONSTRAINT "dashboard_work_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_work_messages"
    ADD CONSTRAINT "dashboard_work_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."dashboard_work_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoiceitems"
    ADD CONSTRAINT "invoiceitems_invoiceid_fkey" FOREIGN KEY ("invoiceid") REFERENCES "public"."invoices"("invoiceid");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customerid_fkey" FOREIGN KEY ("customerid") REFERENCES "public"."customers"("customer_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_invoiceid_fkey" FOREIGN KEY ("invoiceid") REFERENCES "public"."invoices"("invoiceid");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_hsn_code_fkey" FOREIGN KEY ("hsn_code") REFERENCES "public"."hsn_codes"("hsn_id");



ALTER TABLE ONLY "public"."purchase_item_details"
    ADD CONSTRAINT "purchase_item_details_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("purchase_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_item_details"
    ADD CONSTRAINT "purchase_order_item_details_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_order_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_return_details"
    ADD CONSTRAINT "purchase_return_details_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_details"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_return_item_details"
    ADD CONSTRAINT "purchase_return_item_details_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_details"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_return_item_details"
    ADD CONSTRAINT "purchase_return_item_details_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_return_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_compare_item_details"
    ADD CONSTRAINT "quotation_compare_item_details_compare_id_fkey" FOREIGN KEY ("compare_id") REFERENCES "public"."quotation_compare_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_item_details"
    ADD CONSTRAINT "quotation_item_details_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_item_details"
    ADD CONSTRAINT "sales_item_details_sales_id_fkey" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id");



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_invoiceid_fkey" FOREIGN KEY ("invoiceid") REFERENCES "public"."invoices"("invoiceid");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins manage bill edit grants" ON "public"."bill_edit_grants" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("upper"("p"."role") = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text"]))))));



CREATE POLICY "Allow stock conversion items delete" ON "public"."stock_conversion_items" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow stock conversion items insert" ON "public"."stock_conversion_items" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow stock conversion items select" ON "public"."stock_conversion_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow stock conversion items update" ON "public"."stock_conversion_items" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Approved users can delete workboard messages" ON "public"."dashboard_work_messages" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Approved users can post workboard messages" ON "public"."dashboard_work_messages" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "Approved users can read workboard" ON "public"."dashboard_work_messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can read own profile" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users read own bill edit grants" ON "public"."bill_edit_grants" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "allow all for authenticated" ON "public"."bill_counters" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."bill_series" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."cash_transactions" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."credit_note_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."credit_notes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."crm_customers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."customers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."hsn_codes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."invoiceitems" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."invoices" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."logins" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."opening_stock" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."parties" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."payments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."products" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."purchase_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."purchase_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."purchase_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."purchases" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."quotation_compare_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."quotation_compare_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."quotation_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."quotation_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."quotation_series" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_order_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_order_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_packing_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_packing_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_return_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_return_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."sales_returns" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."stock_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."stock_ledger" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."suppliers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."user_page_access" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated" ON "public"."user_profiles" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated purchase_details" ON "public"."purchase_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated purchase_item_details" ON "public"."purchase_item_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated stock_items" ON "public"."stock_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated stock_ledger" ON "public"."stock_ledger" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow all for authenticated suppliers" ON "public"."suppliers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated delete purchase order details" ON "public"."purchase_order_details" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "allow authenticated delete purchase order items" ON "public"."purchase_order_item_details" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "allow authenticated insert purchase order details" ON "public"."purchase_order_details" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "allow authenticated insert purchase order items" ON "public"."purchase_order_item_details" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "allow authenticated select purchase order details" ON "public"."purchase_order_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "allow authenticated select purchase order items" ON "public"."purchase_order_item_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "allow authenticated update purchase order details" ON "public"."purchase_order_details" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated update purchase order items" ON "public"."purchase_order_item_details" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow stock conversion all" ON "public"."stock_conversion_details" USING (true) WITH CHECK (true);



CREATE POLICY "approved managers can view website enquiries" ON "public"."website_enquiries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "profile"
  WHERE (("profile"."id" = "auth"."uid"()) AND ("profile"."approved" = true) AND ("upper"(COALESCE("profile"."role", ''::"text")) = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text"]))))));



CREATE POLICY "authenticated users add damages" ON "public"."damage_entries" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "authenticated users read damages" ON "public"."damage_entries" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated users solve damages" ON "public"."damage_entries" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."bill_edit_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_voucher_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_receipt_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers_backup_before_merge" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_cash_closing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_cash_closing_delete_owner_admin" ON "public"."daily_cash_closing" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("upper"(COALESCE("up"."role", ''::"text")) = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text"]))))));



CREATE POLICY "daily_cash_closing_insert_authenticated" ON "public"."daily_cash_closing" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "daily_cash_closing_select_authenticated" ON "public"."daily_cash_closing" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "daily_cash_closing_update_owner_admin_manager" ON "public"."daily_cash_closing" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("upper"(COALESCE("up"."role", ''::"text")) = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("upper"(COALESCE("up"."role", ''::"text")) = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MANAGER'::"text"]))))));



ALTER TABLE "public"."damage_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_work_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."po_series" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public can submit website enquiries" ON "public"."website_enquiries" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("status" = 'new'::"text") AND ("source" = 'website'::"text") AND (("char_length"("mobile") >= 10) AND ("char_length"("mobile") <= 15)) AND (("item_count" >= 1) AND ("item_count" <= 99999)) AND ("jsonb_typeof"("items") = 'array'::"text") AND (("jsonb_array_length"("items") >= 1) AND ("jsonb_array_length"("items") <= 100))));



CREATE POLICY "purchase_details_insert_approved" ON "public"."purchase_details" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."approved" = true)))));



CREATE POLICY "purchase_details_select_approved" ON "public"."purchase_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."approved" = true)))));



CREATE POLICY "purchase_details_update_approved" ON "public"."purchase_details" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."approved" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."approved" = true)))));



ALTER TABLE "public"."purchase_order_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_item_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_return_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_return_details_delete_policy" ON "public"."purchase_return_details" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "purchase_return_details_insert_policy" ON "public"."purchase_return_details" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "purchase_return_details_select_policy" ON "public"."purchase_return_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "purchase_return_details_update_policy" ON "public"."purchase_return_details" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."purchase_return_item_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_return_item_details_delete_policy" ON "public"."purchase_return_item_details" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "purchase_return_item_details_insert_policy" ON "public"."purchase_return_item_details" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "purchase_return_item_details_select_policy" ON "public"."purchase_return_item_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "purchase_return_item_details_update_policy" ON "public"."purchase_return_item_details" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."stock_conversion_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_conversion_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_conversion_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."website_enquiries" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."apply_purchase_to_po_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_purchase_to_po_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_purchase_to_po_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_sales_number_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_sales_number_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_sales_number_on_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_purchase_order"("p_po_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_purchase_order"("p_po_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_purchase_order"("p_po_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_bill_edit_grant"("p_grant_id" bigint, "p_sale_id" bigint) TO "service_role";



GRANT ALL ON TABLE "public"."cash_transactions" TO "anon";
GRANT ALL ON TABLE "public"."cash_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_transactions" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_cash_transaction_safe"("p_txn_type" "text", "p_txn_date" "date", "p_party_id" bigint, "p_party_name" "text", "p_amount" numeric, "p_remarks" "text", "p_approval_status" "text", "p_reference_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_cash_transaction_safe"("p_txn_type" "text", "p_txn_date" "date", "p_party_id" bigint, "p_party_name" "text", "p_amount" numeric, "p_remarks" "text", "p_approval_status" "text", "p_reference_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_cash_transaction_safe"("p_txn_type" "text", "p_txn_date" "date", "p_party_id" bigint, "p_party_name" "text", "p_amount" numeric, "p_remarks" "text", "p_approval_status" "text", "p_reference_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_manager_duplicate_customers"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."decrease_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."decrease_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrease_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_stock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_stock_quantity"() TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_stock_quantity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_stock_quantity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bill_edit_grant"("p_sale_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bulk_sales_bills"("p_from_date" "date", "p_to_date" "date", "p_salesman" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_bulk_sales_bills"("p_from_date" "date", "p_to_date" "date", "p_salesman" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bulk_sales_bills"("p_from_date" "date", "p_to_date" "date", "p_salesman" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_quotation_number"("p_series" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_quotation_number"("p_series" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_quotation_number"("p_series" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_sales_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_sales_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_sales_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_sales_number"("p_series" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_sales_number"("p_series" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_sales_number"("p_series" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_sales_order_number"("p_series" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_sales_order_number"("p_series" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_sales_order_number"("p_series" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_sales_return_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_sales_return_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_sales_return_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_table_names"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_table_names"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_table_names"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_today_dashboard_sales_split"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_today_dashboard_sales_split"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_today_dashboard_sales_split"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_today_dashboard_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_today_dashboard_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_today_dashboard_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_sales_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_sales_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_sales_stock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increase_stock"("p_item_code" "text", "p_qty" numeric, "p_reference_id" bigint, "p_txn_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_bill_number"("series_code_input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_bill_number"("series_code_input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_bill_number"("series_code_input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."opening_stock_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."opening_stock_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."opening_stock_ledger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."peek_next_sales_number"("p_series" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."peek_next_sales_number"("p_series" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."peek_next_sales_number"("p_series" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."peek_next_sales_number"("p_series" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."preserve_vajra_credit_bill_amount"() TO "anon";
GRANT ALL ON FUNCTION "public"."preserve_vajra_credit_bill_amount"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."preserve_vajra_credit_bill_amount"() TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_return_stock_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_return_stock_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_return_stock_ledger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_stock_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_stock_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_stock_ledger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_stock_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_stock_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_stock_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_purchase_order_status"("p_po_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_purchase_order_status"("p_po_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_purchase_order_status"("p_po_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_stock"("p_item_code" "text", "p_qty" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."restore_stock"("p_item_code" "text", "p_qty" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_stock"("p_item_code" "text", "p_qty" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sales_ledger_entry"() TO "anon";
GRANT ALL ON FUNCTION "public"."sales_ledger_entry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sales_ledger_entry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sales_stock_ledger"() TO "anon";
GRANT ALL ON FUNCTION "public"."sales_stock_ledger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sales_stock_ledger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sales_stock_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."sales_stock_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sales_stock_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."save_bulk_sales_edit"("p_bills" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_bulk_sales_edit"("p_bills" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_bulk_sales_edit"("p_bills" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."daily_cash_closing" TO "anon";
GRANT ALL ON TABLE "public"."daily_cash_closing" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_cash_closing" TO "service_role";



GRANT ALL ON FUNCTION "public"."save_daily_cash_closing"("p_closing_amount" numeric, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_daily_cash_closing"("p_closing_amount" numeric, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_daily_cash_closing"("p_closing_amount" numeric, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_purchase_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_purchase_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_purchase_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sync_stock_from_purchase_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_stock_from_purchase_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_stock_from_purchase_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_stock_quantity"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_stock_quantity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_stock_quantity"() TO "service_role";


















GRANT ALL ON TABLE "public"."bill_counters" TO "anon";
GRANT ALL ON TABLE "public"."bill_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_counters" TO "service_role";



GRANT ALL ON TABLE "public"."bill_edit_grants" TO "anon";
GRANT ALL ON TABLE "public"."bill_edit_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_edit_grants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bill_edit_grants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bill_edit_grants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bill_edit_grants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bill_series" TO "anon";
GRANT ALL ON TABLE "public"."bill_series" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_series" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bill_series_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bill_series_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bill_series_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cash_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cash_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cash_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cash_voucher_counters" TO "anon";
GRANT ALL ON TABLE "public"."cash_voucher_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_voucher_counters" TO "service_role";



GRANT ALL ON TABLE "public"."credit_note_items" TO "anon";
GRANT ALL ON TABLE "public"."credit_note_items" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_note_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."credit_note_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."credit_note_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."credit_note_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."credit_notes" TO "anon";
GRANT ALL ON TABLE "public"."credit_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."credit_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."credit_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."credit_notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."credit_receipt_allocations" TO "anon";
GRANT ALL ON TABLE "public"."credit_receipt_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_receipt_allocations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."credit_receipt_allocations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."credit_receipt_allocations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."credit_receipt_allocations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."crm_customers" TO "anon";
GRANT ALL ON TABLE "public"."crm_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_customers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."crm_customers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."crm_customers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."crm_customers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_ledger" TO "anon";
GRANT ALL ON TABLE "public"."stock_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."current_stock" TO "anon";
GRANT ALL ON TABLE "public"."current_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."current_stock" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."customers_backup_before_merge" TO "anon";
GRANT ALL ON TABLE "public"."customers_backup_before_merge" TO "authenticated";
GRANT ALL ON TABLE "public"."customers_backup_before_merge" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customers_customer_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customers_customer_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customers_customer_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_cash_closing_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_cash_closing_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_cash_closing_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."damage_entries" TO "anon";
GRANT ALL ON TABLE "public"."damage_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."damage_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."damage_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."damage_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."damage_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_work_messages" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_work_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_work_messages" TO "service_role";



GRANT ALL ON TABLE "public"."hsn_codes" TO "anon";
GRANT ALL ON TABLE "public"."hsn_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."hsn_codes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hsn_codes_hsn_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hsn_codes_hsn_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hsn_codes_hsn_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoiceitems" TO "anon";
GRANT ALL ON TABLE "public"."invoiceitems" TO "authenticated";
GRANT ALL ON TABLE "public"."invoiceitems" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoiceitems_itemid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoiceitems_itemid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoiceitems_itemid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoices_invoiceid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoices_invoiceid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoices_invoiceid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."logins" TO "anon";
GRANT ALL ON TABLE "public"."logins" TO "authenticated";
GRANT ALL ON TABLE "public"."logins" TO "service_role";



GRANT ALL ON SEQUENCE "public"."logins_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."logins_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."logins_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."opening_stock" TO "anon";
GRANT ALL ON TABLE "public"."opening_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."opening_stock" TO "service_role";



GRANT ALL ON SEQUENCE "public"."opening_stock_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."opening_stock_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."opening_stock_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parties" TO "anon";
GRANT ALL ON TABLE "public"."parties" TO "authenticated";
GRANT ALL ON TABLE "public"."parties" TO "service_role";



GRANT ALL ON SEQUENCE "public"."parties_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."parties_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."parties_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payments_paymentid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payments_paymentid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payments_paymentid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."po_series" TO "anon";
GRANT ALL ON TABLE "public"."po_series" TO "authenticated";
GRANT ALL ON TABLE "public"."po_series" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."products_product_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."products_product_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."products_product_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_item_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_items_purchase_item_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_items_purchase_item_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_items_purchase_item_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_order_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_order_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_order_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_item_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_order_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_order_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_order_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_order_items_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_order_no_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_order_no_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_order_no_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_pending_view" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_pending_view" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_pending_view" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_report_view" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_report_view" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_report_view" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_return_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_return_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_return_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_return_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_return_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_return_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_return_item_details" TO "anon";
GRANT ALL ON TABLE "public"."purchase_return_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_return_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchase_return_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchase_return_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchase_return_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchases_purchase_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchases_purchase_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchases_purchase_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_compare_details" TO "anon";
GRANT ALL ON TABLE "public"."quotation_compare_details" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_compare_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotation_compare_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotation_compare_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotation_compare_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_compare_item_details" TO "anon";
GRANT ALL ON TABLE "public"."quotation_compare_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_compare_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotation_compare_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotation_compare_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotation_compare_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_details" TO "anon";
GRANT ALL ON TABLE "public"."quotation_details" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotation_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotation_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotation_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_item_details" TO "anon";
GRANT ALL ON TABLE "public"."quotation_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotation_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotation_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotation_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_series" TO "anon";
GRANT ALL ON TABLE "public"."quotation_series" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_series" TO "service_role";



GRANT ALL ON TABLE "public"."sales_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_item_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_order_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_order_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_order_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_order_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_order_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_order_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_order_item_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_order_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_order_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_order_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_order_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_order_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_packing_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_packing_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_packing_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_packing_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_packing_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_packing_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_packing_item_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_packing_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_packing_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_packing_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_packing_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_packing_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_return_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_return_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_return_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_return_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_return_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_return_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_return_item_details" TO "anon";
GRANT ALL ON TABLE "public"."sales_return_item_details" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_return_item_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_return_item_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_return_item_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_return_item_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_returns" TO "anon";
GRANT ALL ON TABLE "public"."sales_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_returns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_returns_salesreturnid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_returns_salesreturnid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_returns_salesreturnid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_items" TO "anon";
GRANT ALL ON TABLE "public"."stock_items" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_items" TO "service_role";



GRANT ALL ON TABLE "public"."stock_balance_view" TO "anon";
GRANT ALL ON TABLE "public"."stock_balance_view" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_balance_view" TO "service_role";



GRANT ALL ON TABLE "public"."stock_conversion_details" TO "anon";
GRANT ALL ON TABLE "public"."stock_conversion_details" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_conversion_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_conversion_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_conversion_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_conversion_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_conversion_items" TO "anon";
GRANT ALL ON TABLE "public"."stock_conversion_items" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_conversion_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_conversion_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_conversion_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_conversion_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_conversion_templates" TO "anon";
GRANT ALL ON TABLE "public"."stock_conversion_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_conversion_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_conversion_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_conversion_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_conversion_templates_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_items_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stock_ledger_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_ledger_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_ledger_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_ledger_view" TO "anon";
GRANT ALL ON TABLE "public"."stock_ledger_view" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_ledger_view" TO "service_role";



GRANT ALL ON TABLE "public"."stock_transaction_final" TO "anon";
GRANT ALL ON TABLE "public"."stock_transaction_final" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_transaction_final" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."suppliers_supplier_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."suppliers_supplier_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."suppliers_supplier_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_page_access" TO "anon";
GRANT ALL ON TABLE "public"."user_page_access" TO "authenticated";
GRANT ALL ON TABLE "public"."user_page_access" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_page_access_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_page_access_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_page_access_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."website_enquiries" TO "service_role";
GRANT INSERT ON TABLE "public"."website_enquiries" TO "anon";
GRANT SELECT,INSERT ON TABLE "public"."website_enquiries" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."website_enquiries_id_seq" TO "service_role";
GRANT SELECT,USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "anon";
GRANT SELECT,USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

SET local check_function_bodies = off;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

CREATE EVENT TRIGGER "ensure_rls"
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE FUNCTION "public"."rls_auto_enable"();

REVOKE ALL ON SEQUENCE "public"."website_enquiries_id_seq" FROM "anon";
GRANT SELECT, USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "anon";
REVOKE ALL ON SEQUENCE "public"."website_enquiries_id_seq" FROM "authenticated";
GRANT SELECT, USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "authenticated";
REVOKE ALL ON TABLE "public"."website_enquiries" FROM "anon";
GRANT INSERT ON TABLE "public"."website_enquiries" TO "anon";
REVOKE ALL ON TABLE "public"."website_enquiries" FROM "authenticated";
GRANT INSERT, SELECT ON TABLE "public"."website_enquiries" TO "authenticated";

CREATE TABLE IF NOT EXISTS public.product_image_ai_reviews (
    id bigint generated by default as identity primary key,
    item_code text not null,
    item_name text,
    brand text,
    decision text not null check (decision in ('accepted', 'rejected', 'ai_blocked', 'generated_accepted')),
    source_type text not null check (source_type in ('catalogue_crop', 'official_url', 'ai_generated', 'manual')),
    image_url text,
    image_sha256 text,
    catalogue_page integer,
    catalogue_code text,
    catalogue_confidence numeric(5,4),
    verification_verdict text,
    verification_confidence numeric(5,4),
    web_supported boolean not null default false,
    official_source_found boolean not null default false,
    verification_reason text,
    hard_conflicts jsonb not null default '[]'::jsonb,
    matched_attributes jsonb not null default '[]'::jsonb,
    evidence_sources jsonb not null default '[]'::jsonb,
    visual_observation jsonb not null default '{}'::jsonb,
    model_name text,
    reviewed_by uuid default auth.uid(),
    created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS product_image_ai_reviews_item_code_idx
    ON public.product_image_ai_reviews (item_code, created_at DESC);
CREATE INDEX IF NOT EXISTS product_image_ai_reviews_image_sha256_idx
    ON public.product_image_ai_reviews (image_sha256)
    WHERE image_sha256 IS NOT NULL;

ALTER TABLE public.product_image_ai_reviews ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.product_image_ai_reviews IS
    'Human and AI decisions used to audit and improve product image catalogue matching.';



































