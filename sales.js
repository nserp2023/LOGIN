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

salesForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const product = document.getElementById("product").value.trim();
  const qty = parseInt(document.getElementById("qty").value, 10);
  const price = parseFloat(document.getElementById("price").value);

  if (!product || qty <= 0 || price < 0) return;

  const total = qty * price;
  grandTotal += total;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td contenteditable="true">${product}</td>
    <td contenteditable="true">${qty}</td>
    <td contenteditable="true">${price.toFixed(2)}</td>
    <td>$${total.toFixed(2)}</td>
    <td>
      <button class="edit">Edit</button>
      <button class="remove">Remove</button>
    </td>
  `;
  salesBody.appendChild(row);

  grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;

  salesForm.reset();
  document.getElementById("product").focus();
});

// Delegate actions
salesBody.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove")) {
    const row = e.target.closest("tr");
    const totalCell = row.querySelector("td:nth-child(4)");
    const totalValue = parseFloat(totalCell.textContent.replace("$", ""));
    grandTotal -= totalValue;
    grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
    row.remove();
  }

  if (e.target.classList.contains("edit")) {
    const row = e.target.closest("tr");
    const productCell = row.querySelector("td:nth-child(1)");
    const qtyCell = row.querySelector("td:nth-child(2)");
    const priceCell = row.querySelector("td:nth-child(3)");
    const totalCell = row.querySelector("td:nth-child(4)");

    const qty = parseInt(qtyCell.textContent, 10);
    const price = parseFloat(priceCell.textContent);

    const oldTotal = parseFloat(totalCell.textContent.replace("$", ""));
    grandTotal -= oldTotal;

    const newTotal = qty * price;
    totalCell.textContent = `$${newTotal.toFixed(2)}`;
    grandTotal += newTotal;
    grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
  }
});

// Keyboard shortcut: after typing price and pressing Enter, go back to Product cell
salesBody.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const row = e.target.closest("tr");
    if (row) {
      const productCell = row.querySelector("td:nth-child(1)");
      productCell.focus();
    }
  }
});