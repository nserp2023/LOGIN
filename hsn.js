const { createClient } = supabase;
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const form = document.getElementById("hsnForm");
const tableBody = document.getElementById("hsnTableBody");
const gstInput = document.getElementById("gstPercent");
const cgstInput = document.getElementById("cgstPercent");
const sgstInput = document.getElementById("sgstPercent");
const igstInput = document.getElementById("igstPercent");
const hsnIdInput = document.getElementById("hsnId");
const searchInput = document.getElementById("searchHSN");

let editingId = null;
let allHSN = [];

// ✅ Auto-update CGST, SGST, IGST when GST changes
gstInput.addEventListener("input", () => {
  const gst = parseFloat(gstInput.value) || 0;
  cgstInput.value = (gst / 2).toFixed(2);
  sgstInput.value = (gst / 2).toFixed(2);
  igstInput.value = gst.toFixed(2);
});

// ✅ Load all HSN codes
async function loadHSN() {
  const { data, error } = await supabaseClient
    .from("hsn_codes")
    .select("*")
    .order("hsn_id", { ascending: true });

  if (error) {
    alert("Error loading HSN codes: " + error.message);
    return;
  }

  allHSN = data;
  renderHSN(allHSN);
}

// ✅ Render HSN list
function renderHSN(list) {
  tableBody.innerHTML = "";
  list.forEach(h => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${h.hsn_id}</td>
      <td>${h.hsn_code}</td>
      <td>${h.description}</td>
      <td>${h.gst_percent}</td>
      <td>${h.cgst_percent}</td>
      <td>${h.sgst_percent}</td>
      <td>${h.igst_percent}</td>
      <td>
        <button onclick="editHSN(${h.hsn_id}, '${h.hsn_code}', '${h.description}', ${h.gst_percent})">Edit</button>
        <button onclick="deleteHSN(${h.hsn_id})">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

// ✅ Search filter
searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  const filtered = allHSN.filter(h =>
    h.hsn_code.toLowerCase().includes(term) ||
    h.description.toLowerCase().includes(term)
  );
  renderHSN(filtered);
});

// ✅ Add or Update HSN
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const hsnCode = document.getElementById("hsnCode").value.trim();
  const description = document.getElementById("description").value.trim();
  const gst = parseFloat(gstInput.value) || 0;
  const cgst = parseFloat(cgstInput.value) || 0;
  const sgst = parseFloat(sgstInput.value) || 0;
  const igst = parseFloat(igstInput.value) || 0;

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("hsn_codes").update({
        hsn_code: hsnCode,
        description,
        gst_percent: gst,
        cgst_percent: cgst,
        sgst_percent: sgst,
        igst_percent: igst
      }).eq("hsn_id", editingId);

      if (error) throw error;
      alert("HSN updated successfully!");
    } else {
      const { error } = await supabaseClient.from("hsn_codes").insert([{
        hsn_code: hsnCode,
        description,
        gst_percent: gst,
        cgst_percent: cgst,
        sgst_percent: sgst,
        igst_percent: igst
      }]);
      if (error) throw error;
      alert("HSN added successfully!");
    }

    form.reset();
    editingId = null;
    document.getElementById("saveBtn").textContent = "Save HSN";
    loadHSN();
  } catch (err) {
    alert("Error saving HSN: " + err.message);
  }
});

// ✅ Edit HSN
window.editHSN = function(id, code, desc, gst) {
  editingId = id;
  document.getElementById("hsnCode").value = code;
  document.getElementById("description").value = desc;
  gstInput.value = gst;
  gstInput.dispatchEvent(new Event("input")); // auto-update CGST/SGST/IGST
  document.getElementById("saveBtn").textContent = "Update HSN";
}

// ✅ Delete HSN
window.deleteHSN = async function(id) {
  if (!confirm("Are you sure you want to delete this HSN code?")) return;
  const { error } = await supabaseClient.from("hsn_codes").delete().eq("hsn_id", id);
  if (error) {
    alert("Error deleting HSN: " + error.message);
  } else {
    alert("HSN deleted successfully!");
    loadHSN();
  }
}

// Initial load
document.addEventListener("DOMContentLoaded", loadHSN);