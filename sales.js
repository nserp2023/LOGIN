const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// ✅ Session check
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) window.location.href = "index.html";
})();

// ✅ Logout
document.getElementById("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

// ✅ Sidebar toggle
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");
toggleBtn.addEventListener("click", () => sidebar.classList.toggle("active"));
document.addEventListener("mousemove", (e) => { if (e.clientX < 24) sidebar.classList.add("active"); });
sidebar.addEventListener("mouseleave", () => sidebar.classList.remove("active"));

// ✅ Add Item Row
function addItemRow() {
  const tbody = document.getElementById("itemsBody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" name="product" placeholder="Product"></td>
    <td><input type="number" name="qty" placeholder="Qty" value="1"></td>
    <td><input type="number" name="price" placeholder="Price"></td>
    <td>
      <select name="price_type">
        <option value="exclusive">Exclusive</option>
        <option value="inclusive">Inclusive</option>
      </select>
    </td>
    <td><input type="number" name="gst_percent" placeholder="GST %"></td>
    <td><input type="number" name="cgst_percent" placeholder="CGST %" value="50"></td>
    <td><input type="number" name="sgst_percent" placeholder="SGST %" value="50"></td>
  `;
  tbody.appendChild(row);
}

// ✅ Collect Items + Auto Calculate GST
function collectItems() {
  const rows = document.querySelectorAll("#itemsBody tr");
  const items = [];

  rows.forEach(row => {
    const product = row.querySelector("[name=product]").value;
    const qty = parseFloat(row.querySelector("[name=qty]").value) || 0;
    const price = parseFloat(row.querySelector("[name=price]").value) || 0;
    const price_type = row.querySelector("[name=price_type]").value;
    const gst_percent = parseFloat(row.querySelector("[name=gst_percent]").value) || 0;
    const cgst_percent = parseFloat(row.querySelector("[name=cgst_percent]").value) || 0;
    const sgst_percent = parseFloat(row.querySelector("[name=sgst_percent]").value) || 0;

    const baseAmount = price * qty;
    const gst_amount = (baseAmount * gst_percent) / 100;
    const cgst_amount = (gst_amount * cgst_percent) / 100;
    const sgst_amount = (gst_amount * sgst_percent) / 100;
    const price_with_gst = baseAmount + gst_amount;

    items.push({
      product,
      qty,
      price,
      price_type,
      gst_percent,
      gst_amount,
      cgst_percent,
      cgst_amount,
      sgst_percent,
      sgst_amount,
      price_with_gst,
      total: price_with_gst // used for invoice total
    });
  });

  return items;
}

// ✅ Save Invoice
async function saveInvoice() {
  const customer_name = document.getElementById("customerName").value;
  const customer_mobile = document.getElementById("customerMobile").value;
  const invoicedate = document.getElementById("invoiceDate").value;

  const items = collectItems();
  const totalamount = items.reduce((sum, it) => sum + (it.total || 0), 0);

  const { error } = await supabaseClient
    .from("invoices")
    .insert([{
      customer_name,
      customer_mobile,
      invoicedate,
      items,
      totalamount
    }]);

  if (error) {
    alert("Error saving invoice: " + error.message);
  } else {
    alert("Invoice saved successfully!");
    document.getElementById("itemsBody").innerHTML = "";
  }
}

// ✅ Event listeners
document.getElementById("addItemBtn").addEventListener("click", addItemRow);
document.getElementById("saveInvoiceBtn").addEventListener("click", saveInvoice);