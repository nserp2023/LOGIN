// Supabase v2 via CDN
const supabase = window.supabase;
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// Elements
const form = document.getElementById("purchaseForm");
const banner = document.getElementById("banner");

const billNumberInput = document.getElementById("billNumber");
const currentDateInput = document.getElementById("currentDate");
const invoiceDateInput = document.getElementById("invoiceDate");
const invoiceNumberInput = document.getElementById("invoiceNumber");

const supplierGSTInput = document.getElementById("supplierGST");
const gstDropdown = document.getElementById("gstDropdown");
const supplierNameInput = document.getElementById("supplierName");
const supplierDropdown = document.getElementById("supplierDropdown");

const invoiceAmountInput = document.getElementById("invoiceAmount");
const roundOffInput = document.getElementById("roundOff");
const netPayableInput = document.getElementById("netPayable");

const purchaseProductsBody = document.getElementById("purchaseProductsBody");
const addProductBtn = document.getElementById("addProductBtn");

// Helpers
function showBanner(message, type = "success") {
  banner.textContent = message;
  banner.className = `banner banner-${type}`;
  banner.style.display = "block";
  setTimeout(() => { banner.style.display = "none"; }, 3000);
}
function toNum(v) { return parseFloat(v) || 0; }

// Init
document.addEventListener("DOMContentLoaded", async () => {
  currentDateInput.value = new Date().toISOString().split("T")[0];
  billNumberInput.value = await generateBillNumber();
  addProductRow(); // start with one row
});

// Bill number generator (robust)
async function generateBillNumber() {
  const { data, error } = await supabaseClient
    .from("purchases")
    .select("bill_number")
    .order("purchase_id", { ascending: false })
    .limit(50);
  if (error || !data || data.length === 0) return "BILL-001";

  let lastValid = null;
  for (const row of data) {
    const match = row.bill_number && row.bill_number.match(/^BILL-(\d+)$/);
    if (match) { lastValid = parseInt(match[1]); break; }
  }
  if (!lastValid) return "BILL-001";
  const nextNum = lastValid + 1;
  return `BILL-${String(nextNum).padStart(3, "0")}`;
}

// Supplier search by GST
supplierGSTInput.addEventListener("input", async () => {
  const term = supplierGSTInput.value.trim();
  if (!term) { gstDropdown.innerHTML = ""; return; }
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*")
    .ilike("gst_number", `%${term}%`)
    .limit(20);
  if (error) return console.error(error);
  gstDropdown.innerHTML = "";
  data.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.supplier_id;
    opt.textContent = `${s.gst_number} — ${s.supplier_name}`;
    gstDropdown.appendChild(opt);
  });
});
gstDropdown.addEventListener("change", async () => {
  const id = gstDropdown.value;
  if (!id) return;
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*")
    .eq("supplier_id", id)
    .single();
  if (error || !data) return;
  supplierGSTInput.value = data.gst_number || "";
  supplierNameInput.value = data.supplier_name || "";
});

// Supplier search by name
supplierNameInput.addEventListener("input", async () => {
  const term = supplierNameInput.value.trim();
  if (!term) { supplierDropdown.innerHTML = ""; return; }
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*")
    .ilike("supplier_name", `%${term}%`)
    .limit(20);
  if (error) return console.error(error);
  supplierDropdown.innerHTML = "";
  data.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.supplier_id;
    opt.textContent = `${s.supplier_name} — GST ${s.gst_number}`;
    supplierDropdown.appendChild(opt);
  });
});
supplierDropdown.addEventListener("change", async () => {
  const id = supplierDropdown.value;
  if (!id) return;
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*")
    .eq("supplier_id", id)
    .single();
  if (error || !data) return;
  supplierGSTInput.value = data.gst_number || "";
  supplierNameInput.value = data.supplier_name || "";
});

// Amount & round off → net payable
function updateNetPayable() {
  const inv = toNum(invoiceAmountInput.value);
  const roff = toNum(roundOffInput.value);
  netPayableInput.value = (inv + roff).toFixed(2);
}
invoiceAmountInput.addEventListener("input", updateNetPayable);
roundOffInput.addEventListener("input", updateNetPayable);

// Product row management
addProductBtn.addEventListener("click", addProductRow);

function addProductRow() {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>
      <input type="text" class="itemCode" placeholder="ITEM-001">
      <button type="button" class="lookupItemCode">Find</button>
    </td>
    <td>
      <input type="text" class="productName" placeholder="Type name…">
      <button type="button" class="lookupProductName">Find</button>
    </td>
    <td><input type="number" class="qty" step="1" min="0" value="1"></td>
    <td><input type="number" class="rate" step="0.01" min="0" value="0.00"></td>
    <td><input type="number" class="amount" step="0.01" readonly></td>
    <td><button type="button" class="removeBtn">Remove</button></td>
  `;
  purchaseProductsBody.appendChild(row);

  const qtyEl = row.querySelector(".qty");
  const rateEl = row.querySelector(".rate");
  const amountEl = row.querySelector(".amount");
  const removeBtn = row.querySelector(".removeBtn");
  const lookupItemBtn = row.querySelector(".lookupItemCode");
  const lookupNameBtn = row.querySelector(".lookupProductName");
  const itemCodeEl = row.querySelector(".itemCode");
  const productNameEl = row.querySelector(".productName");

  function updateAmount() {
    const qty = toNum(qtyEl.value);
    const rate = toNum(rateEl.value);
    amountEl.value = (qty * rate).toFixed(2);
    // also update invoice amount total
    recomputeInvoiceAmount();
  }

  qtyEl.addEventListener("input", updateAmount);
  rateEl.addEventListener("input", updateAmount);
  removeBtn.addEventListener("click", () => { row.remove(); recomputeInvoiceAmount(); });

  // Lookup by item code → fill product name & rate (use retail_price_gst as default)
  lookupItemBtn.addEventListener("click", async () => {
    const code = itemCodeEl.value.trim();
    if (!code) return;
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("item_code", code)
      .single();
    if (error || !data) { showBanner("Product not found by item code.", "warning"); return; }
    productNameEl.value = data.item_name || "";
    rateEl.value = (data.purchase_price_gst || data.retail_price_gst || 0).toFixed(2);
    updateAmount();
  });

  // Lookup by product name (first match)
  lookupNameBtn.addEventListener("click", async () => {
    const name = productNameEl.value.trim();
    if (!name) return;
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .ilike("item_name", `%${name}%`)
      .limit(1);
    if (error || !data || data.length === 0) { showBanner("Product not found by name.", "warning"); return; }
    const p = data[0];
    itemCodeEl.value = p.item_code || "";
    rateEl.value = (p.purchase_price_gst || p.retail_price_gst || 0).toFixed(2);
    updateAmount();
  });

  // initial compute
  updateAmount();
}

function recomputeInvoiceAmount() {
  let total = 0;
  document.querySelectorAll("#purchaseProductsBody .amount").forEach(a => {
    total += toNum(a.value);
  });
  invoiceAmountInput.value = total.toFixed(2);
  updateNetPayable();
}

// Save purchase → purchases + purchase_items
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Basic validation
  const supplierName = supplierNameInput.value.trim();
  const supplierGST = supplierGSTInput.value.trim();
  if (!supplierName || !supplierGST) {
    showBanner("Please select a supplier (GST & name).", "warning");
    return;
  }
  const items = collectItems();
  if (items.length === 0) {
    showBanner("Add at least one product row.", "warning");
    return;
  }

  const payloadPurchase = {
    bill_number: billNumberInput.value.trim(),
    current_date: currentDateInput.value,
    invoice_date: invoiceDateInput.value,
    invoice_number: invoiceNumberInput.value.trim(),
    supplier_name: supplierName,
    supplier_gst: supplierGST,
    invoice_amount: toNum(invoiceAmountInput.value),
    round_off: toNum(roundOffInput.value),
    net_payable: toNum(netPayableInput.value)
  };

  try {
    // Insert purchase
    const { data: purchaseData, error: purchaseError } = await supabaseClient
      .from("purchases")
      .insert([payloadPurchase])
      .select("purchase_id")
      .single();
    if (purchaseError) throw purchaseError;

    const purchaseId = purchaseData.purchase_id;

    // Insert items
    const itemsPayload = items.map(it => ({
      purchase_id: purchaseId,
      item_code: it.item_code,
      item_name: it.item_name,
      qty: it.qty,
      rate: it.rate,
      amount: it.amount
    }));

    const { error: itemsError } = await supabaseClient
      .from("purchase_items")
      .insert(itemsPayload);
    if (itemsError) throw itemsError;

    showBanner("Purchase saved successfully!", "success");
    // Reset form for next entry
    form.reset();
    currentDateInput.value = new Date().toISOString().split("T")[0];
    billNumberInput.value = await generateBillNumber();
    purchaseProductsBody.innerHTML = "";
    addProductRow();
    updateNetPayable();
  } catch (err) {
    console.error(err);
    showBanner("Error saving purchase: " + err.message, "error");
  }
});

function collectItems() {
  const rows = Array.from(document.querySelectorAll("#purchaseProductsBody tr"));
  return rows.map(row => {
    const item_code = row.querySelector(".itemCode").value.trim();
    const item_name = row.querySelector(".productName").value.trim();
    const qty = toNum(row.querySelector(".qty").value);
    const rate = toNum(row.querySelector(".rate").value);
    const amount = toNum(row.querySelector(".amount").value);
    return { item_code, item_name, qty, rate, amount };
  }).filter(it => it.item_name || it.item_code);
}