const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// Session check
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
  }
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

// Sales form logic
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
    <td>${product}</td>
    <td>${qty}</td>
    <td>$${price.toFixed(2)}</td>
    <td>$${total.toFixed(2)}</td>
  `;
  salesBody.appendChild(row);

  grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;

  salesForm.reset();
});