const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "dashboard.html";
});

let suppliers = [];

// ✅ Load suppliers
async function loadSuppliers() {
  const { data, error } = await supabaseClient.from("suppliers").select("*");
  if (error) {
    alert("Error loading suppliers: " + error.message);
    return;
  }
  suppliers = data;
  renderSuppliers(suppliers);
}

// ✅ Render suppliers
function renderSuppliers(list) {
  const tbody = document.getElementById("supplierTableBody");
  tbody.innerHTML = "";
  list.forEach(cust => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${cust.supplier_id}</td>
      <td>${cust.name || ""}</td>
      <td>${cust.mobile || ""}</td>
      <td>${cust.address || ""}</td>
      <td>${cust.gst_number || ""}</td>
      <td>${cust.state_code || ""}</td>
      <td>
        <button class="edit" data-id="${cust.supplier_id}">Edit</button>
        <button class="delete" data-id="${cust.supplier_id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ✅ Search filter
document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = suppliers.filter(c =>
    (c.name || "").toLowerCase().includes(term) ||
    (c.mobile || "").toLowerCase().includes(term)
  );
  renderSuppliers(filtered);
});

// ✅ Delete supplier
document.getElementById("supplierTableBody").addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete")) {
    const supplierId = e.target.dataset.id;
    const { error } = await supabaseClient.from("suppliers").delete().eq("supplier_id", supplierId);
    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      alert("Supplier deleted!");
      loadSuppliers();
    }
  }
});

// ✅ Edit supplier
document.getElementById("supplierTableBody").addEventListener("click", (e) => {
  if (e.target.classList.contains("edit")) {
    const supplierId = e.target.dataset.id;
    window.location.href = `supplier.html?id=${supplierId}`;
  }
});

// Load on page start
loadSuppliers();