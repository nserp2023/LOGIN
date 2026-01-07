const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ============================
// Auth and UI scaffolding
// ============================
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) window.location.href = "index.html";
})();

const logoutBtn = document.getElementById("logout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });
}

const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");
if (toggleBtn && sidebar) {
  toggleBtn.addEventListener("click", () => sidebar.classList.toggle("active"));
  document.addEventListener("mousemove", (e) => { if (e.clientX < 24) sidebar.classList.add("active"); });
  sidebar.addEventListener("mouseleave", () => sidebar.classList.remove("active"));
}

// ============================
// Elements and state
// ============================
const salesForm = document.getElementById("salesForm");
const salesBody = document.getElementById("salesBody");
const grandTotalEl = document.getElementById("grandTotal");
const billForm = document.getElementById("billForm");
const customerForm = document.getElementById("customerForm");

const inputProduct = document.getElementById("product");
const inputQty = document.getElementById("qty");
const inputPrice = document.getElementById("price");

const inputMobile = document.getElementById("customerMobile");
const inputName = document.getElementById("customerName");
const inputAddress = document.getElementById("customerAddress");
const inputGST = document.getElementById("customerGST");
const inputStateCode = document.getElementById("customerStateCode");

const billDateEl = document.getElementById("billDate");
const billSeriesEl = document.getElementById("billSeries");
const billNumberEl = document.getElementById("billNumber"); // optional display (if present)
const salesmanEl = document.getElementById("salesman");
const vehicleNumberEl = document.getElementById("vehicleNumber");

let grandTotal = 0;

// ============================
// Helpers
// ============================
function recalcGrandTotal() {
  grandTotal = 0;
  salesBody.querySelectorAll("tr").forEach(row => {
    const qty = parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0;
    const price = parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0;
    const total = qty * price;
    row.querySelector("td:nth-child(4)").textContent = `$${total.toFixed(2)}`;
    grandTotal += total;
  });
  if (grandTotalEl) grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
}

function setTodayDate() {
  if (billDateEl) {
    const today = new Date().toISOString().split("T")[0];
    billDateEl.value = today;
  }
}

// ============================
// Bill counter: read + increment
// NOTE: your table is bill_counters (not bill_count)
// ============================
async function readBillNumber(series) {
  if (!billNumberEl || !series) return; // safe guard if display not present
  const { data, error } = await supabaseClient
    .from("bill_counters")
    .select("current_number")
    .eq("series_code", series)
    .single();

  if (error || !data) {
    console.warn("Error reading bill counter:", error?.message || "no data");
    billNumberEl.value = "1";
    return;
  }
  billNumberEl.value = String(data.current_number + 1);
}

async function incrementBillNumber(series) {
  const { data, error } = await supabaseClient.rpc("increment_bill_number", {
    series_code_input: series
  });
  if (error) {
    console.error("RPC error:", error);
    throw error;
  }
  return data; // new bill number returned by RPC
}

// ============================
// Customer lookup + auto-create
// ============================
async function fetchCustomerByMobile(mobile) {
  if (!mobile) return;
  const { data, error } = await supabaseClient
    .from("customers")
    .select("name, address, mobile, gst_number, state_code")
    .eq("mobile", mobile)
    .single();

  if (error) {
    // Not found is fine, single() returns error when 0 rows
    if (error.code !== "PGRST116") console.warn("Customer lookup error:", error.message);
    return;
  }

  if (data) {
    if (inputName) inputName.value = data.name || "";
    if (inputAddress) inputAddress.value = data.address || "";
    if (inputGST) inputGST.value = data.gst_number || "";
    if (inputStateCode) inputStateCode.value = data.state_code || "";
  }
}

if (inputMobile) {
  inputMobile.addEventListener("blur", async (e) => {
    const mobile = e.target.value.trim();
    await fetchCustomerByMobile(mobile);
  });
}

// ============================
// Initial setup
// ============================
document.addEventListener("DOMContentLoaded", async () => {
  if (inputMobile) inputMobile.focus();
  setTodayDate();

  // Load bill series
  if (billSeriesEl) {
    try {
      const { data, error } = await supabaseClient.from("bill_series").select("series_code");
      if (!error && data && data.length) {
        billSeriesEl.innerHTML = "";
        data.forEach(s => {
          const opt = document.createElement("option");
          opt.value = s.series_code;
          opt.textContent = s.series_code;
          billSeriesEl.appendChild(opt);
        });
      } else {
        ["Q", "A", "B", "C"].forEach(s => {
          const opt = document.createElement("option");
          opt.value = s; opt.textContent = s;
          billSeriesEl.appendChild(opt);
        });
      }
    } catch {
      ["Q", "A", "B", "C"].forEach(s => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        billSeriesEl.appendChild(opt);
      });
    }
    billSeriesEl.value = "Q";
    await readBillNumber(billSeriesEl.value);

    billSeriesEl.addEventListener("change", async () => {
      await readBillNumber(billSeriesEl.value);
    });
  }
});

// ============================
// Keyboard navigation
// ============================
const jump = (from, to) => {
  const a = document.getElementById(from), b = document.getElementById(to);
  if (a && b) a.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); b.focus(); }
  });
};
jump("customerMobile","customerName");
jump("customerName","customerAddress");
jump("customerAddress","customerGST");
jump("customerGST","customerStateCode");
jump("customerStateCode","product");

// ============================
// Enter on Price adds item
// ============================
if (inputPrice) {
  inputPrice.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (salesForm) salesForm.dispatchEvent(new Event("submit"));
      if (inputProduct) inputProduct.focus();
    }
  });
}

// ============================
// Add item to table
// ============================
if (salesForm) {
  salesForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const product = (inputProduct?.value || "").trim();
    const qty = parseFloat(inputQty?.value || "0");
    const price = parseFloat(inputPrice?.value || "0");
    if (!product || qty <= 0 || price < 0) return;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td contenteditable="true">${product}</td>
      <td contenteditable="true">${qty}</td>
      <td contenteditable="true">${price.toFixed(2)}</td>
      <td>$${(qty * price).toFixed(2)}</td>
      <td><button class="remove">Remove</button></td>
    `;
    salesBody.appendChild(row);

    recalcGrandTotal();

    // Only reset the sales item inputs, not customer/bill
    salesForm.reset();
    if (inputProduct) inputProduct.focus();
  });
}

// ============================
// Remove row
// ============================
if (salesBody) {
  salesBody.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove")) {
      e.target.closest("tr").remove();
      recalcGrandTotal();
    }
  });
}

// ============================
// Save invoice
// ============================
const saveBtn = document.getElementById("saveInvoice");
if (saveBtn) {
  saveBtn.addEventListener("click", async (e) => {
    saveBtn.disabled = true;

    try {
      // Gather line items
      const items = [];
      salesBody.querySelectorAll("tr").forEach(row => {
        items.push({
          product: row.querySelector("td:nth-child(1)").textContent.trim(),
          qty: parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0,
          price: parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0,
          total: parseFloat(row.querySelector("td:nth-child(4)").textContent.replace("$","")) || 0
        });
      });

      // Basic validation
      if (items.length === 0) {
        alert("Please add at least one item before saving.");
        return;
      }
      if (!inputMobile?.value || !inputName?.value || !billDateEl?.value || !billSeriesEl?.value) {
        alert("Please complete required customer and bill fields.");
        return;
      }

      const customerName = inputName.value.trim();
      const customerAddress = inputAddress.value.trim();
      const customerMobile = inputMobile.value.trim();
      const customerGST = inputGST.value.trim();
      const customerStateCode = inputStateCode.value.trim();
      const billDate = billDateEl.value;
      const billSeries = billSeriesEl.value;
      const salesman = salesmanEl?.value.trim() || "";
      const vehicleNumber = vehicleNumberEl?.value.trim() || "";

      // Increment bill number only on save
      const newBillNumber = await incrementBillNumber(billSeries);
      if (billNumberEl) billNumberEl.value = String(newBillNumber);

      // Ensure customer exists (customers.customer_id is auto-increment integer)
      const { data: existingCustomer, error: lookupErr } = await supabaseClient
        .from("customers")
        .select("customer_id")
        .eq("mobile", customerMobile)
        .maybeSingle();

      if (lookupErr) {
        console.warn("Customer check error:", lookupErr.message);
      }

      if (!existingCustomer) {
        const { error: insertCustErr } = await supabaseClient.from("customers").insert([{
          name: customerName,
          mobile: customerMobile,
          address: customerAddress,
          gst_number: customerGST,
          state_code: customerStateCode
        }]);
        if (insertCustErr) {
          alert("Error creating customer: " + insertCustErr.message);
          return;
        }
      }

      // Insert invoice; items will be stored as JSON/JSONB if column type is jsonb
      const { error: invErr } = await supabaseClient.from("invoices").insert([{
        customer_name: customerName,
        customer_address: customerAddress,
        customer_mobile: customerMobile,
        items,
        totalamount: Number(grandTotal.toFixed(2)),
        invoicedate: billDate,
        bill_series: billSeries,
        bill_number: newBillNumber,
        salesman,
        vehicle_number: vehicleNumber
      }]);

      if (invErr) {
        alert("Error saving invoice: " + invErr.message);
      } else {
        alert("Invoice saved successfully!");
        salesBody.innerHTML = "";
        recalcGrandTotal();
        billForm?.reset();
        salesForm?.reset();
        setTodayDate();
        inputMobile?.focus();
      }
    } catch (err) {
      alert("Unexpected error: " + (err?.message || String(err)));
    } finally {
      saveBtn.disabled = false;
    }
  });
}