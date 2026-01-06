const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ✅ Session check
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) window.location.href = "index.html";
})();

// ✅ Logout
document.getElementById("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

// ✅ Sidebar toggle
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("active"));
document.addEventListener("mousemove", (e) => { if (e.clientX < 24) sidebar.classList.add("active"); });
sidebar.addEventListener("mouseleave", () => sidebar.classList.remove("active"));

// ✅ Sales logic
const salesForm = document.getElementById("salesForm");
const salesBody = document.getElementById("salesBody");
const grandTotalEl = document.getElementById("grandTotal");
let grandTotal = 0;

function recalcGrandTotal() {
  grandTotal = 0;
  salesBody.querySelectorAll("tr").forEach(row => {
    const qty = parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0;
    const price = parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0;
    const total = qty * price;
    row.querySelector("td:nth-child(4)").textContent = `$${total.toFixed(2)}`;
    grandTotal += total;
  });
  grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
}

// ✅ Auto date
function setTodayDate() {
  const billDateEl = document.getElementById("billDate");
  if (billDateEl) {
    const today = new Date().toISOString().split("T")[0];
    billDateEl.value = today;
  }
}

// ✅ Fetch next bill number from Supabase
async function setBillNumberFromDB(series) {
  const billNumberEl = document.getElementById("billNumber");
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("bill_number")
    .eq("bill_series", series)
    .order("bill_number", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching bill number:", error);
    billNumberEl.value = "1"; // fallback
    return;
  }

  if (data.length > 0) {
    const lastNumber = parseInt(data[0].bill_number, 10);
    billNumberEl.value = String(lastNumber + 1);
  } else {
    billNumberEl.value = "1"; // first bill in this series
  }
}

// ✅ Initial setup
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("customerMobile").focus();
  setTodayDate();

  const seriesSelect = document.getElementById("billSeries");
  try {
    const { data, error } = await supabaseClient.from("bill_series").select("series_code");
    if (!error && data.length) {
      seriesSelect.innerHTML = "";
      data.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.series_code;
        opt.textContent = s.series_code;
        seriesSelect.appendChild(opt);
      });
    }
  } catch (err) {
    ["Q","A","B","C"].forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      seriesSelect.appendChild(opt);
    });
  }
  seriesSelect.value = "Q";

  await setBillNumberFromDB(seriesSelect.value);

  seriesSelect.addEventListener("change", async () => {
    await setBillNumberFromDB(seriesSelect.value);
  });
});

// ✅ Enter navigation
const jump = (from, to) => {
  const a = document.getElementById(from), b = document.getElementById(to);
  if (a && b) a.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); b.focus(); }
  });
};
jump("customerMobile","customerName");
jump("customerName","customerAddress");
jump("customerAddress","product");

// ✅ Enter on Price adds item
document.getElementById("price").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    salesForm.dispatchEvent(new Event("submit"));
    document.getElementById("product").focus();
  }
});

// ✅ Add item
salesForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const product = document.getElementById("product").value.trim();
  const qty = parseInt(document.getElementById("qty").value, 10);
  const price = parseFloat(document.getElementById("price").value);
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
  salesForm.reset();
  document.getElementById("product").focus();
});

// ✅ Remove row
salesBody.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove")) {
    e.target.closest("tr").remove();
    recalcGrandTotal();
  }
});

// ✅ Save Invoice with duplicate protection
document.getElementById("saveInvoice").addEventListener("click", async (e) => {
  const saveBtn = e.target;
  saveBtn.disabled = true;   // prevent double click

  try {
    const items = [];
    salesBody.querySelectorAll("tr").forEach(row => {
      items.push({
        product: row.querySelector("td:nth-child(1)").textContent.trim(),
        qty: parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0,
        price: parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0,
        total: parseFloat(row.querySelector("td:nth-child(4)").textContent.replace("$","")) || 0
      });
    });

    const customerName = document.getElementById("customerName").value.trim();
    const customerAddress = document.getElementById("customerAddress").value.trim();
    const customerMobile = document.getElementById("customerMobile").value.trim();
    const billDate = document.getElementById("billDate").value;
    const billSeries = document.getElementById("billSeries").value;
    const billNumber = document.getElementById("billNumber").value;
    const salesman = document.getElementById("salesman").value.trim();
    const vehicleNumber = document.getElementById("vehicleNumber").value.trim();

    const { error } = await supabaseClient.from("invoices").insert([{
      customer_name: customerName,
      customer_address: customerAddress,
      customer_mobile: customerMobile,
      items,
      totalamount: Number(grandTotal.toFixed(2)),
      invoicedate: billDate,
      bill_series: billSeries,
      bill_number: billNumber,
      salesman,
      vehicle_number: vehicleNumber
    }]);

    if (error) {
      if (error.message.includes("duplicate key")) {
        alert("This bill number already exists. Please refresh to get the next number.");
      } else {
        alert("Error saving invoice: " + error.message);
      }
    } else {
      alert("Invoice saved successfully!");
      salesBody.innerHTML = "";
      recalcGrandTotal();
      document.getElementById("customerForm").reset();
      document.getElementById("billForm").reset();
      setTodayDate();
      document.getElementById("customerMobile").focus();
      await setBillNumberFromDB(billSeries); // refresh next number
    }
  } finally {
    saveBtn.disabled = false; // re‑enable button
  }
});