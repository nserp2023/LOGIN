// Initialize Supabase
const supabaseClient = supabase.createClient("https://YOUR-PROJECT.supabase.co", "YOUR-ANON-KEY");

const form = document.getElementById("purchaseForm");
const banner = document.getElementById("banner");
const billNumberInput = document.getElementById("billNumber");
const entryDateInput = document.getElementById("entryDate");
const supplierNameInput = document.getElementById("supplierName");
const supplierGSTInput = document.getElementById("supplierGST");
const supplierNameDropdown = document.getElementById("supplierNameDropdown");
const supplierGSTDropdown = document.getElementById("supplierGSTDropdown");
const invoiceNumberInput = document.getElementById("invoiceNumber");
const invoiceDateInput = document.getElementById("invoiceDate");
const invoiceAmountInput = document.getElementById("invoiceAmount");
const roundOffInput = document.getElementById("roundOff");
const netPayableInput = document.getElementById("netPayable");
const purchaseTbody = document.getElementById("purchaseTbody");
const addProductBtn = document.getElementById("addProductBtn");

// Utility
function showBanner(msg, type) {
  banner.textContent = msg;
  banner.className = "banner banner-" + type;
  banner.style.display = "block";
}
function toNum(val) { return parseFloat(val) || 0; }

// Generate Bill Number
async function generateBillNumber() {
  const { data, error } = await supabaseClient
    .from("purchases")
    .select("id", { count: "exact" });
  if (error) { console.error(error); return "BILL-1"; }
  return "BILL-" + (data.length + 1);
}

// Add Product Row
function addProductRow() {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="itemCode"></td>
    <td><input class="productName"></td>
    <td><input type="number" class="qty" step="0.01" value="1"></td>
    <td><input type="number" class="rate" step="0.01"></td>
    <td><input type="number" class="gstPercent" step="0.01"></td>
    <td><input class="landingPrice" readonly></td>
    <td><input type="number" class="retailPercent" step="0.01"></td>
    <td><input class="retailPrice" readonly></td>
    <td><input class="retailPriceGST" readonly></td>
    <td><input type="number" class="wholesalePercent" step="0.01"></td>
    <td><input class="wholesalePrice" readonly></td>
    <td><input class="wholesalePriceGST" readonly></td>
    <td><input type="number" class="specialPercent" step="0.01"></td>
    <td><input class="specialPrice" readonly></td>
    <td><input class="specialPriceGST" readonly></td>
    <td><button type="button" class="removeBtn">X</button></td>
  `;
  purchaseTbody.appendChild(row);

  // Events
  row.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => recalcRow(row));
  });
  row.querySelector(".removeBtn").addEventListener("click", () => row.remove());
}

// Row Calculation
function recalcRow(row) {
  const qty = toNum(row.querySelector(".qty").value);
  const rate = toNum(row.querySelector(".rate").value);
  const gst = toNum(row.querySelector(".gstPercent").value);

  const landing = qty * rate * (1 + gst / 100);
  row.querySelector(".landingPrice").value = landing.toFixed(2);

  // Retail
  const rPct = toNum(row.querySelector(".retailPercent").value);
  const rPrice = landing * (1 + rPct / 100);
  row.querySelector(".retailPrice").value = rPrice.toFixed(2);
  row.querySelector(".retailPriceGST").value = (rPrice * (1 + gst / 100)).toFixed(2);

  // Wholesale
  const wPct = toNum(row.querySelector(".wholesalePercent").value);
  const wPrice = landing * (1 + wPct / 100);
  row.querySelector(".wholesalePrice").value = wPrice.toFixed(2);
  row.querySelector(".wholesalePriceGST").value = (wPrice * (1 + gst / 100)).toFixed(2);

  // Special
  const sPct = toNum(row.querySelector(".specialPercent").value);
  const sPrice = landing * (1 + sPct / 100);
  row.querySelector(".specialPrice").value = sPrice.toFixed(2);
  row.querySelector(".specialPriceGST").value = (sPrice * (1 + gst / 100)).toFixed(2);

  updateNetPayable();
}

// Net Payable
function updateNetPayable() {
  const total = Array.from(purchaseTbody.querySelectorAll(".landingPrice"))
    .reduce((sum, inp) => sum + toNum(inp.value), 0);
  const roundOff = toNum(roundOffInput.value);
  netPayableInput.value = (total + roundOff).toFixed(2);
}

// Collect Items
function collectItems() {
  return Array.from(purchaseTbody.querySelectorAll("tr")).map(row => ({
    item_code: row.querySelector(".itemCode").value,
    item_name: row.querySelector(".productName").value,
    qty: toNum(row.querySelector(".qty").value),
    rate: toNum(row.querySelector(".rate").value),
    gst_percent: toNum(row.querySelector(".gstPercent").value),
    landing_price: toNum(row.querySelector(".landingPrice").value),
    retail_percent: toNum(row.querySelector(".retailPercent").value),
    retail_price: toNum(row.querySelector(".retailPrice").value),
    retail_price_gst: toNum(row.querySelector(".retailPriceGST").value),
    wholesale_percent: toNum(row.querySelector(".wholesalePercent").value),
    wholesale_price: toNum(row.querySelector(".wholesalePrice").value),
    wholesale_price_gst: toNum(row.querySelector(".wholesalePriceGST").value),
    special_percent: toNum(row.querySelector(".specialPercent").value),
    special_price: toNum(row.querySelector(".specialPrice").value),
    special_price_gst: toNum(row.querySelector(".specialPriceGST").value),
  }));
}

// Save Purchase
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const purchase = {
      bill_number: billNumberInput.value,
      bill_date: entryDateInput.value,
      supplier_name: supplierNameInput.value,
      gst_number: supplierGSTInput.value,
      invoice_number: invoiceNumberInput.value,
      invoice_date: invoiceDateInput.value,
      invoice_amount: toNum(invoiceAmountInput.value),
      round_off: toNum(roundOffInput.value),
      net_payable: toNum(netPayableInput.value),
    };

    const { data: purchaseData, error } = await supabaseClient
      .from("purchases")
      .insert([purchase])
      .select()
      .single();
    if (error) throw error;

    const items = collectItems().map(it => ({ ...it, purchase_id: purchaseData.id }));
    const { error: itemError } = await supabaseClient.from("purchase_items").insert(items);
    if (itemError) throw itemError;

    showBanner("Purchase saved successfully!", "success");

    form.reset();
    entryDateInput.value = new Date().toISOString().split("T")[0];
    billNumberInput.value = await generateBillNumber();
    purchaseTbody.innerHTML = "";
    addProductRow();
    updateNetPayable();
  } catch (err) {
    console.error(err);
    showBanner("Error saving purchase: " + err.message, "error");
  }
});

// Init
(async () => {
  entryDateInput.value = new Date().toISOString().split("T")[0];
  billNumberInput.value = await generateBillNumber();
  addProductRow();
})();