// purchase.js
"use strict";

/* -------------------------
   Supabase client (CDN setup)
   ------------------------- */
const supabaseClient = supabase.createClient(
  "https://gqxczzijntbvtlmmzppt.supabase.co",   // your project URL
  "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs" // your anon key
);

/* -------------------------
   DOM lookups
   ------------------------- */
const form = document.getElementById("purchaseForm");
const banner = document.getElementById("banner");
const billNumberInput = document.getElementById("billNumber");
const entryDateInput = document.getElementById("entryDate");
const supplierNameInput = document.getElementById("supplierNameInput");
const supplierGSTInput = document.getElementById("supplierGSTInput");
const supplierNameList = document.getElementById("supplierNameList");
const supplierGSTList = document.getElementById("supplierGSTList");
const invoiceNumberInput = document.getElementById("invoiceNumber");
const invoiceDateInput = document.getElementById("invoiceDate");
const invoiceAmountInput = document.getElementById("invoiceAmount");
const roundOffInput = document.getElementById("roundOff");
const netPayableInput = document.getElementById("netPayable");
const purchaseTbody = document.getElementById("purchaseTbody");
const addProductBtn = document.getElementById("addProductBtn");
const savePurchaseBtn = document.getElementById("savePurchaseBtn");

/* -------------------------
   Banner helpers
   ------------------------- */
function showBanner(msg, type = "info") {
  if (!banner) return;
  banner.textContent = msg;
  banner.className = "banner banner-" + type;
  banner.style.display = "block";
}
function hideBanner() {
  if (!banner) return;
  banner.style.display = "none";
}

/* -------------------------
   Utility helpers
   ------------------------- */
function toNum(v) { return parseFloat(v) || 0; }
function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

/* -------------------------
   Bill number generator
   ------------------------- */
async function generateBillNumber() {
  try {
    const { count, error } = await supabaseClient
      .from("purchases")
      .select("*", { count: "exact", head: true });
    if (error) return "BILL-001";
    const next = (count || 0) + 1;
    return "BILL-" + next.toString().padStart(3, "0");
  } catch {
    return "BILL-001";
  }
}

/* -------------------------
   Load suppliers
   ------------------------- */
async function loadSuppliers() {
  const { data, error } = await supabaseClient.from("suppliers").select("*");
  if (error || !Array.isArray(data)) return;

  supplierNameList.innerHTML = "";
  supplierGSTList.innerHTML = "";

  data.forEach(supplier => {
    const nameOption = document.createElement("option");
    nameOption.value = supplier.supplier_name ?? supplier.name ?? "";
    supplierNameList.appendChild(nameOption);

    const gstOption = document.createElement("option");
    gstOption.value = supplier.supplier_gst ?? supplier.gst_number ?? "";
    supplierGSTList.appendChild(gstOption);
  });

  supplierNameInput?.addEventListener("change", () => {
    const match = data.find(s => s.supplier_name === supplierNameInput.value || s.name === supplierNameInput.value);
    if (match) supplierGSTInput.value = match.supplier_gst ?? match.gst_number ?? "";
  });

  supplierGSTInput?.addEventListener("change", () => {
    const match = data.find(s => s.supplier_gst === supplierGSTInput.value || s.gst_number === supplierGSTInput.value);
    if (match) supplierNameInput.value = match.supplier_name ?? match.name ?? "";
  });
}

/* -------------------------
   Product search & autocomplete
   ------------------------- */
async function searchProductsByKeywords(input) {
  if (!input) return [];
  const keywords = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return [];

  const orParts = keywords.flatMap(kw => {
    const escaped = kw.replace(/[%_]/g, "\\$&");
    return [`item_name.ilike.%${escaped}%`, `item_code.ilike.%${escaped}%`];
  });
  const orClause = orParts.join(",");

  const { data, error } = await supabaseClient.from("products").select("*").or(orClause);
  if (error) return [];
  return (data || []).filter(p => {
    const combined = `${p.item_name || ""} ${p.item_code || ""}`.toLowerCase();
    return keywords.every(kw => combined.includes(kw));
  });
}

function setupProductAutocomplete(inputEl, row) {
  let timer = 0;
  inputEl.addEventListener("input", async () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const results = await searchProductsByKeywords(inputEl.value);
      if (results.length === 1) fillRowWithProduct(row, results[0]);
      else if (results.length > 1) showBanner(`${results.length} matches found. Refine keywords.`, "info");
    }, 250);
  });
}

function fillRowWithProduct(row, product) {
  const setVal = (sel, val) => { const el = row.querySelector(sel); if (el instanceof HTMLInputElement) el.value = val ?? ""; };
  setVal(".itemCode", product.item_code);
  setVal(".productName", product.item_name ?? "");
  setVal(".hsnCode", product.product_hsn_code ?? "");
  updateNetPayable();
}

/* -------------------------
   Add product row (HSN last)
   ------------------------- */
function addProductRow() {
  if (!purchaseTbody) return;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="itemCode" placeholder="Code"></td>
    <td><input type="text" class="productName" placeholder="Name"></td>
    <td><input type="number" class="qty" value="1" min="1"></td>
    <td><input type="number" class="price" value="0" step="0.01"></td>
    <td><input type="number" class="discountPercent" value="0" step="0.01"></td>
    <td><input type="number" class="total" value="0" step="0.01" readonly></td>
    <td><input type="number" class="gstPercent" value="0" step="0.01"></td>
    <td><input type="number" class="totalWithGST" value="0" step="0.01" readonly></td>
    <td><input type="number" class="purchasePrice" value="0" step="0.01"></td>
    <td><input type="number" class="purchasePriceGst" value="0" step="0.01" readonly></td>
    <td><input type="number" class="landingPrice" value="0" step="0.01"></td>
    <td><input type="number" class="landingPriceGst" value="0" step="0.01" readonly></td>
    <td><input type="number" class="retailPercent" value="0" step="0.01"></td>
    <td><input type="number" class="retailPrice" value="0" step="0.01"></td>
    <td><input type="number" class="retailPriceGst" value="0" step="0.01" readonly></td>
    <td><input type="number" class="wholesalePercent" value="0" step="0.01"></td>
    <td><input type="number" class="wholesalePrice" value="0" step="0.01"></td>
    <td><input type="number" class="wholesalePriceGst" value="0" step="0.01" readonly></td>
    <td><input type="number" class="specialPercent" value="0" step="0.01"></td>
    <td><input type="number" class="specialPrice" value="0" step="0.01"></td>
    <td><input type="number" class="specialPriceGst" value="0" step="0.01" readonly></td>
    <td><input type="text" class="hsnCode" placeholder="HSN"></td>
  `;

  purchaseTbody.appendChild(row);

  const productNameInput = row.querySelector(".productName");
  if (productNameInput) setupProductAutocomplete(productNameInput, row);

  wireRowCalculations(row);
}

/* -------------------------
/* -------------------------
   Row calculations
   ------------------------- */
function wireRowCalculations(row) {
  const q = sel => row.querySelector(sel);

  const recalc = () => {
    const qty = toNum(q(".qty").value);
    const price = toNum(q(".price").value);
    const discPct = toNum(q(".discountPercent").value);
    const gstPct = toNum(q(".gstPercent").value);

    // Line totals
    const lineBase = qty * price;
    const discAmt = lineBase * (discPct / 100);
    const totalBeforeGst = lineBase - discAmt;
    const gstAmt = totalBeforeGst * (gstPct / 100);
    const totalWithGst = totalBeforeGst + gstAmt;

    q(".total").value = round2(totalBeforeGst);
    q(".totalWithGST").value = round2(totalWithGst);

    // Purchase snapshot (per-unit)
    const purchasePrice = price - (price * discPct / 100);
    const purchasePriceGst = purchasePrice * (1 + gstPct / 100);

    q(".purchasePrice").value = round2(purchasePrice);
    q(".purchasePriceGst").value = round2(purchasePriceGst);

    // Landing price (same as purchase for now)
    q(".landingPrice").value = round2(purchasePrice);
    q(".landingPriceGst").value = round2(purchasePriceGst);

    // Derived selling prices
    const retailPct = toNum(q(".retailPercent").value);
    const wholesalePct = toNum(q(".wholesalePercent").value);
    const specialPct = toNum(q(".specialPercent").value);

    const retailPrice = purchasePrice * (1 + retailPct / 100);
    const wholesalePrice = purchasePrice * (1 + wholesalePct / 100);
    const specialPrice = purchasePrice * (1 + specialPct / 100);

    q(".retailPrice").value = round2(retailPrice);
    q(".retailPriceGst").value = round2(retailPrice * (1 + gstPct / 100));

    q(".wholesalePrice").value = round2(wholesalePrice);
    q(".wholesalePriceGst").value = round2(wholesalePrice * (1 + gstPct / 100));

    q(".specialPrice").value = round2(specialPrice);
    q(".specialPriceGst").value = round2(specialPrice * (1 + gstPct / 100));

    updateNetPayable();
  };

  // Attach listeners
  ["qty", "price", "discountPercent", "gstPercent",
   "retailPercent", "wholesalePercent", "specialPercent"].forEach(cls => {
    const el = q("." + cls);
    if (el) el.addEventListener("input", recalc);
  });

  recalc(); // initial calculation
}

/* -------------------------
   Totals and validation
   ------------------------- */
function sumTableTotals() {
  if (!purchaseTbody) return 0;
  let sum = 0;
  purchaseTbody.querySelectorAll(".totalWithGST").forEach(el => {
    sum += toNum(el.value);
  });
  return round2(sum);
}

function updateNetPayable() {
  const itemsTotal = sumTableTotals();
  const roundOff = toNum(roundOffInput?.value || 0);
  const net = round2(itemsTotal + roundOff);
  if (netPayableInput) netPayableInput.value = net;
}

function validateBalance() {
  updateNetPayable();
  const invoiceAmount = toNum(invoiceAmountInput?.value || 0);
  const netPayable = toNum(netPayableInput?.value || 0);

  if (Math.abs(netPayable - invoiceAmount) > 0.01) {
    showBanner("⚠️ Totals mismatch — Net Payable differs from Invoice Amount.", "warning");
    savePurchaseBtn?.removeAttribute("disabled");
  } else {
    hideBanner();
    savePurchaseBtn?.removeAttribute("disabled");
  }
}

async function validateBeforeSave() {
  hideBanner();

  // Duplicate invoice check
  const supplier = supplierNameInput?.value?.trim() || "";
  const invoiceNo = invoiceNumberInput?.value?.trim() || "";
  if (supplier && invoiceNo) {
    const { data, error } = await supabaseClient
      .from("purchases")
      .select("purchase_id", { count: "exact" })
      .eq("supplier_name", supplier)
      .eq("invoice_number", invoiceNo)
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      showBanner("❌ Duplicate invoice detected for this supplier.", "error");
      savePurchaseBtn?.removeAttribute("disabled");
      return true;
    }
  }

  // Totals mismatch warning
  const invoiceAmount = toNum(invoiceAmountInput?.value || 0);
  const netPayable = toNum(netPayableInput?.value || 0);
  if (Math.abs(netPayable - invoiceAmount) > 0.01) {
    showBanner("⚠️ Net Payable does not equal Invoice Amount.", "warning");
    savePurchaseBtn?.removeAttribute("disabled");
    return true;
  }

  savePurchaseBtn?.removeAttribute("disabled");
  return true;
}

/* -------------------------
   Collect items
   ------------------------- */
function collectItems(purchase_id) {
  if (!purchaseTbody) return [];
  return Array.from(purchaseTbody.querySelectorAll("tr")).map(row => {
    const getVal = (sel) => {
      const el = row.querySelector(sel);
      return el instanceof HTMLInputElement ? parseFloat(el.value) || 0 : 0;
    };
    const item_code = row.querySelector(".itemCode")?.value.trim() || "";
    const item_name = row.querySelector(".productName")?.value.trim() || "";
    if (!item_code || !item_name) return null;

    return {
      purchase_id,
      item_code,
      item_name,
      quantity: getVal(".qty"),
      price: getVal(".price"),
      discount_percent: getVal(".discountPercent"),
      total_before_gst: getVal(".total"),
      gst_percent: getVal(".gstPercent"),
      total_with_gst: getVal(".totalWithGST"),
      purchase_price: getVal(".purchasePrice"),
      purchase_price_gst: getVal(".purchasePriceGst"),
      landing_price: getVal(".landingPrice"),
      landing_price_gst: getVal(".landingPriceGst"),
      retail_percent: getVal(".retailPercent"),
      retail_price: getVal(".retailPrice"),
      retail_price_gst: getVal(".retailPriceGst"),
      wholesale_percent: getVal(".wholesalePercent"),
      wholesale_price: getVal(".wholesalePrice"),
      wholesale_price_gst: getVal(".wholesalePriceGst"),
      special_percent: getVal(".specialPercent"),
      special_price: getVal(".specialPrice"),
      special_price_gst: getVal(".specialPriceGst"),
      hsn_code: row.querySelector(".hsnCode")?.value.trim() || ""
    };
  }).filter(i => i !== null);
}

/* -------------------------
   Update products with purchase snapshot
   ------------------------- */
async function updateProductsFromPurchase(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const rowsToUpsert = items.map(item => ({
    item_code: item.item_code,
    item_name: item.item_name,
    purchase_price: item.purchase_price,
    purchase_price_gst: item.purchase_price_gst,
    landing_price: item.landing_price,
    landing_price_gst: item.landing_price_gst,
    retail_percent: item.retail_percent,
    retail_price: item.retail_price,
    retail_price_gst: item.retail_price_gst,
    wholesale_percent: item.wholesale_percent,
    wholesale_price: item.wholesale_price,
    wholesale_price_gst: item.wholesale_price_gst,
    special_percent: item.special_percent,
    special_price: item.special_price,
    special_price_gst: item.special_price_gst
  }));

  const { data, error } = await supabaseClient
    .from("products")
    .upsert(rowsToUpsert, { onConflict: "item_code" });

  if (error) {
    console.error("Error updating products:", error);
    showBanner("Error updating products: " + error.message, "error");
    return;
  }

  console.log("Products updated:", data);
}

/* -------------------------
   Save purchase handler
   ------------------------- */
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const purchase = {
        bill_number: billNumberInput?.value || "",
        entry_date: entryDateInput?.value || "",
        invoice_date: invoiceDateInput?.value || "",
        invoice_number: invoiceNumberInput?.value || "",
        supplier_name: supplierNameInput?.value || "",
        supplier_gst: supplierGSTInput?.value || "",
        invoice_amount: toNum(invoiceAmountInput?.value || 0),
        round_off: toNum(roundOffInput?.value || 0),
        net_payable: toNum(netPayableInput?.value || 0)
      };

const { data: purchaseData, error } = await supabaseClient
  .from("purchases")
  .insert([purchase])

          .select()
        .single();
      if (error) throw error;

      // Collect purchase items
      const items = collectItems(purchaseData.purchase_id);

      // Insert purchase items
      const { error: itemError } = await supabaseClient
        .from("purchase_items")
        .insert(items);
      if (itemError) throw itemError;

      // Update product prices
      await updateProductsFromPurchase(items);

      showBanner("✅ Purchase saved successfully!", "success");

      // Reset form for next entry
      form.reset();
      if (entryDateInput) entryDateInput.value = new Date().toISOString().split("T")[0];
      if (billNumberInput) billNumberInput.value = await generateBillNumber();
      if (purchaseTbody) purchaseTbody.innerHTML = "";
      addProductRow();
      updateNetPayable();
      if (savePurchaseBtn) {
        savePurchaseBtn.disabled = false;
        savePurchaseBtn.removeAttribute("data-tooltip");
      }
    } catch (err) {
      console.error("Save purchase error:", err);
      const msg = err && err.message ? err.message : String(err);
      showBanner("❌ Error saving purchase: " + msg, "error");
      if (savePurchaseBtn) {
        savePurchaseBtn.disabled = false; // keep enabled
        savePurchaseBtn.setAttribute("data-tooltip", "Fix errors before saving");
      }
    }
  });
}

/* -------------------------
   Init and balance wiring
   ------------------------- */
(async () => {
  if (entryDateInput) entryDateInput.value = new Date().toISOString().split("T")[0];
  if (billNumberInput) billNumberInput.value = await generateBillNumber();
  addProductRow();
  loadSuppliers();
  addProductBtn?.addEventListener("click", addProductRow);

  invoiceAmountInput?.addEventListener("input", () => {
    validateBalance();
  });
  roundOffInput?.addEventListener("input", () => {
    updateNetPayable();
  });

  if (form && !form.__hasValidateBeforeSaveGuard) {
    form.addEventListener("submit", async (e) => {
      const ok = await validateBeforeSave();
      if (!ok) {
        e.preventDefault();
        return;
      }
    });
    form.__hasValidateBeforeSaveGuard = true;
  }
})();