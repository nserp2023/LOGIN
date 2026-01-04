const { createClient } = supabase;
const supabaseUrl = "https://YOUR-PROJECT-URL.supabase.co";
const supabaseKey = "sb_publishable_xxxxx"; 
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