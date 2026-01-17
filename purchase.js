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

// Load Suppliers with merged fields
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

  if (!nameKey || !gstKey) {
    console.error("Suppliers table missing expected columns. Found keys:", data[0] ? Object.keys(data[0]) : []);
    showBanner("Suppliers table missing name/gst columns.", "error");
    return;
  }

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

  supplierNameInput?.addEventListener("change", () => {
  const supplierName = supplierNameInput.value;
  const supplierGST = supplierGSTInput.value;
  if (supplierName && supplierGST) {
    loadInvoicesForSupplier(supplierName, supplierGST);
  }
});

supplierGSTInput?.addEventListener("change", () => {
  const supplierName = supplierNameInput.value;
  const supplierGST = supplierGSTInput.value;
  if (supplierName && supplierGST) {
    loadInvoicesForSupplier(supplierName, supplierGST);
  }
});

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

    const retailPercent = getNum(".retailPercent");
    const wholesalePercent = getNum(".wholesalePercent");
    const specialPercent = getNum(".specialPercent");

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

    const retailPrice = purchasePrice * (1 + retailPercent / 100);
    if (row.querySelector(".retailPrice") instanceof HTMLInputElement) {
      row.querySelector(".retailPrice").value = retailPrice.toFixed(2);
    }
    if (row.querySelector(".retailWithGST") instanceof HTMLInputElement) {
      row.querySelector(".retailWithGST").value = (retailPrice * gstMultiplier).toFixed(2);
    }

    const wholesalePrice = purchasePrice * (1 + wholesalePercent / 100);
    if (row.querySelector(".wholesalePrice") instanceof HTMLInputElement) {
      row.querySelector(".wholesalePrice").value = wholesalePrice.toFixed(2);
    }
    if (row.querySelector(".wholesaleWithGST") instanceof HTMLInputElement) {
      row.querySelector(".wholesaleWithGST").value = (wholesalePrice * gstMultiplier).toFixed(2);
    }

    const specialPrice = purchasePrice * (1 + specialPercent / 100);
    if (row.querySelector(".specialPrice") instanceof HTMLInputElement) {
      row.querySelector(".specialPrice").value = specialPrice.toFixed(2);
    }
    if (row.querySelector(".specialWithGST") instanceof HTMLInputElement) {
      row.querySelector(".specialWithGST").value = (specialPrice * gstMultiplier).toFixed(2);
    }

    updateNetPayable();
  }

  // Event listeners
  [".qty", ".price", ".discountPercent", ".gstPercent",
   ".retailPercent", ".wholesalePercent", ".specialPercent"
  ].forEach(sel => {
    const el = row.querySelector(sel);
    if (el) el.addEventListener("input", recalc);
  });

  // --- Manual override for Retail ---
const retailInput = row.querySelector(".retailPrice");
const retailWithGSTInput = row.querySelector(".retailWithGST");
const retailPercentInput = row.querySelector(".retailPercent");

if (retailInput && retailWithGSTInput && retailPercentInput) {
  // When Retail Price changes
  retailInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    // Update % markup
    const retailPrice = getNum(".retailPrice");
    const percent = purchasePrice > 0 ? ((retailPrice / purchasePrice) - 1) * 100 : 0;
    retailPercentInput.value = percent.toFixed(2);

    // Update Retail+GST
    retailWithGSTInput.value = (retailPrice * gstMultiplier).toFixed(2);
    updateNetPayable();
  });

  // When Retail+GST changes
  retailWithGSTInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    // Back-calc Retail Price
    const retailWithGST = getNum(".retailWithGST");
    const retailPrice = gstMultiplier > 0 ? retailWithGST / gstMultiplier : 0;
    retailInput.value = retailPrice.toFixed(2);

    // Update % markup
    const percent = purchasePrice > 0 ? ((retailPrice / purchasePrice) - 1) * 100 : 0;
    retailPercentInput.value = percent.toFixed(2);
    updateNetPayable();
  });
}

// --- Manual override for Wholesale ---
const wholesaleInput = row.querySelector(".wholesalePrice");
const wholesaleWithGSTInput = row.querySelector(".wholesaleWithGST");
const wholesalePercentInput = row.querySelector(".wholesalePercent");

if (wholesaleInput && wholesaleWithGSTInput && wholesalePercentInput) {
  wholesaleInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    const wholesalePrice = getNum(".wholesalePrice");
    const percent = purchasePrice > 0 ? ((wholesalePrice / purchasePrice) - 1) * 100 : 0;
    wholesalePercentInput.value = percent.toFixed(2);

    wholesaleWithGSTInput.value = (wholesalePrice * gstMultiplier).toFixed(2);
    updateNetPayable();
  });

  wholesaleWithGSTInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    const wholesaleWithGST = getNum(".wholesaleWithGST");
    const wholesalePrice = gstMultiplier > 0 ? wholesaleWithGST / gstMultiplier : 0;
    wholesaleInput.value = wholesalePrice.toFixed(2);

    const percent = purchasePrice > 0 ? ((wholesalePrice / purchasePrice) - 1) * 100 : 0;
    wholesalePercentInput.value = percent.toFixed(2);
    updateNetPayable();
  });
}

// --- Manual override for Special ---
const specialInput = row.querySelector(".specialPrice");
const specialWithGSTInput = row.querySelector(".specialWithGST");
const specialPercentInput = row.querySelector(".specialPercent");

if (specialInput && specialWithGSTInput && specialPercentInput) {
  specialInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    const specialPrice = getNum(".specialPrice");
    const percent = purchasePrice > 0 ? ((specialPrice / purchasePrice) - 1) * 100 : 0;
    specialPercentInput.value = percent.toFixed(2);

    specialWithGSTInput.value = (specialPrice * gstMultiplier).toFixed(2);
    updateNetPayable();
  });

  specialWithGSTInput.addEventListener("input", () => {
    const purchasePrice = getNum(".purchasePrice");
    const gstPercent = getNum(".gstPercent");
    const gstMultiplier = 1 + gstPercent / 100;

    const specialWithGST = getNum(".specialWithGST");
    const specialPrice = gstMultiplier > 0 ? specialWithGST / gstMultiplier : 0;
    specialInput.value = specialPrice.toFixed(2);

    const percent = purchasePrice > 0 ? ((specialPrice / purchasePrice) - 1) * 100 : 0;
    specialPercentInput.value = percent.toFixed(2);
    updateNetPayable();
  });
}


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
function collectItems(purchase_id) {
  if (!purchaseTbody) return [];
  return Array.from(purchaseTbody.querySelectorAll("tr")).map(row => {
    const getVal = (sel) => {
      const el = row.querySelector(sel);
      return el instanceof HTMLInputElement ? parseFloat(el.value) || 0 : 0;
    };
    return {
      purchase_id,
      item_code: (row.querySelector(".itemCode") instanceof HTMLInputElement) ? row.querySelector(".itemCode").value : "",
      product_name: (row.querySelector(".productName") instanceof HTMLInputElement) ? row.querySelector(".productName").value : "",
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
      special_with_gst: getVal(".specialWithGST")
    };
  });
}

// Save Purchase
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
        invoice_amount: parseFloat(invoiceAmountInput?.value || "0"),
        round_off: parseFloat(roundOffInput?.value || "0"),
        net_payable: parseFloat(netPayableInput?.value || "0"),
      };

      // 🔎 Duplicate check before saving
      const { data: existing, error: checkError } = await supabaseClient
        .from("purchases")
        .select("id")
        .eq("supplier_name", purchase.supplier_name)
        .eq("supplier_gst", purchase.supplier_gst)
        .eq("invoice_number", purchase.invoice_number)
        .eq("invoice_date", purchase.invoice_date);

      if (checkError) throw checkError;
      if (existing && existing.length > 0) {
        showBanner("Duplicate invoice detected! This supplier already has that invoice number/date.", "error");
        return; // stop saving
      }

      // ✅ Insert purchase if no duplicate
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

async function loadInvoicesForSupplier(supplierName, supplierGST) {
  const { data, error } = await supabaseClient
    .from("purchases")
    .select("invoice_number")
    .eq("supplier_name", supplierName)
    .eq("supplier_gst", supplierGST);

  if (error) {
    console.error("Error loading invoices:", error);
    return;
  }

  const invoiceList = document.getElementById("invoiceList");
  if (!invoiceList) return;
  invoiceList.innerHTML = "";

  data.forEach(inv => {
    const opt = document.createElement("option");
    opt.value = inv.invoice_number;
    invoiceList.appendChild(opt);
  });
}