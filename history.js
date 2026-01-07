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

// ✅ Load invoices
async function loadInvoices() {
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("*")
    .order("invoicedate", { ascending: false });

  if (error) {
    alert("Error loading invoices: " + error.message);
    return;
  }

  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";

  data.forEach(inv => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${inv.bill_series || ""}</td>
      <td>${inv.bill_number || ""}</td>
      <td>${inv.invoicedate || ""}</td>
      <td>${inv.customer_name || ""}</td>
      <td>${inv.customer_mobile || ""}</td>
      <td>${inv.gst_number || ""}</td>
      <td>${inv.state_code || ""}</td>
      <td>${inv.totalamount ? "₹" + inv.totalamount.toFixed(2) : ""}</td>
      <td><button class="viewItems" data-items='${JSON.stringify(inv.items)}'>View Items</button></td>
    `;
    tbody.appendChild(row);
  });
}

// ✅ Show items in modal
const modal = document.getElementById("itemsModal");
const closeModal = document.getElementById("closeModal");
const itemsBody = document.getElementById("itemsBody");

document.getElementById("historyBody").addEventListener("click", (e) => {
  if (e.target.classList.contains("viewItems")) {
    const items = JSON.parse(e.target.dataset.items || "[]");
    itemsBody.innerHTML = "";
    items.forEach(it => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${it.product || ""}</td>
        <td>${it.qty || 0}</td>
        <td>${it.price ? "₹" + it.price.toFixed(2) : ""}</td>
        <td>${it.total ? "₹" + it.total.toFixed(2) : ""}</td>
      `;
      itemsBody.appendChild(row);
    });
    modal.style.display = "block";
  }
});

closeModal.addEventListener("click", () => {
  modal.style.display = "none";
});

// ✅ Load on page start
document.addEventListener("DOMContentLoaded", loadInvoices);