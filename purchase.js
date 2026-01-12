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
  const next = count + 1;
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

  // Populate datalists
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

  // Auto-sync: selecting name fills GST
  supplierNameInput.addEventListener("change", () => {
    const match = suppliersList.find(s => s[nameKey] === supplierNameInput.value);
    if (match) supplierGSTInput.value = match[gstKey];
  });

  // Auto-sync: selecting GST fills name
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
    <td><input type="number" class="purchasePrice" step="0.01"></td>
    <td><input type="number" class="purchaseWithGST" step="0.01" readonly></td>
    <td><input type="number" class="landingPriceWithGST" step="0.01"></td>
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

  // Calculation function for this row
  function recalc() {
    const qty = parseFloat(row.querySelector(".qty").value) || 0;
    const price = parseFloat(row.querySelector(".price").value) || 0;
    const discountPercent = parseFloat(row.querySelector(".discountPercent").value) || 0;
    const gstPercent = parseFloat(row.querySelector(".gstPercent").value) || 0;

    const retailPercent = parseFloat(row.querySelector(".retailPercent").value) || 0;
    const wholesalePercent = parseFloat(row.querySelector(".wholesalePercent").value) || 0;
    const specialPercent = parseFloat(row.querySelector(".specialPercent").value) || 0;

    // Total before GST
    let total = qty * price;
    total = total - (total * discountPercent / 100);
    row.querySelector(".total").value = total.toFixed(2);

    // Total + GST
    const totalWithGST = total * (1 + gstPercent / 100);
    row.querySelector(".totalWithGST").value = totalWithGST.toFixed(2);

    // Purchase Price (editable, user can override)
    const purchasePrice = parseFloat(row.querySelector(".purchasePrice").value) || total;
    row.querySelector(".purchasePrice").value = purchasePrice.toFixed(2);

    // Purchase + GST
    const purchaseWithGST = purchasePrice * (1 + gstPercent / 100);
    row.querySelector(".purchaseWithGST").value = purchaseWithGST.toFixed(2);

    // Landing Price + GST (editable field, user can override)
    const landingPriceWithGST = parseFloat(row.querySelector(".landingPriceWithGST").value) || purchaseWithGST;
    row.querySelector(".landingPriceWithGST").value = landingPriceWithGST.toFixed(2);

    // Retail
    const retailPrice = purchasePrice * (1 + retailPercent / 100);
    row.querySelector(".retailPrice").value = retailPrice.toFixed(2);
    row.querySelector(".retailWithGST").value = (retailPrice * (1 + gstPercent / 100)).toFixed(2);

    // Wholesale
    const wholesalePrice = purchasePrice * (1 + wholesalePercent / 100);
    row.querySelector(".wholesalePrice").value = wholesalePrice.toFixed(2);
    row.querySelector(".wholesaleWithGST").value = (wholesalePrice * (1 + gstPercent / 100)).toFixed(2);

    // Special
    const specialPrice = purchasePrice * (1 + specialPercent / 100);
    row.querySelector(".specialPrice").value = specialPrice.toFixed(2);
    row.querySelector(".specialWithGST").value = (specialPrice * (1 + gstPercent / 100)).toFixed(2);

    updateNetPayable();
  }

  // Attach listeners
  row.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", recalc);
  });

  row.querySelector(".removeBtn").addEventListener("click", () => {
    row.remove();
    updateNetPayable();
  });

  // Auto-focus first field
  row.querySelector(".itemCode").focus();
}




// Net Payable
function updateNetPayable() {
  const total = Array.from(purchaseTbody.querySelectorAll("tr")).reduce((sum, row) => {
    const qty = toNum(row.querySelector(".qty").value);
    const rate = toNum(row.querySelector(".rate").value);
    return sum + (qty * rate);
  }, 0);
  const roundOff = toNum(roundOffInput.value);
  netPayableInput.value = (total + roundOff).toFixed(2);
}

// Collect Items
function collectItems(purchase_id) {
  return Array.from(purchaseTbody.querySelectorAll("tr")).map(row => {
    const qty = toNum(row.querySelector(".qty").value);
    const rate = toNum(row.querySelector(".rate").value);
    return {
      purchase_id,
      item_code: row.querySelector(".itemCode").value,
      item_name: row.querySelector(".productName").value,
      qty,
      rate,
      amount: qty * rate,
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
