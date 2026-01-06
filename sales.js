const { createClient } = supabase;

const supabaseUrl = "https://YOUR_PROJECT.supabase.co";
const supabaseKey = "YOUR_PUBLIC_KEY";
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

// Cursor workflow
function setInitialFocus() {
  document.getElementById("customerMobile").focus();
}
window.addEventListener("load", setInitialFocus);

// Enter key navigation
document.getElementById("customerMobile").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("customerName").focus(); }
});
document.getElementById("customerName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("customerAddress").focus(); }
});
document.getElementById("customerAddress").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("product").focus(); }
});

// Auto date
function setTodayDate() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("billDate").value = today;
}
window.addEventListener("load", setTodayDate);

// Load series from Supabase
async function loadSeries() {
  const { data, error } = await supabaseClient.from("bill_series").select("series_code");
  const select = document.getElementById("billSeries");
  if (!error && data) {
    select.innerHTML = "";
    data.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.series_code;
      opt.textContent = s.series_code;
      select.appendChild(opt);
    });
    select.value = "Q"; // default
  }
}
window.addEventListener("load", loadSeries);

// Get next bill number from Supabase function
async function getNextBillNumber(series) {
  const { data, error } = await supabaseClient.rpc("increment_bill_number", { series_code: series });
  if (error) { console.error(error); return null; }
  return data;
}

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
      total: parseFloat(row.querySelector("td:nth-child(4)").textContent.replace("$","")) || 0
    });
  });

  // Customer details
  const customerName = document.getElementById("customerName").value.trim();
  const customerAddress = document.getElementById("customerAddress").value.trim();
  const customerMobile = document.getElement