<script>
// Initialize Supabase
const supabaseClient = supabase.createClient(
  "https://gqxczzijntbvtlmmzppt.supabase.co",
  "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs"
);

const form = document.getElementById("purchaseForm");
const banner = document.getElementById("banner");
const billNumberInput = document.getElementById("billNumber");
const entryDateInput = document.getElementById("entryDate");
const supplierNameInput = document.getElementById("supplierNameInput");
const supplierGSTInput = document.getElementById("supplierGSTInput");
const supplierNameList = document.getElementById("supplierNameList");
const supplierGSTList = document.getElementById("supplierGSTList");
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
  const { count, error } = await supabaseClient
    .from("purchases")
    .select("*", { count: "exact", head: true });
  if (error) { console.error(error); return "BILL-001"; }
  const next = (count || 0) + 1;
  return "BILL-" + next.toString().padStart(3, "0");
}

// Load Suppliers with merged fields
async function loadSuppliers() {
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*");

  if (error) {
    console.error("Error loading suppliers:", error);
    showBanner("Could not load suppliers.", "error");
    return;
  }
  if (!Array.isArray(data)) return;

  const nameKey = data.length && ("supplier_name" in data[0] ? "supplier_name" : "name");
  const gstKey  = data.length && ("supplier_gst" in data[0] ? "supplier_gst" : "gst_number");

  if (!nameKey || !gstKey) {
    console.error("Suppliers table missing expected columns. Found keys:", data[0] ? Object.keys(data[0]) : []);
    showBanner("Suppliers table missing name/gst columns.", "error");
    return;
  }

  const suppliersList = data;

  supplierNameList.innerHTML = "";
  supplierGSTList.innerHTML = "";

  suppliersList.forEach(supplier => {
    const nameOption = document.createElement("option");
    nameOption.value = supplier[nameKey] ?? "";
    supplierNameList.appendChild(nameOption);

    const gstOption = document.createElement("option");
    gstOption.value = supplier[gstKey] ?? "";
    supplierGSTList.appendChild(gstOption);
  });

  supplierNameInput.addEventListener("change", () => {
    const match = suppliersList.find(s => s[nameKey] === supplierNameInput.value);
    if (match) supplierGSTInput.value = match[gstKey];
  });

  supplierGSTInput.addEventListener("change", () => {
    const match = suppliersList.find(s => s[gstKey] === supplierGSTInput.value);
    if (match) supplierNameInput.value = match[nameKey];
  });
}

// Add Product Row
function addProductRow() {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="itemCode"></td>
    <td><input class="productName"></td>
    <td><input type="number" class="qty" step="0.01" value="1"></td>
    <td><input type="number" class="price" step="0.01"></td>
    <td><input type="number" class="discountPercent" step="0.01"></td>
    <td><input type="number" class="total" step="0.01" readonly></td>
    <td><input type="number" class="gstPercent" step="0.01"></td>
    <td><input type="number" class="totalWithGST" step="0.01" readonly></td>
    <td><input type="number" class="purchasePrice" step="0.01" readonly></td>
    <td><input type="number" class="purchaseWithGST" step="0.01" readonly></td>
    <td><input type="number" class="landingPrice" step="0.01"></td>
    <td><input type="number" class="landingPriceWithGST" step="0.01" readonly></td>
    <td><input type="number" class="retailPercent" step="0.01"></td>
    <td><input type="number" class="retailPrice" step="0.01" readonly></td>
    <td><input type="number" class="retailWithGST" step="0.01" readonly></td>
    <td><input type="number" class="wholesalePercent" step="0.01"></td>
    <td><input type="number" class="wholesalePrice" step="0.01" readonly></td>
    <td><input type="number" class="wholesaleWithGST" step="0.01" readonly></td>
    <td><input type="number" class="specialPercent" step="0.01"></td>
    <td><input type="number" class="specialPrice" step="0.01" readonly></td>
    <td><input type="number" class="specialWithGST" step="0.01" readonly></td>
    <td><button type="button" class="removeBtn">X</button></td>
  `;
  purchaseTbody.appendChild(row);

  const getNum = (sel) => {
    const el = row.querySelector(sel);
    const v = el.valueAsNumber;
    return Number.isFinite(v) ? v : 0;
  };

  // Manual override flag
  let landingPriceManual = false;

  function recalc() {
    const qty = getNum(".qty");
    const price = getNum(".price");
    const discountPercent = getNum(".discountPercent");
    const gstPercent = getNum(".gstPercent");

    const retailPercent = getNum(".retailPercent");
    const wholesalePercent = getNum(".wholesalePercent");
    const specialPercent = getNum(".specialPercent");

    let grossTotal = qty * price;
    let netTotal = grossTotal - (grossTotal * discountPercent / 100);
    row.querySelector(".total").value = netTotal.toFixed(2);

    const gstMultiplier = 1 + gstPercent / 100;
    const totalWithGST = netTotal * gstMultiplier;
    row.querySelector(".totalWithGST").value = totalWithGST.toFixed(2);

    let purchasePrice = qty > 0 ? netTotal / qty : 0;
    row.querySelector(".purchasePrice").value = purchasePrice.toFixed(2);

    const purchaseWithGST = Number.isFinite(purchasePrice) ? purchasePrice * gstMultiplier : null;
    row.querySelector(".purchaseWithGST").value = purchaseWithGST ? purchaseWithGST.toFixed(2) : "";

    // Landing Price logic with manual override
    let landingPrice = landingPriceManual 
      ? getNum(".landingPrice") 
      : (qty > 0 ? netTotal / qty : 0);

    row.querySelector(".landingPrice").value = landingPrice.toFixed(2);

    const landingWithGST = Number.isFinite(landingPrice) ? landingPrice * gstMultiplier : null;
    row.querySelector(".landingPriceWithGST").value = landingWithGST ? landingWithGST.toFixed(2) : "";

    const retailPrice = purchasePrice * (1 + retailPercent / 100);
    row.querySelector(".retailPrice").value = retailPrice.toFixed(2);
    row.querySelector(".retailWithGST").value = (retailPrice * gstMultiplier).toFixed(2);

    const wholesalePrice = purchasePrice * (1 + wholesalePercent / 100);
    row.querySelector(".wholesalePrice").value = wholesalePrice.toFixed(2);
    row.querySelector(".wholesaleWithGST").value = (wholesalePrice * gstMultiplier).toFixed(2);

    const specialPrice = purchasePrice * (1 + specialPercent / 100);
    row.querySelector(".specialPrice").value = specialPrice.toFixed(2);
    row.querySelector(".specialWithGST").value = (specialPrice * gstMultiplier).toFixed(2);

    updateNetPayable();
  }

  // Event listeners
  [
    ".qty", ".price", ".discountPercent", ".gstPercent",
    ".retailPercent", ".wholesalePercent", ".specialPercent"
  ].forEach(sel => {
    row.querySelector(sel).addEventListener("input", recalc);
  });

  // Manual override for Landing Price
  row.querySelector(".landingPrice").addEventListener("input", () => {
    landingPriceManual = true;
    const landingPrice = getNum(".landingPrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;
    row.querySelector(".landingPriceWithGST").value = (landingPrice * gstMultiplier).toFixed(2);
    updateNetPayable();
  });

  row.querySelector(".removeBtn").addEventListener("click", () => {
    row.remove();
    updateNetPayable();
  });

  recalc();
  row.querySelector(".itemCode").focus();
}

// Net Payable
function updateNetPayable() {
  const rows = Array.from(purchaseTbody.querySelectorAll("tr"));
  const totalWithGSTSum = rows.reduce((sum, row) => {
    const rowTotal = toNum(row.querySelector(".totalWithGST").value);
    return sum + rowTotal;
  }, 0);

  const roundOff = toNum(roundOffInput.value);
  netPayableInput.value = (totalWithGSTSum + roundOff).toFixed(2);
}

// Collect Items
function collectItems(purchase_id) {
  return Array.from(purchaseTbody.querySelectorAll("tr")).map(row => {
    return {
      purchase_id: purchase_id,
      item_code: row.querySelector(".itemCode").value,
      product_name: row.querySelector(".productName").value,
      quantity: toNum(row.querySelector(".qty").value),
      price: toNum(row.querySelector(".price").value),
      discount_percent: toNum(row.querySelector(".discountPercent").value),
      total_before_gst: toNum(row.querySelector(".total").value),
      gst_percent: toNum(row.querySelector(".gstPercent").value),
      total_with_gst: toNum(row.querySelector(".totalWithGST").value),
      purchase_price: toNum(row.querySelector(".purchasePrice").value),
      purchase_with_gst: toNum(row.querySelector(".purchaseWithGST").value),
      landing_price: toNum(row.querySelector(".landingPrice").value),
      landing_price_with_gst: toNum(row.querySelector(".landingPriceWithGST").value),
      retail_percent: toNum(row.querySelector(".retailPercent").value),
      retail_price: toNum(row.querySelector(".retailPrice").value),
      retail_with_gst: toNum(row.querySelector(".retailWithGST").value),
      wholesale_percent: toNum(row.querySelector(".wholesalePercent").value),
      wholesale_price: toNum(row.querySelector(".wholesalePrice").value),
      wholesale_with_gst: toNum(row.querySelector(".wholesaleWithGST").value),
      special_percent: toNum(row.querySelector(".specialPercent").value),
      special_price: toNum(row.querySelector(".specialPrice").value),
      special_with_gst: toNum(row.querySelector(".specialWithGST").value)
    };
  });
}

// Save Purchase
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const purchase = {
      bill_number: billNumberInput.value,
      entry_date: entryDateInput.value,
      invoice_date: invoiceDateInput.value,
      invoice_number: invoiceNumberInput.value,
      supplier_name: supplierNameInput.value,
      supplier_gst: supplierGSTInput.value,
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

    const items = collectItems(purchaseData.purchase_id);
    const { error: itemError } = await supabaseClient
      .from("purchaseitems")
      .insert(items);
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
  loadSuppliers();
  addProductBtn.addEventListener("click", addProductRow);
})();
</script>
