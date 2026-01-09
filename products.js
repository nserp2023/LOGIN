const { createClient } = supabase;
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// Elements
const form = document.getElementById("productForm");
const tableBody = document.getElementById("productTableBody");
const itemCodeInput = document.getElementById("itemCode");
const hsnSearch = document.getElementById("hsnSearch");
const hsnDropdown = document.getElementById("hsnDropdown");
const gstPercentInput = document.getElementById("gstPercent");

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

// Helpers
function showBanner(message, type = "success") {
  const banner = document.getElementById("banner");
  banner.textContent = message;
  banner.className = "banner banner-" + type;
  banner.style.display = "block";
  setTimeout(() => { banner.style.display = "none"; }, 3000);
}
function toNum(v) { return parseFloat(v) || 0; }
function addGST(base, gst) { return +(base + (base * gst / 100)).toFixed(2); }
function removeGST(gross, gst) { return +(gross / (1 + gst / 100)).toFixed(2); }

// Auto-generate item code (robust)
async function generateItemCode() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("item_code")
    .order("product_id", { ascending: false })
    .limit(50);

  if (error || !data || data.length === 0) return "ITEM-001";

  let lastValid = null;
  for (const row of data) {
    const match = row.item_code && row.item_code.match(/^ITEM-(\d+)$/);
    if (match) {
      lastValid = parseInt(match[1]);
      break;
    }
  }
  if (!lastValid) return "ITEM-001";
  const nextNum = lastValid + 1;
  return `ITEM-${String(nextNum).padStart(3, "0")}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  itemCodeInput.value = await generateItemCode();
  loadProducts();
});

// HSN search
hsnSearch.addEventListener("input", async () => {
  const term = hsnSearch.value.trim();
  if (!term) { hsnDropdown.innerHTML = ""; return; }
  const { data, error } = await supabaseClient
    .from("hsn_codes")
    .select("*")
    .or(`hsn_code.ilike.%${term}%,description.ilike.%${term}%`)
    .limit(20);
  if (error) return console.error(error);
  hsnDropdown.innerHTML = "";
  data.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.hsn_id;
    opt.textContent = `${h.hsn_code} — ${h.description} (GST ${h.gst_percent}%)`;
    hsnDropdown.appendChild(opt);
  });
});

// HSN change → load GST%
hsnDropdown.addEventListener("change", async () => {
  const selectedId = hsnDropdown.value;
  if (!selectedId) return;
  gstPercentInput.value = "…";
  const { data, error } = await supabaseClient
    .from("hsn_codes")
    .select("*")
    .eq("hsn_id", selectedId)
    .single();
  if (error || !data) {
    gstPercentInput.value = "";
    console.error(error);
    return;
  }
  currentHSN = data;
  gstPercentInput.value = parseFloat(data.gst_percent).toFixed(2);
});

// Pricing rules
purchasePrice.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  const base = toNum(purchasePrice.value);
  purchasePriceGST.value = addGST(base, gst);
  landingPriceGST.value = purchasePriceGST.value;
});
purchasePriceGST.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  const gross = toNum(purchasePriceGST.value);
  const base = removeGST(gross, gst);
  purchasePrice.value = base;
  landingPriceGST.value = purchasePriceGST.value;
});
landingPriceGST.addEventListener("input", () => {});

retailPrice.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  retailPriceGST.value = addGST(toNum(retailPrice.value), gst);
});
retailPriceGST.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  retailPrice.value = removeGST(toNum(retailPriceGST.value), gst);
});

wholesalePrice.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  wholesalePriceGST.value = addGST(toNum(wholesalePrice.value), gst);
});
wholesalePriceGST.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  wholesalePrice.value = removeGST(toNum(wholesalePriceGST.value), gst);
});

specialPrice.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  specialPriceGST.value = addGST(toNum(specialPrice.value), gst);
});
specialPriceGST.addEventListener("input", () => {
  const gst = toNum(gstPercentInput.value);
  specialPrice.value = removeGST(toNum(specialPriceGST.value), gst);
});

// Load products
async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*, hsn_codes(hsn_code)")
    .order("product_id", { ascending: true });
  if (error) return showBanner("Error loading products: " + error.message, "error");
  renderProducts(data);
}
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
    purchase_price: toNum(purchasePrice.value),
    purchase_price_gst: toNum(purchasePriceGST.value),
    landing_price_gst: toNum(landingPriceGST.value),
    retail_price: toNum(retailPrice.value),
    retail_price_gst: toNum(retailPriceGST.value),
    wholesale_price: toNum(wholesalePrice.value),
    wholesale_price_gst: toNum(wholesalePriceGST.value),
    special_price: toNum(specialPrice.value),
    special_price_gst: toNum(specialPriceGST.value),
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

// ✅ Row selection highlight
tableBody.addEventListener("change", (e) => {
  if (e.target.classList.contains("rowSelect")) {
    const row = e.target.closest("tr");
    if (e.target.checked) {
      row.classList.add("selected");
    } else {
      row.classList.remove("selected");
    }
  }
});

// ✅ Select all toggle
document.getElementById("selectAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll(".rowSelect").forEach(cb => {
    cb.checked = checked;
    const row = cb.closest("tr");
    if (checked) {
      row.classList.add("selected");
    } else {
      row.classList.remove("selected");
    }
  });
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
    const products = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 5) continue;
      const itemCode = await generateItemCode();
      products.push({
        item_code: itemCode,
        item_name: r[0],
        hsn_id: null,
        purchase_price: toNum(r[2]),
        purchase_price_gst: toNum(r[3]),
        landing_price_gst: toNum(r[4]),
        retail_price: toNum(r[5]),
        retail_price_gst: toNum(r[6]),
        wholesale_price: toNum(r[7]),
        wholesale_price_gst: toNum(r[8]),
        special_price: toNum(r[9]),
        special_price_gst: toNum(r[10]),
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