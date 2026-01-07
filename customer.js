const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ✅ Back button
document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "customer-list.html";
});

// ✅ Get customer_id from query string
const params = new URLSearchParams(window.location.search);
const customerId = params.get("id");

// ✅ If editing, load customer details
async function loadCustomer(customerId) {
  const { data, error } = await supabaseClient
    .from("customers")
    .select("*")
    .eq("customer_id", customerId)   // use customer_id
    .single();

  if (error) {
    alert("Error loading customer: " + error.message);
    return;
  }

  document.getElementById("formTitle").textContent = "Edit Customer";
  document.getElementById("customerName").value = data.name || "";
  document.getElementById("customerMobile").value = data.mobile || "";
  document.getElementById("customerAddress").value = data.address || "";
  document.getElementById("customerGST").value = data.gst_number || "";
  document.getElementById("customerStateCode").value = data.state_code || "";
  document.getElementById("saveBtn").textContent = "Update Customer";
}

if (customerId) {
  loadCustomer(customerId);
}

// ✅ Save or Update customer
document.getElementById("customerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("customerName").value.trim();
  const mobile = document.getElementById("customerMobile").value.trim();
  const address = document.getElementById("customerAddress").value.trim();
  const gst = document.getElementById("customerGST").value.trim();
  const stateCode = document.getElementById("customerStateCode").value.trim();

  if (customerId) {
    // Update existing
    const { error } = await supabaseClient.from("customers").update({
      name,
      mobile,
      address,
      gst_number: gst,
      state_code: stateCode
    }).eq("customer_id", customerId);

    if (error) {
      alert("Error updating customer: " + error.message);
    } else {
      alert("Customer updated successfully!");
      window.location.href = "customer-list.html";
    }
  } else {
    // Insert new (customer_id auto-increment handled by Supabase)
    const { error } = await supabaseClient.from("customers").insert([{
      name,
      mobile,
      address,
      gst_number: gst,
      state_code: stateCode
    }]);

    if (error) {
      alert("Error saving customer: " + error.message);
    } else {
      alert("Customer saved successfully!");
      document.getElementById("customerForm").reset();
    }
  }
});