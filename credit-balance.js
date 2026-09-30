(function(){
    const cleanValue=value=>String(value||'').trim();
    const digitsOnly=value=>cleanValue(value).replace(/\D/g,'').slice(-10);
    const normalizedName=value=>cleanValue(value).toLowerCase().replace(/\s+/g,' ');
    const normalized=value=>cleanValue(value).toLowerCase().replace(/[-_\s]+/g,' ');
    const numberValue=value=>Number(value||0)||0;
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
    const addEntry=(account,type,date,document,amount,remark)=>account.entries.push({type,date:date||'',doc:document||'',amount:numberValue(amount),remark:remark||''});
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
        const getAccount=(name,mobile)=>{
            const accountName=normalizedName(name), mobileDigits=digitsOnly(mobile);
            if(accountName&&mobileDigits){
                if(!customerMobileAliases.has(accountName))customerMobileAliases.set(accountName,new Set());
                customerMobileAliases.get(accountName).add(mobileDigits);
            }
            const existing=findAccount(accounts,name,mobile);
            if(existing)return existing;
            const account={key:accountKey(name,mobile),name:cleanValue(name)||'-',mobile:digitsOnly(mobile)||'-',bills:0,billAmount:0,payments:0,receipts:0,advances:0,returns:0,entries:[]};
            accounts.set(account.key,account);
            return account;
        };
        let salesQuery=window.sbcc.from('sales_details').select('id,bill_date,series_code,sales_number,customer_name,customer_mobile,invoice_amount,credit_bill_amount,payment_type,salesman').in('payment_type',['CREDIT','ADVANCE CREDIT']);
        if(from)salesQuery=salesQuery.gte('bill_date',from);
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
            account.bills++;
            account.billAmount+=amount;
            addEntry(account,'bill',row.bill_date,pack?`${pack.series_code||row.series_code||''}-${pack.packing_number||row.sales_number||''}`:`${row.series_code||''}-${row.sales_number||''}`,amount,pack?'Sales + Packing credit bill':'Credit bill');
        });
        const searchedCustomers=[];
        if(search){
            const searchDigits=digitsOnly(search);
            let customerQuery=window.sbcc.from('customers').select('name,mobile');
            customerQuery=searchDigits.length>=3?customerQuery.ilike('mobile',`%${searchDigits}%`):customerQuery.ilike('name',`%${search}%`);
            const customerResult=await customerQuery.limit(50);
            if(!customerResult.error){
                searchedCustomers.push(...(customerResult.data||[]));
                searchedCustomers.forEach(row=>{
                    const account=getAccount(row.name,row.mobile);
                    if(cleanValue(row.name))account.name=cleanValue(row.name);
                });
            }
        }
        const searchedCustomerNames=new Set(searchedCustomers.map(row=>normalizedName(row.name)).filter(Boolean));
        const searchedCustomerMobiles=new Set(searchedCustomers.map(row=>digitsOnly(row.mobile)).filter(Boolean));
        for(let page=0;;page++){
            const cashResult=await window.sbcc.from('cash_transactions').select('txn_date,voucher_no,txn_type,party_name,amount,remarks,reference_type,approval_status').range(page*1000,page*1000+999);
            if(cashResult.error)throw cashResult.error;
            (cashResult.data||[]).forEach(row=>{
                const date=String(row.txn_date||'').slice(0,10);
                if(from&&date&&date<from)return;
                if(to&&date&&date>to)return;
                if(normalized(row.approval_status)!=='approved')return;
                const party=cleanValue(row.party_name), partyDigits=digitsOnly(party), knownMobiles=customerMobileAliases.get(normalizedName(party));
                const aliasMobile=!partyDigits&&knownMobiles&&knownMobiles.size===1?[...knownMobiles][0]:'';
                const accountMobile=partyDigits||aliasMobile;
                const savedCustomerPayment=normalized(row.txn_type)==='payment'&&(
                    (accountMobile&&searchedCustomerMobiles.has(accountMobile))||searchedCustomerNames.has(normalizedName(party))
                );
                const type=classifyCash(row)||(savedCustomerPayment?'payment':'');
                if(!type)return;
                const accountName=/^[0-9+\-\s]+$/.test(party);
                const account=accountMobile?findAccount(accounts,'',accountMobile):findAccount(accounts,party,'');
                if(accountMobile&&!account)return;
                const target=account||getAccount(accountName?'':party,'');
                const amount=numberValue(row.amount);
                if(type==='payment')target.payments+=amount;
                if(type==='receipt')target.receipts+=amount;
                if(type==='advance')target.advances+=amount;
                addEntry(target,type,row.txn_date,row.voucher_no,amount,row.remarks);
            });
            if((cashResult.data||[]).length<1000)break;
        }
        let returnQuery=window.sbcc.from('sales_return_details').select('id,return_date,customer_name,customer_mobile,approval_status,is_accepted,return_payment_type,settlement_mode,credit_adjustment_amount,total_return_amount');
        if(from)returnQuery=returnQuery.gte('return_date',from);
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
            account.returns+=amount;
            addEntry(account,'return',row.return_date,`SR-${row.id}`,amount,'Accepted credit return');
        });
        return accounts;
    };
    window.canonicalCreditBalance=account=>account.billAmount+account.payments-account.receipts-account.advances-account.returns;
})();
