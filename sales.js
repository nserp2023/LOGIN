const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// Session check
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) window.location.href = "index.html";
})();

// Logout
document.getElementById("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

// Sidebar toggle
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("active"));
document.addEventListener("mousemove", (e) => { if (e.clientX < 24) sidebar.classList.add("active"); });
sidebar.addEventListener("mouseleave", () => sidebar.classList.remove("active"));

// Sales logic
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

// Initial setup
window.addEventListener("DOMContentLoaded", async () => {
  // Focus Mobile
  document.getElementById("customerMobile").focus();

  // Auto date
  const billDateEl = document.getElementById("billDate");
  billDateEl.value = new Date().toISOString().split("T")[0];

  // Load series from Supabase (fallback to Q)
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

  // Bill number auto increment (local fallback)
  const billNumberEl = document.getElementById("billNumber");
  const setLocalBillNumber = () => {
    const series = seriesSelect.value || "Q";
    const key = `counter_${series}`;
    const next = (parseInt(localStorage.getItem(key) || "0", 10) + 1);
    localStorage.setItem(key, String(next));
    billNumberEl.value = String(next);
  };
  setLocalBillNumber();
  seriesSelect.addEventListener("change", setLocalBillNumber);
});

// Enter navigation
const jump = (from, to) => {
  const a = document.getElementById(from), b = document.getElementById(to);
  if (a && b) a.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); b.focus(); }
  });
};
jump("customerMobile","customerName");
jump("customerName","customerAddress");
jump("customerAddress","product");

// Enter on Price adds item
document.getElementById("price").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    salesForm.dispatchEvent(new Event("submit"));
    document.getElementById("product").focus();
  }
});

// Add item
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

// Remove row
salesBody.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove")) {
    e.target.closest("tr").remove();
    recalcGrandTotal();
  }
});

// Save Invoice
document.getElementById("saveInvoice").addEventListener("click", async () => {
  const items = [];
  salesBody.querySelectorAll("tr").forEach(row => {
    items.push({
      product: row.querySelector("td:nth-child(1)").textContent.trim(),
      qty: parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0,
      price: parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0,
      total: parseFloat(row

        function setTodayDate() {
  const billDateEl = document.getElementById("billDate");
  if (billDateEl) {
    const today = new Date().toISOString().split("T")[0];
    billDateEl.value = today;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setTodayDate();
  document.getElementById("customerMobile").focus();
});