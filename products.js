const { createClient } = supabase;
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

const form = document.getElementById("productForm");
const tableBody = document.getElementById("productTableBody");
const itemCodeInput = document.getElementById("itemCode");
const hsnSearch = document.getElementById("hsnSearch");
const hsnDropdown = document.getElementById("hsnDropdown");
const purchasePrice = document.getElementById("purchasePrice");
const purchasePriceGST = document.getElementById("purchasePriceGST");
const landingPriceGST = document.getElementById("landingPriceGST");
const retailPrice = document.getElementById("retailPrice");
const retailPriceGST = document.getElementById("retailPriceGST");
const wholesalePrice = document.getElementById("wholesalePrice");
const wholesalePriceGST = document.getElementById("wholesalePriceGST");
const specialPrice = document.getElementById("specialPrice");
const specialPriceGST = document.getElementById("specialPriceGST");

let editingId = null;
let currentHSN = null;
let bulkEditEnabled = false;
let pendingChanges = {};

// ✅ Banner helper
function showBanner(message, type = "success") {
  const banner = document.getElementById("banner");
  banner.textContent = message;
  banner.className = "banner banner-" + type;
  banner.style.display = "block";
  setTimeout(() => {
    banner.style.display = "none";
  }, 3000);
}

// ✅ Auto-generate item code
async function generateItemCode() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("item_code")
    .order("product_id", { ascending: false })
    .limit(1);

  if (error || data.length === 0) return "ITEM-001";

  const lastCode = data[0].item_code;
  const num = parseInt(lastCode.split("-")[1]) + 1;
  return `ITEM-${String(num).padStart(3, "0")}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  itemCodeInput.value = await generateItemCode();
  loadProducts();
});

// ✅ Auto GST calculations
function updateGST(baseInput, gstOutput) {
  const val = parseFloat(baseInput.value) || 0;
  if (currentHSN) {
    const gst = parseFloat(currentHSN.gst_percent) || 0;
    gstOutput.value = (val + (val * gst / 100)).toFixed(2);
  }
}

purchasePrice.addEventListener("input", () => {
  updateGST(purchasePrice, purchasePriceGST);
  landingPriceGST.value = purchasePriceGST.value; // auto-fill landing
});
landingPriceGST.addEventListener("input", () => {}); // allow manual override
retailPrice.addEventListener("input", () => updateGST(retailPrice, retailPriceGST));
wholesalePrice.addEventListener("input", () => updateGST(wholesalePrice, wholesalePriceGST));
specialPrice.addEventListener("input", () => updateGST(specialPrice, specialPriceGST));

// ✅ HSN search dropdown
hsnSearch.addEventListener("input", async () => {
  const term = hsnSearch.value.trim();
  if (!term) return;

  const { data, error } = await supabaseClient
    .from("hsn_codes")
    .select("*")
    .ilike("hsn_code", `%${term}%`);

  if (error) {
    console.error(error);
    return;
  }

  hsnDropdown.innerHTML = "";
  data.forEach(h => {
    const option = document.createElement("option");
    option.value = h.hsn_id;
    option.textContent = `${h.hsn_code} - ${h.description}`;
    hsnDropdown.appendChild(option);
  });
});

hsnDropdown.addEventListener("change", async () => {
  const selectedId = hsnDropdown.value;
  if (!selectedId) return;

  const { data, error } = await supabaseClient
    .from("hsn_codes")
    .select("*")
    .eq("hsn_id", selectedId)
    .single();

  if (error) {
    console.error(error);
    return;
  }

  currentHSN = data;
  updateGST(purchasePrice, purchasePriceGST);
  landingPriceGST.value = purchasePriceGST.value;
  updateGST(retailPrice, retailPriceGST);
  updateGST(wholesalePrice, wholesalePriceGST);
  updateGST(specialPrice, specialPriceGST);
});

// ✅ Load products
async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*, hsn_codes(hsn_code)")
    .order("product_id", { ascending: true });

  if (error) {
    showBanner("Error loading products: " + error.message, "error");
    return;
  }

  renderProducts(data);
}

// ✅ Render products
function renderProducts(list) {
  tableBody.innerHTML = "";
  list.forEach(p => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="rowSelect" value="${p.product_id}"></td>
      <td>${p.item_code}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="item_name" data-id="${p.product_id}">${p.item_name}</td>
      <td>${p.hsn_codes ? p.hsn_codes.hsn_code : ""}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="purchase_price_gst" data-id="${p.product_id}">${p.purchase_price_gst}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="landing_price_gst" data-id="${p.product_id}">${p.landing_price_gst}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="retail_price_gst" data-id="${p.product_id}">${p.retail_price_gst}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="wholesale_price_gst" data-id="${p.product_id}">${p.wholesale_price_gst}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="special_price_gst" data-id="${p.product_id}">${p.special_price_gst}</td>
      <td ${bulkEditEnabled ? 'contenteditable="true"' : ''} data-field="department" data-id="${p.product_id}">${p.department}</td>
      <td>${p.online_offline}</td>
      <td>${p.image_url ? `<img src="${p.image_url}" width="50">` : ""}</td>
      <td>
        <button onclick="editProduct(${p.product_id})">Edit</button>
        <button onclick="deleteProduct(${p.product_id})">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

// ✅ Save product
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const product = {
    item_code: itemCodeInput.value.trim(),
    item_name: document.getElementById("itemName").value.trim(),
    hsn_id: hsnDropdown.value || null,
    purchase_price: parseFloat(purchasePrice.value) || 0,
    purchase_price_gst: parseFloat(purchasePriceGST.value) || 0,
    landing_price_gst: parseFloat(landingPriceGST.value) || 0,
    retail_price: parseFloat(retailPrice.value) || 0,
    retail_price_gst: parseFloat(retailPriceGST.value) || 0,
    wholesale_price: parseFloat(wholesalePrice.value) || 0,
    wholesale_price_gst: parseFloat(wholesalePriceGST.value) || 0,
    special_price: parseFloat(specialPrice.value) || 0,
    special_price_gst: parseFloat(specialPriceGST.value) || 0,
    department: document.getElementById("department").value.trim(),
    online_offline: document.getElementById("onlineOffline").value,
    image_url: "" // handle image upload separately
  };

  try {
    if (editingId) {
      const { error } = await supabaseClient.from("products").update(product).eq("product_id", editingId);
      if (error) throw error;
      showBanner("Product updated successfully!", "success");
    } else {
      const { error } = await supabaseClient.from("products").insert([product]);
      if (error) throw error;
      showBanner("Product added successfully!", "success");
    }

    form.reset();
    editingId = null;
    itemCodeInput.value = await generateItemCode();
    document.getElementById("saveBtn").textContent = "Save Product";
    loadProducts();
  } catch (err) {
    showBanner("Error saving product: " + err.message, "error");
  }
});

// ✅ Edit product
window.editProduct = async function(id) {
  const { data, error } = await supabaseClient.from("products").select("*").eq("product_id", id).single();
  if (error) {
    showBanner("Error loading product: " + error.message, "error");
    return;
  }

  editingId = id;
  itemCodeInput.value = data.item_code;
  document.getElementById("itemName").value = data.item_name;
  purchasePrice.value = data.purchase_price;
  purchasePriceGST.value = data.purchase_price_gst;
  landingPriceGST.value = data.landing_price_gst;
  retailPrice.value = data.retail_price;
  retailPriceGST.value = data.retail_price_gst;
  wholesalePrice.value = data.wholesale_price;
  wholesalePriceGST.value = data.wholesale_price_gst;
  specialPrice.value = data.special_price;
  specialPriceGST.value = data.special_price_gst;
  document.getElementById("department").value = data.department;
  document.getElementById("onlineOffline").value = data.online_offline;
  document.getElementById("saveBtn").textContent = "Update Product";
};

// ✅ Delete product
window.deleteProduct = async function(id) {
  if (!confirm("Are you sure you want to delete this product?")) return;
  const { error } = await supabaseClient.from("products").delete().eq("product_id", id);
  if (error) {
    showBanner("Error deleting product: " + error.message, "error");
  } else {
    showBanner("Product deleted successfully!", "success");
    loadProducts();
  }
};

// ✅ Select all toggle
document.getElementById("selectAll").addEventListener("change", (e) => {
  document.querySelectorAll(".rowSelect").forEach(cb => cb.checked = e.target.checked);
});

// ✅ Delete multiple items
document.getElementById("deleteBulkBtn").addEventListener("click", async () => {
  const selected = Array.from(document.querySelectorAll(".rowSelect:checked")).map(cb => cb.value);
  if (selected.length === 0) {
    showBanner("No products selected.", "warning");
    return;
  }
  if (!confirm(`Delete ${selected.length} products?`)) return;

  const { error } = await supabaseClient.from("products").delete().in("product_id", selected);
  if (error) {
    showBanner("Error deleting products: " + error.message, "error");
  } else {
    showBanner("Products deleted successfully!", "success");
    loadProducts();
  }
});

// ✅ Bulk upload (CSV parsing)
document.getElementById("addBulkBtn").addEventListener("click", () => {
  document.getElementById("bulkUpload").click();
});

document.getElementById("bulkUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const text = evt.target.result;
    const rows = text.split("\n").map(r => r.split(","));
    // Assuming CSV headers: item_name,hsn_code,purchase_price,retail_price,...
    const products = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 5) continue;
      products.push({
        item_code: await generateItemCode(),
        item_name: r[0],
        hsn_id: null, // resolve HSN manually if needed
        purchase_price: parseFloat(r[2]) || 0,
        purchase_price_gst: parseFloat(r[3]) || 0,
        landing_price_gst: parseFloat(r[4]) || 0,
        retail_price: parseFloat(r[5]) || 0,
        retail_price_gst: parseFloat(r[6]) || 0,
        wholesale_price: parseFloat(r[7]) || 0,
        wholesale_price_gst: parseFloat(r[8]) || 0,
        special_price: parseFloat(r[9]) || 0,
        special_price_gst: parseFloat(r[10]) || 0,
        department: r[11],
        online_offline: r[12],
        image_url: ""
      });
    }

    const { error } = await supabaseClient.from("products").insert(products);
    if (error) {
      showBanner("Error bulk inserting: " + error.message, "error");
    } else {
      showBanner("Bulk products added successfully!", "success");
      loadProducts();
    }
  };
  reader.readAsText(file);
});

// ✅ Bulk edit mode toggle
document.getElementById("enableBulkEditBtn").addEventListener("click", () => {
  bulkEditEnabled = true;
  document.getElementById("enableBulkEditBtn").style.display = "none";
  document.getElementById("disableBulkEditBtn").style.display = "inline-block";
  document.getElementById("saveAllBtn").style.display = "inline-block";
  document.getElementById("discardBtn").style.display = "inline-block";
  loadProducts();
});

document.getElementById("disableBulkEditBtn").addEventListener("click", () => {
  bulkEditEnabled = false;
  pendingChanges = {};
  document.getElementById("disableBulkEditBtn").style.display = "none";
  document.getElementById("saveAllBtn").style.display = "none";
  document.getElementById("discardBtn").style.display = "none";
  document.getElementById("enableBulkEditBtn").style.display = "inline-block";
  loadProducts();
});

// ✅ Track edits and highlight cells
tableBody.addEventListener("input", (e) => {
  if (bulkEditEnabled && e.target.hasAttribute("contenteditable")) {
    const id = e.target.dataset.id;
    const field = e.target.dataset.field;
    const value = e.target.textContent.trim();

    if (!pendingChanges[id]) pendingChanges[id] = {};
    pendingChanges[id][field] = value;

    e.target.classList.add("edited-cell");
  }
});

// ✅ Save all pending changes
document.getElementById("saveAllBtn").addEventListener("click", async () => {
  const updates = Object.entries(pendingChanges);
  if (updates.length === 0) {
    showBanner("No changes to save.", "warning");
    return;
  }

  try {
    for (const [id, fields] of updates) {
      const { error } = await supabaseClient.from("products").update(fields).eq("product_id", id);
      if (error) throw error;
    }
    showBanner("All changes saved successfully!", "success");
    pendingChanges = {};
    document.querySelectorAll(".edited-cell").forEach(cell => cell.classList.remove("edited-cell"));
    loadProducts();
  } catch (err) {
    showBanner("Error saving changes: " + err.message, "error");
  }
});

// ✅ Discard all pending changes
document.getElementById("discardBtn").addEventListener("click", () => {
  if (!confirm("Discard all unsaved changes?")) return;
  pendingChanges = {};
  document.querySelectorAll(".edited-cell").forEach(cell => cell.classList.remove("edited-cell"));
  loadProducts();
  showBanner("All unsaved changes discarded.", "warning");
});