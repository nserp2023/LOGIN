const { createClient } = supabase;

// Use the same project as your login/signup
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// Check session
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
  } else {
    document.getElementById("welcome").textContent = `Welcome, ${session.user.email}`;
  }
})();

// Logout
document.getElementById("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

// Sidebar toggle
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");

toggleBtn.addEventListener("click", () => {
  sidebar.classList.toggle("active");
});

// Hover near the left edge to auto-show
document.addEventListener("mousemove", (e) => {
  if (e.clientX < 24) {
    sidebar.classList.add("active");
  }
});
sidebar.addEventListener("mouseleave", () => {
  sidebar.classList.remove("active");
});

// Submenu toggle (accordion style)
document.querySelectorAll(".has-submenu > .menu-link").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const li = e.currentTarget.parentElement;
    li.classList.toggle("open");
  });
});