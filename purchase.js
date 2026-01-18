// @ts-check   // enables type checking but keeps it manageable

// Initialize Supabase
const supabaseClient = supabase.createClient(
  "https://gqxczzijntbvtlmmzppt.supabase.co",
  "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs"
);

// Safe DOM lookups
const form = /** @type {HTMLFormElement|null} */ (document.getElementById("purchaseForm"));
const banner = /** @type {HTMLDivElement|null} */ (document.getElementById("banner"));
const billNumberInput = /** @type {HTMLInputElement|null} */ (document.getElementById("billNumber"));
const entryDateInput = /** @type {HTMLInputElement|null} */ (document.getElementById("entryDate"));
const supplierNameInput = /** @type {HTMLInputElement|null} */ (document.getElementById("supplierNameInput"));
const supplierGSTInput = /** @type {HTMLInputElement|null} */ (document.getElementById("supplierGSTInput"));
const supplierNameList = /** @type {HTMLDataListElement|null} */ (document.getElementById("supplierNameList"));
const supplierGSTList = /** @type {HTMLDataListElement|null} */ (document.getElementById("supplierGSTList"));
const invoiceNumberInput = /** @type {HTMLInputElement|null} */ (document.getElementById("invoiceNumber"));
const invoiceDateInput = /** @type {HTMLInputElement|null} */ (document.getElementById("invoiceDate"));
const invoiceAmountInput = /** @type {HTMLInputElement|null} */ (document.getElementById("invoiceAmount"));
const roundOffInput = /** @type {HTMLInputElement|null} */ (document.getElementById("roundOff"));
const netPayableInput = /** @type {HTMLInputElement|null} */ (document.getElementById("netPayable"));
const purchaseTbody = /** @type {HTMLTableSectionElement|null} */ (document.getElementById("purchaseTbody"));
const addProductBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("addProductBtn"));
const savePurchaseBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("savePurchaseBtn"));

// Utility
function showBanner(msg, type) {
  if (!banner) return;
  banner.textContent = msg;
  banner.className = "banner banner-" + type;
  banner.style.display = "block";
}
function toNum(val) { return parseFloat(val) || 0; }

// Generate Bill Number
async function generateBillNumber() {
  const { count, error } = await supabaseClient
    .from("purchases")
    .select("*", { count: "exact", head: true });
  if (error) { console.error(error); return "BILL-001"; }
  const next = (count || 0) + 1;
  return "BILL-" + next.toString().padStart(3, "0");
}

// Load Suppliers
async function loadSuppliers() {
  const { data, error } = await supabaseClient.from("suppliers").select("*");
  if (error) {
    console.error("Error loading suppliers:", error);
    showBanner("Could not load suppliers.", "error");
    return;
  }
  if (!Array.isArray(data) || !supplierNameList || !supplierGSTList) return;

  const nameKey = data.length && ("supplier_name" in data[0] ? "supplier_name" : "name");
  const gstKey  = data.length && ("supplier_gst" in data[0] ? "supplier_gst" : "gst_number");

  supplierNameList.innerHTML = "";
  supplierGSTList.innerHTML = "";

  data.forEach(supplier => {
    const nameOption = document.createElement("option");
    nameOption.value = supplier[nameKey] ?? "";
    supplierNameList.appendChild(nameOption);

    const gstOption = document.createElement("option");
    gstOption.value = supplier[gstKey] ?? "";
    supplierGSTList.appendChild(gstOption);
  });

  supplierNameInput?.addEventListener("change", () => {
    const match = data.find(s => s[nameKey] === supplierNameInput.value);
    if (match) supplierGSTInput.value = match[gstKey];
  });

  supplierGSTInput?.addEventListener("change", () => {
    const match = data.find(s => s[gstKey] === supplierGSTInput.value);
    if (match) supplierNameInput.value = match[nameKey];
  });
}

// --- Override Helper ---
function setupOverride(row, baseSelector, percentSelector, priceSelector, priceWithGSTSelector) {
  const baseInput = row.querySelector(baseSelector);
  const percentInput = row.querySelector(percentSelector);
  const priceInput = row.querySelector(priceSelector);
  const priceWithGSTInput = row.querySelector(priceWithGSTSelector);

  if (!baseInput || !percentInput || !priceInput || !priceWithGSTInput) return;

  function getNum(el) {
    return el instanceof HTMLInputElement ? parseFloat(el.value) || 0 : 0;
  }

  function recalcFromPercent() {
    const base = getNum(baseInput);
    const percent = getNum(percentInput);
    const gstPercent = getNum(row.querySelector(".gstPercent"));
    const gstMultiplier = 1 + gstPercent / 100;

    const price = base * (1 + percent / 100);
    priceInput.value = price.toFixed(2);
    priceWithGSTInput.value = (price * gstMultiplier).toFixed(2);
    updateNetPayable();
  }

  function recalcFromPrice() {
    const base = getNum(baseInput);
    const price = getNum(priceInput);
    const gstPercent = getNum(row.querySelector(".gstPercent"));
    const gstMultiplier = 1 + gstPercent / 100;

    const percent = base > 0 ? ((price / base) - 1) * 100 : 0;
    percentInput.value = percent.toFixed(2);
    priceWithGSTInput.value = (price * gstMultiplier).toFixed(2);
    updateNetPayable();
  }

  function recalcFromPriceWithGST() {
    const base = getNum(baseInput);
    const priceWithGST = getNum(priceWithGSTInput);
    const gstPercent = getNum(row.querySelector(".gstPercent"));
    const gstMultiplier = 1 + gstPercent / 100;

    const price = gstMultiplier > 0 ? priceWithGST / gstMultiplier : 0;
    priceInput.value = price.toFixed(2);

    const percent = base > 0 ? ((price / base) - 1) * 100 : 0;
    percentInput.value = percent.toFixed(2);
    updateNetPayable();
  }

  percentInput.addEventListener("input", recalcFromPercent);
  priceInput.addEventListener("input", recalcFromPrice);
  priceWithGSTInput.addEventListener("input", recalcFromPriceWithGST);
}

// Add Product Row
function addProductRow() {
  if (!purchaseTbody) return;
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="itemCode"></td>
    <td><input class="productName"></td>
    <td><input type="number" class="qty" step="0.01" value="1"></td>
    <td><input type="number" class="price" step="0.01"></td>
    <td><input type="number" class="discountPercent" step="0.01"></td>
    <td><input type="number" class="total" step="0.01" readonly></td>
    <td><input type="number" class="gstPercent" step="0.01"></td>
    <td><input type="number" class="totalWithGST" step="0.01" readonly></td>
    <td><input type="number" class="purchasePrice" step="0.01" readonly></td>
    <td><input type="number" class="purchaseWithGST" step="0.01" readonly></td>
    <td><input type="number" class="landingPrice" step="0.01"></td>
    <td><input type="number" class="landingPriceWithGST" step="0.01"></td>
    <td><input type="number" class="retailPercent" step="0.01"></td>
    <td><input type="number" class="retailPrice" step="0.01"></td>
    <td><input type="number" class="retailWithGST" step="0.01"></td>
    <td><input type="number" class="wholesalePercent" step="0.01"></td>
    <td><input type="number" class="wholesalePrice" step="0.01"></td>
    <td><input type="number" class="wholesaleWithGST" step="0.01"></td>
    <td><input type="number" class="specialPercent" step="0.01"></td>
    <td><input type="number" class="specialPrice" step="0.01"></td>
    <td><input type="number" class="specialWithGST" step="0.01"></td>
    <td><input class="hsnCode"></td>   <!-- ✅ New HSN Code field -->
    <td><button type="button" class="removeBtn">X</button></td>
  `;
  purchaseTbody.appendChild(row);

  const getNum = (sel) => {
    const el = row.querySelector(sel);
    return el instanceof HTMLInputElement && Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : 0;
  };

  let landingPriceManual = false;

  function recalc() {
    const qty = getNum(".qty");
    const price = getNum(".price");
    const discountPercent = getNum(".discountPercent");
    const gstPercent = getNum(".gstPercent");

    let grossTotal = qty * price;
    let netTotal = grossTotal - (grossTotal * discountPercent / 100);
    (row.querySelector(".total") instanceof HTMLInputElement) && (row.querySelector(".total").value = netTotal.toFixed(2));

    const gstMultiplier = 1 + gstPercent / 100;
    const totalWithGST = netTotal * gstMultiplier;
    (row.querySelector(".totalWithGST") instanceof HTMLInputElement) && (row.querySelector(".totalWithGST").value = totalWithGST.toFixed(2));

    let purchasePrice = qty > 0 ? netTotal / qty : 0;
    (row.querySelector(".purchasePrice") instanceof HTMLInputElement) && (row.querySelector(".purchasePrice").value = purchasePrice.toFixed(2));

    const purchaseWithGST = Number.isFinite(purchasePrice) ? purchasePrice * gstMultiplier : null;
    (row.querySelector(".purchaseWithGST") instanceof HTMLInputElement) && (row.querySelector(".purchaseWithGST").value = purchaseWithGST ? purchaseWithGST.toFixed(2) : "");

    let landingPrice = landingPriceManual ? getNum(".landingPrice") : (qty > 0 ? netTotal / qty : 0);
    if (row.querySelector(".landingPrice") instanceof HTMLInputElement) {
      row.querySelector(".landingPrice").value = landingPrice.toFixed(2);
    }

    const landingWithGST = Number.isFinite(landingPrice) ? landingPrice * gstMultiplier : null;
    if (row.querySelector(".landingPriceWithGST") instanceof HTMLInputElement) {
      row.querySelector(".landingPriceWithGST").value = landingWithGST ? landingWithGST.toFixed(2) : "";
    }

    updateNetPayable();
  }

  // Event listeners for base fields
  [".qty", ".price", ".discountPercent", ".gstPercent"].forEach(sel => {
    const el = row.querySelector(sel);
    if (el) el.addEventListener("input", recalc);
  });

  // Manual override for Landing Price
  const landingInput = row.querySelector(".landingPrice");
  if (landingInput) {
    landingInput.addEventListener("input", () => {
      landingPriceManual = true;
      const landingPrice = getNum(".landingPrice");
      const gstPercent = getNum(".gstPercent");
      const gstMultiplier = 1 + gstPercent / 100;
      if (row.querySelector(".landingPriceWithGST") instanceof HTMLInputElement) {
        row.querySelector(".landingPriceWithGST").value = (landingPrice * gstMultiplier).toFixed(2);
      }
      updateNetPayable();
    });
  }

  const removeBtn = row.querySelector(".removeBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      row.remove();
      updateNetPayable();
    });
  }

  // Setup overrides for Retail, Wholesale, Special
  setupOverride(row, ".purchasePrice", ".retailPercent", ".retailPrice", ".retailWithGST");
  setupOverride(row, ".purchasePrice", ".wholesalePercent", ".wholesalePrice", ".wholesaleWithGST");
  setupOverride(row, ".purchasePrice", ".specialPercent", ".specialPrice", ".specialWithGST");







const itemNameInput = row.querySelector(".productName");
const itemCodeInput = row.querySelector(".itemCode");

if (itemNameInput) setupProductAutocomplete(itemNameInput, row);
if (itemCodeInput) setupProductAutocomplete(itemCodeInput, row);









  recalc();
  const itemCode = row.querySelector(".itemCode");
  if (itemCode) itemCode.focus();
}

// Net Payable
function updateNetPayable() {
  if (!purchaseTbody || !netPayableInput || !roundOffInput) return;
  const rows = Array.from(purchaseTbody.querySelectorAll("tr"));
  const totalWithGSTSum = rows.reduce((sum, row) => {
    const el = row.querySelector(".totalWithGST");
    const val = el instanceof HTMLInputElement ? parseFloat(el.value) || 0 : 0;
    return sum + val;
  }, 0);

  const roundOff = parseFloat(roundOffInput.value) || 0;
  netPayableInput.value = (totalWithGSTSum + roundOff).toFixed(2);
}

// Collect Items
// Collect Items
function collectItems(purchase_id) {
  if (!purchaseTbody) return [];
  return Array.from(purchaseTbody.querySelectorAll("tr"))
    .map(row => {
      const getVal = (sel) => {
        const el = row.querySelector(sel);
        return el instanceof HTMLInputElement ? parseFloat(el.value) || 0 : 0;
      };
      const itemCode = (row.querySelector(".itemCode") instanceof HTMLInputElement) ? row.querySelector(".itemCode").value.trim() : "";
      const productName = (row.querySelector(".productName") instanceof HTMLInputElement) ? row.querySelector(".productName").value.trim() : "";

      // ✅ Skip row if either Item Code or Product Name is missing
      if (!itemCode || !productName) return null;

return {
  purchase_id,
  item_code: itemCode,
  product_name: productName,
  quantity: getVal(".qty"),
  price: getVal(".price"),
  discount_percent: getVal(".discountPercent"),
  total_before_gst: getVal(".total"),
  gst_percent: getVal(".gstPercent"),
  total_with_gst: getVal(".totalWithGST"),
  purchase_price: getVal(".purchasePrice"),
  purchase_with_gst: getVal(".purchaseWithGST"),
  landing_price: getVal(".landingPrice"),
  landing_price_with_gst: getVal(".landingPriceWithGST"),
  retail_percent: getVal(".retailPercent"),
  retail_price: getVal(".retailPrice"),
  retail_with_gst: getVal(".retailWithGST"),
  wholesale_percent: getVal(".wholesalePercent"),
  wholesale_price: getVal(".wholesalePrice"),
  wholesale_with_gst: getVal(".wholesaleWithGST"),
  special_percent: getVal(".specialPercent"),
  special_price: getVal(".specialPrice"),
  special_with_gst: getVal(".specialWithGST"),
  hsn_code: (row.querySelector(".hsnCode") instanceof HTMLInputElement) ? row.querySelector(".hsnCode").value.trim() : ""  // ✅ New field
};    })
    .filter(item => item !== null); // remove skipped rows
}
// Duplicate Invoice Validation
async function validateInvoiceUnique() {
  const supplierGST = supplierGSTInput?.value || "";
  const supplierName = supplierNameInput?.value || "";
  const invoiceNumber = invoiceNumberInput?.value || "";

  if (!invoiceNumber) {
    invoiceNumberInput?.classList.remove("error");
    if (savePurchaseBtn) savePurchaseBtn.disabled = false;
    return true;
  }

  let query = supabaseClient.from("purchases").select("purchase_id");
  if (supplierGST) {
    query = query.eq("supplier_gst", supplierGST);
  } else if (supplierName) {
    query = query.eq("supplier_name", supplierName);
  }
  query = query.eq("invoice_number", invoiceNumber).maybeSingle();

  const { data, error } = await query;
  if (error) {
    console.error("Validation error:", error);
    showBanner("Error checking invoice uniqueness.", "error");
    invoiceNumberInput?.classList.add("error");
    if (savePurchaseBtn) {
      savePurchaseBtn.disabled = true;
      savePurchaseBtn.setAttribute("data-tooltip", "Fix invoice number before saving");
    }
    return false;
  }

  if (data) {
    showBanner("This invoice number is already entered for this supplier!", "error");

    // Shake + highlight
    invoiceNumberInput?.classList.remove("error");
    void invoiceNumberInput?.offsetWidth; // reflow hack
    invoiceNumberInput?.classList.add("error");

    invoiceNumberInput?.focus();
    if (savePurchaseBtn) {
      savePurchaseBtn.disabled = true;
      savePurchaseBtn.setAttribute("data-tooltip", "Fix invoice number before saving");
    }
    return false;
  }

  // ✅ Unique
  invoiceNumberInput?.classList.remove("error");
  if (savePurchaseBtn) {
    savePurchaseBtn.disabled = false;
    savePurchaseBtn.removeAttribute("data-tooltip");
  }
  return true;
}

// Attach validation events
if (invoiceNumberInput) {
  invoiceNumberInput.addEventListener("blur", async () => {
    await validateInvoiceUnique();
  });
  invoiceNumberInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      const ok = await validateInvoiceUnique();
      if (!ok) e.preventDefault();
    }
  });
}

// Save Purchase
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const unique = await validateInvoiceUnique();
    if (!unique) return;

    // --- Final Validation: Net Payable + Round Off must equal Invoice Amount ---
    const invoiceAmount = parseFloat(invoiceAmountInput?.value || "0");
    const roundOff = parseFloat(roundOffInput?.value || "0");
    const netPayable = parseFloat(netPayableInput?.value || "0");

    if ((netPayable + roundOff).toFixed(2) !== invoiceAmount.toFixed(2)) {
      showBanner("Error: Net Payable + Round Off must equal Invoice Amount.", "error");
      if (savePurchaseBtn) {
        savePurchaseBtn.disabled = true;
        savePurchaseBtn.setAttribute("data-tooltip", "Fix invoice totals before saving");
      }
      return; // stop save
    }

    try {
      const purchase = {
        bill_number: billNumberInput?.value || "",
        entry_date: entryDateInput?.value || "",
        invoice_date: invoiceDateInput?.value || "",
        invoice_number: invoiceNumberInput?.value || "",
        supplier_name: supplierNameInput?.value || "",
        supplier_gst: supplierGSTInput?.value || "",
        invoice_amount: invoiceAmount,
        round_off: roundOff,
        net_payable: netPayable,
      };

      const { data: purchaseData, error } = await supabaseClient
        .from("purchases")
        .insert([purchase])
        .select()
        .single();
      if (error) throw error;

      const items = collectItems(purchaseData.purchase_id);
      const { error: itemError } = await supabaseClient
        .from("purchase_items")
        .insert(items);
      if (itemError) throw itemError;

      showBanner("Purchase saved successfully!", "success");

      form.reset();
      if (entryDateInput) entryDateInput.value = new Date().toISOString().split("T")[0];
      if (billNumberInput) billNumberInput.value = await generateBillNumber();
      if (purchaseTbody) purchaseTbody.innerHTML = "";
      addProductRow();
      updateNetPayable();
    } catch (err) {
      console.error(err);
      showBanner("Error saving purchase: " + err.message, "error");
      if (savePurchaseBtn) {
        savePurchaseBtn.disabled = true;
        savePurchaseBtn.setAttribute("data-tooltip", "Fix errors before saving");
      }
    }
  });
}

// Init
(async () => {
  if (entryDateInput) entryDateInput.value = new Date().toISOString().split("T")[0];
  if (billNumberInput) billNumberInput.value = await generateBillNumber();
  addProductRow();
  loadSuppliers();
  addProductBtn?.addEventListener("click", addProductRow);
})();

async function searchProductsByKeywords(input) {
  if (!input) return [];

  const keywords = input.trim().split(/\s+/);

  // Build a flat OR clause with all keyword filters
  const filters = keywords.flatMap(kw => {
    const escaped = kw.replace(/[%_]/g, "\\$&"); // escape wildcards
    return [
      `item_name.ilike.%${escaped}%`,
      `item_code.ilike.%${escaped}%`
    ];
  });

  const orClause = filters.join(",");

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .or(orClause);

  if (error) {
    console.error("Error searching products:", error);
    showBanner("Could not fetch products.", "error");
    return [];
  }

  return data || [];
}
function setupProductAutocomplete(inputEl, row) {
  inputEl.addEventListener("input", async () => {
    // ✅ Show loading banner
    if (banner) {
      banner.textContent = "Searching products…";
      banner.className = "banner banner-info";
      banner.style.display = "block";
    }

    const results = await searchProductsByKeywords(inputEl.value);

    // ✅ Hide banner after search
    if (banner) banner.style.display = "none";

    if (results.length === 1) {
      fillRowWithProduct(row, results[0]);
    } else if (results.length > 1) {
      showBanner(`${results.length} matches found. Refine keywords.`, "info");
    }
  });
}
function fillRowWithProduct(row, product) {
  const setVal = (sel, val) => {
    const el = row.querySelector(sel);
    if (el instanceof HTMLInputElement) el.value = val ?? "";
  };

  setVal(".itemCode", product.item_code);
  setVal(".productName", product.item_name);
  setVal(".price", product.price);
  setVal(".gstPercent", product.gst_percent);
  setVal(".purchasePrice", product.purchase_price);
  setVal(".purchaseWithGST", product.purchase_with_gst);
  setVal(".landingPrice", product.landing_price);
  setVal(".landingPriceWithGST", product.landing_price_with_gst);
  setVal(".retailPercent", product.retail_percent);
  setVal(".retailPrice", product.retail_price);
  setVal(".retailWithGST", product.retail_with_gst);
  setVal(".wholesalePercent", product.wholesale_percent);
  setVal(".wholesalePrice", product.wholesale_price);
  setVal(".wholesaleWithGST", product.wholesale_with_gst);
  setVal(".specialPercent", product.special_percent);
  setVal(".specialPrice", product.special_price);
  setVal(".specialWithGST", product.special_with_gst);
  setVal(".hsnCode", product.hsn_code);

  updateNetPayable();
}

