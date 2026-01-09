const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ✅ Back button
document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "supplier-list.html";
});

// ✅ Get supplier_id from query string
const params = new URLSearchParams(window.location.search);
const supplierId = params.get("id");

// ✅ If editing, load supplier details
async function loadSupplier(supplierId) {
  const { data, error } = await supabaseClient
    .from("supplier")
    .select("*")
    .eq("supplier_id", supplierId)   // use supplier_id
    .single();

  if (error) {
    alert("Error loading supplier: " + error.message);
    return;
  }

  document.getElementById("formTitle").textContent = "Edit Supplier";
  document.getElementById("supplierName").value = data.name || "";
  document.getElementById("supplierMobile").value = data.mobile || "";
  document.getElementById("supplierAddress").value = data.address || "";
  document.getElementById("supplierGST").value = data.gst_number || "";
  document.getElementById("supplierStateCode").value = data.state_code || "";
  document.getElementById("saveBtn").textContent = "Update Supplier";
}

if (supplierId) {
  loadSupplier(supplierId);
}

// ✅ Save or Update supplier
document.getElementById("supplierForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("supplierName").value.trim();
  const mobile = document.getElementById("supplierMobile").value.trim();
  const address = document.getElementById("supplierAddress").value.trim();
  const gst = document.getElementById("supplierGST").value.trim();
  const stateCode = document.getElementById("supplierStateCode").value.trim();

  if (supplierId) {
    // Update existing
    const { error } = await supabaseClient.from("supplier").update({
      name,
      mobile,
      address,
      gst_number: gst,
      state_code: stateCode
    }).eq("supplier_id", supplierId);

    if (error) {
      alert("Error updating supplier: " + error.message);
    } else {
      alert("Supplier updated successfully!");
      window.location.href = "supplier-list.html";
    }
  } else {
    // Insert new (supplier_id auto-increment handled by Supabase)
    const { error } = await supabaseClient.from("supplier").insert([{
      name,
      mobile,
      address,
      gst_number: gst,
      state_code: stateCode
    }]);

    if (error) {
      alert("Error saving supplier: " + error.message);
    } else {
      alert("Supplier saved successfully!");
      document.getElementById("supplierForm").reset();
    }
  }
});