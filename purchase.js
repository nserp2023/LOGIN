// Initialize Supabase
const supabaseClient = supabase.createClient(
  "https://gqxczzijntbvtlmmzppt.supabase.co",
  "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs"
);

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
  const { count, error } = await supabaseClient
    .from("purchases")
    .select("*", { count: "exact", head: true });
  if (error) { console.error(error); return "BILL-001"; }
  const next = count + 1;
  return "BILL-" + next.toString().padStart(3, "0");
}

// Load Suppliers with sync + filtering
async function loadSuppliers() {
  const { data, error } = await supabaseClient
    .from("suppliers")
    .select("*");

  if (error) {
    console.error("Error loading suppliers:", error);
    showBanner("Could not load suppliers. Check table name/columns.", "error");
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

  // Populate dropdowns
  function populateDropdowns(list) {
    supplierNameDropdown.innerHTML = "";
    supplierGSTDropdown.innerHTML = "";
    list.forEach(supplier => {
      const nameOption = document.createElement("option");
      nameOption.value = supplier[nameKey] ?? "";
      nameOption.textContent = supplier[nameKey] ?? "";
      supplierNameDropdown.appendChild(nameOption);

      const gstOption = document.createElement("option");
      gstOption.value = supplier[gstKey] ?? "";
      gstOption.textContent = supplier[gstKey] ?? "";
      supplierGSTDropdown.appendChild(gstOption);
    });
  }
  populateDropdowns(suppliersList);

  // Sync selections
  supplierNameDropdown.addEventListener("change", () => {
    supplierNameInput.value = supplierNameDropdown.value;
    const match = suppliersList.find(s => s[nameKey] === supplierNameDropdown.value);
    if (match) supplierGSTInput.value = match[gstKey];
  });

  supplierGSTDropdown.addEventListener("change", () => {
    supplierGSTInput.value = supplierGSTDropdown.value;
    const match = suppliersList.find(s => s[gstKey] === supplierGSTDropdown.value);
    if (match) supplierNameInput.value = match[nameKey];
  });

  // 🔎 Live filtering by typing in supplier name
  supplierNameInput.addEventListener("input", () => {
    const query = supplierNameInput.value.toLowerCase();
    const filtered = suppliersList.filter(s => (s[nameKey] ?? "").toLowerCase().includes(query));
    populateDropdowns(filtered);
  });

  // 🔎 Live filtering by typing in GST number
  supplierGSTInput.addEventListener("input", () => {
    const query = supplierGSTInput.value.toLowerCase();
    const filtered = suppliersList.filter(s => (s[gstKey] ?? "").toLowerCase().includes(query));
    populateDropdowns(filtered);
  });
}

// Add Product Row
function addProductRow() {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="itemCode"></td>
    <td><input class="productName"></td>
    <td><input type="number" class="qty" step="0.01" value="1"></td>
    <td><input type="number" class="rate" step="0.01"></td>
    <td><button type="button" class="removeBtn">X</button></td>
  `;
  purchaseTbody.appendChild(row);

  row.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => updateNetPayable());
  });
  row.querySelector(".removeBtn").addEventListener("click", () => {
    row.remove();
    updateNetPayable();
  });
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