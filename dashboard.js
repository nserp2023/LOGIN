const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const sb = supabase.createClient(supabaseUrl, supabaseKey);

document.addEventListener("DOMContentLoaded", async () => {
  setupSidebar();
  await loadUserInfo();
  await loadTodayDashboardSummary();
});

function setupSidebar() {
  document.querySelectorAll(".has-submenu > .menu-link").forEach(link => {
    link.addEventListener("click", function(e) {
      e.preventDefault();
      this.parentElement.classList.toggle("open");
    });
  });

  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("mobile-open");
      overlay.classList.toggle("show");
    });
  }

  if (overlay) {
    overlay.addEventListener("click", () => {
      sidebar.classList.remove("mobile-open");
      overlay.classList.remove("show");
    });
  }
}

async function loadUserInfo() {
  const username = localStorage.getItem("username") || "User";
  const role = (localStorage.getItem("role") || "staff").toLowerCase();

  document.getElementById("welcome").innerText = `Welcome, ${username}`;
  document.getElementById("userRoleBadge").innerText = role.charAt(0).toUpperCase() + role.slice(1);
}

async function loadTodayDashboardSummary() {
  const today = new Date().toISOString().split("T")[0];

  let todaySales = 0;
  let todayReceipt = 0;
  let todaySalesReturn = 0;
  let todayPayment = 0;
  let pendingPayments = 0;
  let pendingReturns = 0;

  // SALES
  try {
    const { data, error } = await sb
      .from("sales_details")
      .select("invoice_amount")
      .eq("bill_date", today);

    if (!error && data) {
      todaySales = data.reduce((sum, row) => sum + Number(row.invoice_amount || 0), 0);
    }
  } catch (err) {
    console.error("Sales fetch error:", err);
  }

  // RECEIPTS
  try {
    const { data, error } = await sb
      .from("cash_transactions")
      .select("amount")
      .eq("txn_date", today)
      .eq("txn_type", "receipt");

    if (!error && data) {
      todayReceipt = data.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    }
  } catch (err) {
    console.error("Receipt fetch error:", err);
  }

  // APPROVED PAYMENTS ONLY
  try {
    const { data, error } = await sb
      .from("cash_transactions")
      .select("amount")
      .eq("txn_date", today)
      .eq("txn_type", "payment")
      .eq("approval_status", "approved");

    if (!error && data) {
      todayPayment = data.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    }
  } catch (err) {
    console.error("Payment fetch error:", err);
  }

  // APPROVED SALES RETURNS ONLY
  try {
    const { data, error } = await sb
      .from("sales_return_details")
      .select("total_return_amount")
      .eq("return_date", today)
      .eq("approval_status", "approved");

    if (!error && data) {
      todaySalesReturn = data.reduce((sum, row) => sum + Number(row.total_return_amount || 0), 0);
    }
  } catch (err) {
    console.error("Sales return fetch error:", err);
  }

  // PENDING PAYMENTS
  try {
    const { data, error } = await sb
      .from("cash_transactions")
      .select("id")
      .eq("txn_type", "payment")
      .eq("approval_status", "pending");

    if (!error && data) {
      pendingPayments = data.length;
    }
  } catch (err) {
    console.error("Pending payment fetch error:", err);
  }

  // PENDING RETURNS
  try {
    const { data, error } = await sb
      .from("sales_return_details")
      .select("id")
      .eq("approval_status", "pending");

    if (!error && data) {
      pendingReturns = data.length;
    }
  } catch (err) {
    console.error("Pending return fetch error:", err);
  }

  const todayBalance = todaySales + todayReceipt - todaySalesReturn - todayPayment;

  document.getElementById("todaySales").innerText = formatCurrency(todaySales);
  document.getElementById("todayReceipt").innerText = formatCurrency(todayReceipt);
  document.getElementById("todaySalesReturn").innerText = formatCurrency(todaySalesReturn);
  document.getElementById("todayPayment").innerText = formatCurrency(todayPayment);
  document.getElementById("todayBalance").innerText = formatCurrency(todayBalance);
  document.getElementById("pendingApprovals").innerText = pendingPayments + pendingReturns;
}

function formatCurrency(value) {
  return `₹ ${Number(value || 0).toFixed(2)}`;
}

const username = localStorage.getItem("username") || "User";
const role = (localStorage.getItem("role") || "staff").toLowerCase();

document.getElementById("welcome").innerText = `Welcome, ${username}`;
document.getElementById("userRoleBadge").innerText =
  role.charAt(0).toUpperCase() + role.slice(1);