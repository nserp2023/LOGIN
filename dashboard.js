const { createClient } = supabase;
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "b_publishable_kmh1sok1CWBSBW0kvdla7w_T7kDioRs"; 
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