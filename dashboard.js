const { createClient } = supabase;

// Use your actual Supabase project details
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

// Check session
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html"; // redirect if not logged in
  } else {
    document.getElementById("welcome").textContent =
      `Welcome, ${session.user.email}`;
  }
})();

// Logout
document.getElementById("logout").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
});

// Sidebar toggle
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleBtn");

toggleBtn.addEventListener("click", () => {
  sidebar.classList.toggle("active");
});

// Hover near left edge to auto-show
document.body.addEventListener("mousemove", (e) => {
  if (e.clientX < 30) {
    sidebar.classList.add("active");
  }
});
sidebar.addEventListener("mouseleave", () => {
  sidebar.classList.remove("active");
});

// Submenu toggle on click
document.querySelectorAll(".nav-list > li > a").forEach(link => {
  link.addEventListener("click", (e) => {
    const parentLi = e.target.parentElement;
    if (parentLi.querySelector(".submenu")) {
      e.preventDefault(); // prevent navigation
      parentLi.classList.toggle("open");
    }
  });
});