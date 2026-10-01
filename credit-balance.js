(function(){
    const cleanValue=value=>String(value||'').trim();
    const digitsOnly=value=>cleanValue(value).replace(/\D/g,'').slice(-10);
    const normalizedName=value=>cleanValue(value).toLowerCase().replace(/\s+/g,' ');
    const normalized=value=>cleanValue(value).toLowerCase().replace(/[-_\s]+/g,' ');
    const numberValue=value=>Number(value||0)||0;
    const inPeriod=(date,from,to)=>{const value=String(date||'').slice(0,10);return (!from||!value||value>=from)&&(!to||!value||value<=to)};
    const accountKey=(name,mobile)=>`${digitsOnly(mobile)}|${normalizedName(name)}`;
    const billAmount=row=>{
        const preserved=Number(row.credit_bill_amount);
        return cleanValue(row.salesman).toUpperCase()==='VAJRA'&&Number.isFinite(preserved)&&preserved>=0
            ? preserved : numberValue(row.invoice_amount);
    };
    const returnAmount=row=>numberValue(row.credit_adjustment_amount||row.total_return_amount);
    const acceptedReturn=row=>row.is_accepted===true||normalized(row.approval_status)==='approved';
    const returnType=row=>normalized(row.return_payment_type||row.settlement_mode||'');
    const classifyCash=row=>{
        const type=normalized(row.txn_type), ref=normalized(row.reference_type);
        const text=normalized(`${row.remarks||''} ${row.reference_type||''}`);
        const refund=type==='payment'&&(ref==='customer credit refund'||ref==='customer payment'||text.includes('refund of customer negative credit balance')||text.includes('customer credit refund')||text.includes('refund return amount'));
        const receipt=type==='receipt'&&(['sales credit','sales pack credit','customer credit auto','customer credit refund'].includes(ref)||text.includes('credit collection')||text.includes('auto alloc'));
        const advance=type==='receipt'&&(['customer advance','sales order','sales order advance','sales order advance receipt','sales order conversion receipt'].includes(ref)||text.includes('sales order advance')||text.includes('advance received')||text.includes('advance paid')||text.includes('advance credit receipt'));
        return refund?'payment':receipt?'receipt':advance?'advance':'';
    };
    const addEntry=(account,type,date,document,amount,remark,from,to)=>{
        const value=numberValue(amount),entryDate=String(date||'').slice(0,10);
        account.entries.push({type,date:entryDate,doc:document||'',amount:value,remark:remark||''});
        if(!inPeriod(entryDate,from,to))return;
        if(type==='bill'){account.bills++;account.billAmount+=value}
        else if(type==='payment')account.payments+=value;
        else if(type==='receipt')account.receipts+=value;
        else if(type==='advance')account.advances+=value;
        else if(type==='return')account.returns+=value;
    };
    const findAccount=(accounts,name,mobile)=>{
        const mobileDigits=digitsOnly(mobile), nameValue=normalizedName(name);
        if(mobileDigits){
            for(const account of accounts.values())if(account.mobile===mobileDigits)return account;
            return null;
        }
        if(!nameValue)return null;
        const matches=[...accounts.values()].filter(account=>normalizedName(account.name)===nameValue);
        return matches.length===1?matches[0]:null;
    };
    window.loadCanonicalCreditAccounts=async function(options={}){
        const from=options.from||'', to=options.to||'', search=cleanValue(options.search);
        const accounts=new Map();
        const customerMobileAliases=new Map();
        const customerMobilesByName=new Map();
        const customerNamesByMobile=new Map();
        const customerMobileNumbers=new Set();
        try{
            const customerRows=[];
            for(let page=0;;page++){
                const result=await window.sbcc.from('customers').select('name,mobile').range(page*1000,page*1000+999);
                if(result.error)throw result.error;
                customerRows.push(...(result.data||[]));
                if((result.data||[]).length<1000)break;
            }
            const mobilesByName=new Map();
            const namesByMobile=new Map();
            customerRows.forEach(row=>{
                const customerName=cleanValue(row.name), name=normalizedName(customerName), mobile=digitsOnly(row.mobile);
                if(!mobile)return;
                customerMobileNumbers.add(mobile);
                if(!name)return;
                if(!mobilesByName.has(name))mobilesByName.set(name,new Set());
                mobilesByName.get(name).add(mobile);
                if(!namesByMobile.has(mobile))namesByMobile.set(mobile,new Map());
                namesByMobile.get(mobile).set(name,customerName);
            });
            mobilesByName.forEach((mobiles,name)=>{
                if(mobiles.size===1)customerMobilesByName.set(name,[...mobiles][0]);
            });
            namesByMobile.forEach((names,mobile)=>{
                if(names.size===1)customerNamesByMobile.set(mobile,[...names.values()][0]);
            });
        }catch(error){
            console.warn('Credit balance customer mobile lookup failed:',error);
        }
        const getAccount=(name,mobile)=>{
            const providedName=cleanValue(name), nameDigits=digitsOnly(providedName);
            const nameIsMobile=/^[+0-9() .-]+$/.test(providedName)&&nameDigits.length===10;
            const originalName=nameIsMobile?'':providedName;
            const accountName=normalizedName(originalName);
            const mobileDigits=digitsOnly(mobile)||(nameIsMobile?nameDigits:'')||customerMobilesByName.get(accountName)||'';
            const resolvedName=originalName||customerNamesByMobile.get(mobileDigits)||'';
            if(accountName&&mobileDigits){
                if(!customerMobileAliases.has(accountName))customerMobileAliases.set(accountName,new Set());
                customerMobileAliases.get(accountName).add(mobileDigits);
            }
            const existing=findAccount(accounts,resolvedName,mobileDigits);
            if(existing){
                const existingName=cleanValue(existing.name), existingNameDigits=digitsOnly(existingName);
                const existingNameIsMobile=/^[+0-9() .-]+$/.test(existingName)&&existingNameDigits.length===10;
                if((!existingName||existingName==='-'||existingNameIsMobile)&&resolvedName)existing.name=resolvedName;
                return existing;
            }
            const account={key:accountKey(resolvedName,mobileDigits),name:resolvedName||'-',mobile:mobileDigits||'-',bills:0,billAmount:0,payments:0,receipts:0,advances:0,returns:0,entries:[]};
            accounts.set(account.key,account);
            return account;
        };
        let salesQuery=window.sbcc.from('sales_details').select('id,bill_date,series_code,sales_number,customer_name,customer_mobile,invoice_amount,credit_bill_amount,payment_type,salesman').in('payment_type',['CREDIT','ADVANCE CREDIT']);
        if(to)salesQuery=salesQuery.lte('bill_date',to);
        const sales=[];
        for(let page=0;;page++){
            const salesResult=await salesQuery.range(page*1000,page*1000+999);
            if(salesResult.error)throw salesResult.error;
            sales.push(...(salesResult.data||[]));
            if((salesResult.data||[]).length<1000)break;
        }
        const salesIds=sales.map(row=>row.id).filter(Boolean), packing=new Map();
        for(let offset=0;offset<salesIds.length;offset+=500){
            const packingResult=await window.sbcc.from('sales_packing_details').select('sales_id,packing_amount,packing_number,series_code').in('sales_id',salesIds.slice(offset,offset+500));
            if(!packingResult.error)(packingResult.data||[]).forEach(row=>packing.set(String(row.sales_id),row));
        }
        sales.forEach(row=>{
            const account=getAccount(row.customer_name,row.customer_mobile), pack=packing.get(String(row.id));
            const amount=pack&&numberValue(pack.packing_amount)>0?numberValue(pack.packing_amount):billAmount(row);
            addEntry(account,'bill',row.bill_date,pack?`${pack.series_code||row.series_code||''}-${pack.packing_number||row.sales_number||''}`:`${row.series_code||''}-${row.sales_number||''}`,amount,pack?'Sales + Packing credit bill':'Credit bill',from,to);
        });
        const cashRows=[];
        for(let page=0;;page++){
            const cashResult=await window.sbcc.from('cash_transactions').select('id,reference_id,customer_mobile,txn_date,voucher_no,txn_type,party_name,amount,remarks,reference_type,approval_status').range(page*1000,page*1000+999);
            if(cashResult.error)throw cashResult.error;
            cashRows.push(...(cashResult.data||[]));
            if((cashResult.data||[]).length<1000)break;
        }
        const cashById=new Map(cashRows.map(row=>[String(row.id),row]));
        const salesReferenceIds=[...new Set(cashRows.filter(row=>row.reference_id&&['sales_credit','sales_pack_credit','sales_order_conversion_receipt'].includes(normalized(row.reference_type).replace(/[-\s]+/g,'_'))).map(row=>row.reference_id))];
        const orderReferenceIds=[...new Set(cashRows.filter(row=>row.reference_id&&['sales_order','sales_order_advance','sales_order_advance_receipt'].includes(normalized(row.reference_type).replace(/[-\s]+/g,'_'))).map(row=>row.reference_id))];
        const loadContacts=async(table,ids)=>{
            const contacts=new Map();
            for(let offset=0;offset<ids.length;offset+=500){
                const result=await window.sbcc.from(table).select('id,customer_name,customer_mobile').in('id',ids.slice(offset,offset+500));
                if(result.error){console.warn(`Credit balance ${table} contact lookup failed:`,result.error);continue;}
                (result.data||[]).forEach(row=>contacts.set(String(row.id),row));
            }
            return contacts;
        };
        const [salesContacts,orderContacts]=await Promise.all([
            loadContacts('sales_details',salesReferenceIds),
            loadContacts('sales_order_details',orderReferenceIds)
        ]);
        cashRows.forEach(row=>{
                const date=String(row.txn_date||'').slice(0,10);
                if(to&&date&&date>to)return;
                if(normalized(row.approval_status)!=='approved')return;
                const referenceType=normalized(row.reference_type).replace(/[-\s]+/g,'_');
                const parent=cashById.get(String(row.reference_id||''));
                if(referenceType==='customer_advance'&&parent&&normalized(parent.approval_status)==='approved'&&normalized(parent.txn_type)==='receipt'&&normalized(parent.reference_type).replace(/[-\s]+/g,'_')==='customer_credit_auto')return;
                const linkedContact=referenceType==='sales_order_advance'||referenceType==='sales_order'||referenceType==='sales_order_advance_receipt'
                    ? orderContacts.get(String(row.reference_id))||salesContacts.get(String(row.reference_id))
                    : salesContacts.get(String(row.reference_id))||orderContacts.get(String(row.reference_id));
                const party=cleanValue(row.party_name), partyDigits=digitsOnly(party), knownMobiles=customerMobileAliases.get(normalizedName(party));
                const aliasMobile=!partyDigits&&(knownMobiles&&knownMobiles.size===1?[...knownMobiles][0]:customerMobilesByName.get(normalizedName(party))||'');
                const accountMobile=digitsOnly(row.customer_mobile)||digitsOnly(linkedContact?.customer_mobile)||digitsOnly(parent?.customer_mobile)||partyDigits||aliasMobile;
                const knownAccount=accountMobile?findAccount(accounts,'',accountMobile):findAccount(accounts,party,'');
                const knownCustomer=Boolean(accountMobile&&customerMobileNumbers.has(accountMobile));
                const savedCustomerPayment=normalized(row.txn_type)==='payment'&&(knownCustomer||Boolean(knownAccount));
                const manualCreditReceipt=normalized(row.txn_type)==='receipt'&&referenceType==='manual_receipt'&&(knownCustomer||Boolean(knownAccount));
                const type=classifyCash(row)||(savedCustomerPayment?'payment':manualCreditReceipt?'receipt':'');
                if(!type)return;
                const accountName=/^[0-9+\-\s]+$/.test(party);
                const accountNameValue=linkedContact?.customer_name||(accountName?'':party);
                const target=knownAccount||getAccount(accountNameValue,accountMobile);
                const amount=numberValue(row.amount);
                addEntry(target,type,row.txn_date,row.voucher_no,amount,row.remarks,from,to);
        });
        let returnQuery=window.sbcc.from('sales_return_details').select('id,return_date,customer_name,customer_mobile,approval_status,is_accepted,return_payment_type,settlement_mode,credit_adjustment_amount,total_return_amount');
        if(to)returnQuery=returnQuery.lte('return_date',to);
        const returns=[];
        for(let page=0;;page++){
            const returnResult=await returnQuery.range(page*1000,page*1000+999);
            if(returnResult.error)throw returnResult.error;
            returns.push(...(returnResult.data||[]));
            if((returnResult.data||[]).length<1000)break;
        }
        returns.forEach(row=>{
            if(!acceptedReturn(row)||returnType(row)!=='credit')return;
            const account=getAccount(row.customer_name,row.customer_mobile), amount=returnAmount(row);
            addEntry(account,'return',row.return_date,`SR-${row.id}`,amount,'Accepted credit return',from,to);
        });
        if(search){
            const searchDigits=digitsOnly(search);
            let customerQuery=window.sbcc.from('customers').select('name,mobile');
            customerQuery=searchDigits.length>=3?customerQuery.ilike('mobile',`%${searchDigits}%`):customerQuery.ilike('name',`%${search}%`);
            const customerResult=await customerQuery.limit(50);
            if(!customerResult.error)(customerResult.data||[]).forEach(row=>{
                const account=getAccount(row.name,row.mobile);
                if(cleanValue(row.name))account.name=cleanValue(row.name);
            });
        }
        accounts.forEach(account=>{
            const savedName=customerNamesByMobile.get(digitsOnly(account.mobile));
            const currentName=cleanValue(account.name), currentNameDigits=digitsOnly(currentName);
            const nameIsMobile=/^[+0-9() .-]+$/.test(currentName)&&currentNameDigits.length===10;
            if(savedName&&(!currentName||currentName==='-'||nameIsMobile))account.name=savedName;
        });
        return accounts;
    };
    window.canonicalCreditBalance=account=>account.billAmount+account.payments-account.receipts-account.advances-account.returns;
})();
