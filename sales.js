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
document.addEventListener("mousemove", (e) => {
  if (e.clientX < 24) sidebar.classList.add("active");
});
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

// Enter key navigation in form inputs
document.getElementById("product").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("qty").focus();
  }
});
document.getElementById("qty").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("price").focus();
  }
});
document.getElementById("price").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    salesForm.dispatchEvent(new Event("submit")); // add item
    document.getElementById("product").focus();   // ready for next product
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

// Auto recalc on editing cells
salesBody.addEventListener("input", (e) => {
  if (e.target.hasAttribute("contenteditable")) {
    recalcGrandTotal();
  }
});

// Keyboard shortcuts inside table
salesBody.addEventListener("keydown", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;

  // Enter → jump back to Product cell
  if (e.key === "Enter") {
    e.preventDefault();
    row.querySelector("td:nth-child(1)").focus();
  }

  // Up/Down arrows → move between rows
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const allRows = Array.from(salesBody.querySelectorAll("tr"));
    const index = allRows.indexOf(row);
    let targetRow;
    if (e.key === "ArrowUp" && index > 0) targetRow = allRows[index - 1];
    if (e.key === "ArrowDown" && index < allRows.length - 1) targetRow = allRows[index + 1];
    if (targetRow) targetRow.querySelector("td:nth-child(1)").focus();
  }

  // Delete key → remove current row
  if (e.key === "Delete") {
    e.preventDefault();
    row.remove();
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

  // Get customer details
  const customerName = document.getElementById("customerName").value.trim();
  const customerAddress = document.getElementById("customerAddress").value.trim();
  const customerMobile = document.getElementById("customerMobile").value.trim();

  // Generate invoice date (current timestamp)
  const invoiceDate = new Date().toISOString();

  // Insert into Supabase
  const { data, error } = await supabaseClient
    .from("invoices")
    .insert([{
      customer_name: customerName,
      customer_address: customerAddress,
      customer_mobile: customerMobile,
      items: items,
      grand_total: grandTotal,
      invoicedate: invoiceDate   // ✅ supply the date
    }]);

  if (error) {
    alert("Error saving invoice: " + error.message);
  } else {
    alert("Invoice saved successfully!");
    salesBody.innerHTML = "";
    recalcGrandTotal();
    document.getElementById("customerForm").reset();
  }
});