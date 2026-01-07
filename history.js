const { createClient } = supabase;

const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

let invoices = [];
let charts = {};

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

// ✅ Load invoices
async function loadInvoices() {
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("*")
    .order("invoicedate", { ascending: false });

  if (error) {
    alert("Error loading invoices: " + error.message);
    return;
  }

  invoices = data;
  applyFilters(); // render + analytics with filters
}

// ✅ Render invoices
function renderInvoices(list) {
  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";

  list.forEach(inv => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${inv.bill_series || ""}</td>
      <td>${inv.bill_number || ""}</td>
      <td>${inv.invoicedate || ""}</td>
      <td>${inv.customer_name || ""}</td>
      <td>${inv.customer_mobile || ""}</td>
      <td>${inv.gst_number || ""}</td>
      <td>${inv.state_code || ""}</td>
      <td>${inv.totalamount ? "₹" + inv.totalamount.toFixed(2) : ""}</td>
      <td><button class="viewItems" data-items='${JSON.stringify(inv.items)}'>View Items</button></td>
    `;
    tbody.appendChild(row);
  });
}

// ✅ Build analytics charts + summary + monthly breakdown
function buildAnalytics(list) {
  // --- Summary Bar ---
  const totalInvoices = list.length;
  const totalSales = list.reduce((sum, inv) => sum + (inv.totalamount || 0), 0);
  document.getElementById("summaryBar").textContent =
    `Total Invoices: ${totalInvoices} | Total Sales: ₹${totalSales.toFixed(2)}`;

  // Destroy old charts
  Object.values(charts).forEach(ch => { if (ch) ch.destroy(); });

  // --- Sales Trend ---
  const salesByDate = {};
  list.forEach(inv => {
    const date = inv.invoicedate;
    if (!salesByDate[date]) salesByDate[date] = 0;
    salesByDate[date] += inv.totalamount || 0;
  });
  const trendLabels = Object.keys(salesByDate).sort();
  const trendData = trendLabels.map(d => salesByDate[d]);

  charts.trend = new Chart(document.getElementById("salesTrendChart"), {
    type: "line",
    data: { labels: trendLabels, datasets: [{ label: "Sales Trend", data: trendData, borderColor: "blue", fill: false }] }
  });

  // --- Top Customers ---
  const customerTotals = {};
  list.forEach(inv => {
    const name = inv.customer_name || "Unknown";
    if (!customerTotals[name]) customerTotals[name] = 0;
    customerTotals[name] += inv.totalamount || 0;
  });
  const custLabels = Object.keys(customerTotals);
  const custData = custLabels.map(c => customerTotals[c]);

  charts.customers = new Chart(document.getElementById("topCustomersChart"), {
    type: "bar",
    data: { labels: custLabels, datasets: [{ label: "Top Customers", data: custData, backgroundColor: "green" }] }
  });

  // --- Top Products ---
  const productTotals = {};
  list.forEach(inv => {
    (inv.items || []).forEach(it => {
      const product = it.product || "Unknown";
      if (!productTotals[product]) productTotals[product] = 0;
      productTotals[product] += it.total || 0;
    });
  });
  const prodLabels = Object.keys(productTotals);
  const prodData = prodLabels.map(p => productTotals[p]);

  charts.products = new Chart(document.getElementById("topProductsChart"), {
    type: "pie",
    data: { labels: prodLabels, datasets: [{ label: "Top Products", data: prodData, backgroundColor: ["red","orange","yellow","green","blue","purple"] }] }
  });

  // --- Monthly Breakdown ---
  const monthlyTotals = {};
  list.forEach(inv => {
    if (!inv.invoicedate) return;
    const monthKey = inv.invoicedate.slice(0,7); // YYYY-MM
    if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { invoices: 0, sales: 0 };
    monthlyTotals[monthKey].invoices += 1;
    monthlyTotals[monthKey].sales += inv.totalamount || 0;
  });

  const monthlyBody = document.getElementById("monthlyBody");
  monthlyBody.innerHTML = "";

  function formatMonth(monthKey) {
    const [year, month] = monthKey.split("-");
    const date = new Date(year, month - 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  }

  const monthLabels = [];
  const monthSales = [];

  Object.keys(monthlyTotals).sort().forEach(month => {
    monthLabels.push(formatMonth(month));
    monthSales.push(monthlyTotals[month].sales);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatMonth(month)}</td>
      <td>${monthlyTotals[month].invoices}</td>
      <td>₹${monthlyTotals[month].sales.toFixed(2)}</td>
    `;
    monthlyBody.appendChild(row);
  });

  if (charts.monthly) charts.monthly.destroy();
  charts.monthly = new Chart(document.getElementById("monthlyChart"), {
    type: "bar",
    data: { labels: monthLabels, datasets: [{ label: "Monthly Sales", data: monthSales, backgroundColor: "orange" }] },
    options: { scales: { y: { beginAtZero: true, ticks: { callback: value => "₹" + value } } } }
  });

  // --- Cumulative Sales ---
  const sortedDates = Object.keys(salesByDate).sort();
  let runningTotal = 0;
  const cumulativeLabels = [];
  const cumulativeData = [];

  sortedDates.forEach(date => {
    runningTotal += salesByDate[date];
    cumulativeLabels.push(date);
    cumulativeData.push(runningTotal);
  });

  if (charts.cumulative) charts.cumulative.destroy();
  charts.cumulative = new Chart(document.getElementById("cumulativeChart"), {
    type: "line",
    data: { labels: cumulativeLabels, datasets: [{ label: "Cumulative Sales", data: cumulativeData, borderColor: "purple", fill: false }] },
    options: { scales: { y: { beginAtZero: true, ticks: { callback: value => "₹" + value } } } }
  });
}

// ✅ Apply filters (search + date)
function applyFilters() {
  const term = document.getElementById("searchInput").value.toLowerCase();
  const fromDate = document.getElementById("fromDate").value;
  const toDate = document.getElementById("toDate").value;

  let filtered = invoices;

  if (term) {
    filtered = filtered.filter(inv =>
      (inv.customer_name || "").toLowerCase().includes(term) ||
      (inv.customer_mobile || "").toLowerCase().includes(term)
    );
  }

  if (fromDate) {
    filtered = filtered.filter(inv => inv.invoicedate >= fromDate);
  }
  if (toDate) {
    filtered = filtered.filter(inv => inv.invoicedate <= toDate);
  }

  renderInvoices(filtered);
  buildAnalytics(filtered);
}

// ✅ Event listeners
document.getElementById("searchInput").addEventListener("input", applyFilters);
document.getElementById("filterBtn").addEventListener("click", applyFilters);
document.getElementById("resetBtn").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("fromDate").value = "";
  document.getElementById("toDate").value = "";
  applyFilters();
});

// ✅ Modal for items
const modal = document.getElementById("itemsModal");
const closeModal = document.getElementById("closeModal");
const itemsBody = document.getElementById("itemsBody");

document.getElementById("historyBody").addEventListener("click", (e) => {
  if (e.target.classList.contains("viewItems")) {
    const items = JSON.parse(e.target.dataset.items || "[]");
    itemsBody.innerHTML = "";
    items.forEach(it => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${it.product || ""}</td>
        <td>${it.qty || 0}</td>
        <td>${it.price ? "₹" + it.price.toFixed(2) : ""}</td>
        <td>${it.total ? "₹" + it.total.toFixed(2) : ""}</td>
      `;
      itemsBody.appendChild(row);
    });
    modal.style.display = "block";
  }
});

closeModal.addEventListener("click", () => {
  modal.style.display = "none";
});

// ✅ Load on page start
document.addEventListener("DOMContentLoaded", loadInvoices);