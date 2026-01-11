const { createClient } = supabase;
const supabaseUrl = "YOUR_SUPABASE_URL";
const supabaseKey = "YOUR_SUPABASE_KEY";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const billNumberInput = document.getElementById("billNumber");
const currentDateInput = document.getElementById("currentDate");
const supplierGSTInput = document.getElementById("supplierGST");
const gstDropdown = document.getElementById("gstDropdown");
const supplierNameInput = document.getElementById("supplierName");
const supplierDropdown = document.getElementById("supplierDropdown");
const purchaseProductsBody = document.getElementById("purchaseProductsBody");

// Auto-fill current date & bill number
document.addEventListener("DOMContentLoaded", async () => {
  currentDateInput.value = new Date().toISOString().split("T")[0];
  billNumberInput.value = await generateBillNumber();
});

// Generate bill number
async function generateBillNumber() {
  const { data, error } = await supabaseClient
    .from("purchases")
    .select("bill_number")
    .order("purchase_id", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return "BILL-001";
  const last = parseInt(data[0].bill_number.split("-")[1]);
  return `BILL-${String(last + 1).padStart(3, "0")}`;
}

// Search supplier by GST
supplierGSTInput.addEventListener("input", async () => {
  const term = supplierGSTInput.value.trim();
  if (!term) { gstDropdown.innerHTML = ""; return; }
  const { data } = await supabaseClient
    .from("suppliers")
    .select("*")
    .ilike("gst_number", `%${term}%`);
  gstDropdown.innerHTML = "";
  data.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.supplier_id;
    opt.textContent = `${s.gst_number} — ${s.supplier_name}`;
    gstDropdown.appendChild(opt);
  });
});

// Search supplier by name
supplierNameInput.addEventListener("input", async () => {
  const term = supplierNameInput.value.trim();
  if (!term) { supplierDropdown.innerHTML = ""; return; }
  const { data } = await supabaseClient
    .from("suppliers")
    .select("*")
    .ilike("supplier_name", `%${term}%`);
  supplierDropdown.innerHTML = "";
  data.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.supplier_id;
    opt.textContent = `${s.supplier_name} — GST ${s.gst_number}`;
    supplierDropdown.appendChild(opt);
  });
});

// Add product row
document.getElementById("addProductBtn").addEventListener("click", () => {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="itemCode"></td>
    <td><input type="text" class="productName"></td>
    <td><input type="number" class="qty" step="1"></td>
    <td><input type="number" class="rate" step="0.01"></td>
    <td><input type="number" class="amount" step="0.01" readonly></td>
    <td><button type="button" class="removeBtn">Remove</button></td>
  `;
  purchaseProductsBody.appendChild(row);

  row.querySelector(".qty").addEventListener("input", updateAmount);
  row.querySelector(".rate").addEventListener("input", updateAmount);
  row.querySelector(".removeBtn").addEventListener("click", () => row.remove());
});

function updateAmount(e) {
  const row = e.target.closest("tr");
  const qty = parseFloat(row.querySelector(".qty").value) || 0;
  const rate = parseFloat(row.querySelector(".rate").value) || 0;
  row.querySelector(".amount").value = (qty * rate).toFixed(2);
}

// Save purchase
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  // collect purchase + product details
  // insert into purchases + purchase_items tables
});