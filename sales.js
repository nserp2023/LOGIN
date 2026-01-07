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

// ✅ Sales logic
const salesForm = document.getElementById("salesForm");
const salesBody = document.getElementById("salesBody");
const grandTotalEl = document.getElementById("grandTotal");
let grandTotal = 0;

function recalcGrandTotal() {
  grandTotal = 0;
  salesBody.querySelectorAll("tr").forEach(row => {
    const qty = parseFloat(row.querySelector("td:nth-child(2)").textContent) || 0;
    const price = parseFloat(row.querySelector("td:nth-child(3)").textContent) || 0;
    const total = qty * price;
    row.querySelector("td:nth-child(4)").textContent = `$${total.toFixed(2)}`;
    grandTotal += total;
  });
  grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;
}

// ✅ Auto date
function setTodayDate() {
  const billDateEl = document.getElementById("billDate");
  if (billDateEl) {
    const today = new Date().toISOString().split("T")[0];
    billDateEl.value = today;
  }
}

// ✅ Read current bill number (no increment)
async function readBillNumber(series) {
  const billNumberEl = document.getElementById("billNumber");
  const { data, error } = await supabaseClient
    .from("bill_count")
    .select("current_number")
    .eq("series_code", series)
    .single();

  if (error || !data) {
    console.error("Error reading bill counter:", error);
    billNumberEl.value = "1";
    return;
  }

  billNumberEl.value = String(data.current_number + 1);
}

// ✅ Increment bill number via RPC (only on save)
async function incrementBillNumber(series) {
  const { data, error } = await supabaseClient.rpc("increment_bill_number", {
    series_code_input: series
  });
  if (error) {
    console.error("RPC error:", error);
    throw error;
  }
  return data; // new number
}

// ✅ Customer lookup
async function fetchCustomerByMobile(mobile) {
  if (!mobile) return;

  const { data, error } = await supabaseClient
    .from("customers")
    .select("name, address, mobile, gst_number, state_code")
    .eq("mobile", mobile)
    .single();

  if (error) {
    console.warn("Customer lookup error:", error.message);
    return;
  }

  if (data) {
    document.getElementById("customerName").value = data.name || "";
    document.getElementById("customerAddress").value = data.address || "";
    document.getElementById("customerGST").value = data.gst_number || "";
    document.getElementById("customerStateCode").value = data.state_code || "";
  }
}

document.getElementById("customerMobile").addEventListener("blur", async (e) => {
  const mobile = e.target.value.trim();
  await fetchCustomerByMobile(mobile);
});

// ✅ Initial setup
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("customerMobile").focus();
  setTodayDate();

  const seriesSelect = document.getElementById("billSeries");
  try {
    const { data, error } = await supabaseClient.from("bill_series").select("series_code");
    if (!error && data.length) {
      seriesSelect.innerHTML = "";
      data.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.series_code;
        opt.textContent = s.series_code;
        seriesSelect.appendChild(opt);
      });
    }
  } catch (err) {
    ["Q","A","B","C"].forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      seriesSelect.appendChild(opt);
    });
  }
  seriesSelect.value = "Q";

  await readBillNumber(seriesSelect.value);

  seriesSelect.addEventListener("change", async () => {
    await readBillNumber(seriesSelect.value);
  });
});

// ✅ Enter navigation
const jump = (from, to) => {
  const a = document.getElementById(from), b = document.getElementById(to);
  if (a && b) a.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); b.focus(); }
  });
};
jump("customerMobile","customerName");
jump("customerName","customerAddress");
jump("customerAddress","customerGST");
jump("customerGST","customerStateCode");
jump("customerStateCode","product");

// ✅ Enter