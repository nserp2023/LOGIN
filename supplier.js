const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ✅ Back button
document.getElementById("backBtn").addEventListener("click", () => {
  // Go back to supplier list page
  window.location.href = "supplier-list.html";
  // Or use history.back() if you want true browser back navigation:
  // window.history.back();
});

// ✅ Get supplier_id from query string
const params = new URLSearchParams(window.location.search);
const supplierId = params.get("id");

// ✅ Load supplier details if editing
async function loadSupplier(id) {
  const { data, error } = await supabaseClient
    .from("suppliers") // ✅ consistent table name
    .select("*")
    .eq("supplier_id", id)
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
let saving = false; // guard against double save
document.getElementById("supplierForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saving) return; // prevent duplicate submission
  saving = true;

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;

  const name = document.getElementById("supplierName").value.trim();
  const mobile = document.getElementById("supplierMobile").value.trim();
  const address = document.getElementById("supplierAddress").value.trim();
  const gst = document.getElementById("supplierGST").value.trim();
  const stateCode = document.getElementById("supplierStateCode").value.trim();

  try {
    if (supplierId) {
      // Update existing supplier
      const { error } = await supabaseClient.from("suppliers").update({
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
      // Insert new supplier
      const { error } = await supabaseClient.from("suppliers").insert([{
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
        document.getElementById("formTitle").textContent = "Create Supplier";
        document.getElementById("saveBtn").textContent = "Save Supplier";
      }
    }
  } catch (err) {
    alert("Unexpected error: " + (err?.message || String(err)));
  } finally {
    saving = false;
    saveBtn.disabled = false;
  }
});