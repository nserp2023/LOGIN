// ✅ Load customers
async function loadCustomers() {
  const { data, error } = await supabaseClient.from("customers").select("*");
  if (error) {
    alert("Error loading customers: " + error.message);
    return;
  }
  customers = data;
  renderCustomers(customers);
}

// ✅ Render customers
function renderCustomers(list) {
  const tbody = document.getElementById("customerTableBody");
  tbody.innerHTML = "";
  list.forEach(cust => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${cust.customer_id}</td>   <!-- ✅ show customer_id -->
      <td>${cust.name || ""}</td>
      <td>${cust.mobile || ""}</td>
      <td>${cust.address || ""}</td>
      <td>${cust.gst_number || ""}</td>
      <td>${cust.state_code || ""}</td>
      <td>
        <button class="edit" data-id="${cust.customer_id}">Edit</button>
        <button class="delete" data-id="${cust.customer_id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ✅ Delete customer
document.getElementById("customerTableBody").addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete")) {
    const customerId = e.target.dataset.id;
    const { error } = await supabaseClient.from("customers").delete().eq("customer_id", customerId);
    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      alert("Customer deleted!");
      loadCustomers();
    }
  }
});

// ✅ Edit customer
document.getElementById("customerTableBody").addEventListener("click", (e) => {
  if (e.target.classList.contains("edit")) {
    const customerId = e.target.dataset.id;
    window.location.href = `customer.html?id=${customerId}`;
  }
});