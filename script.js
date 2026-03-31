const { createClient } = supabase;

const supabaseUrl = "https://kzxwjujjvnehhthazicc.supabase.co";
const supabaseKey = "sb_publishable_Iu3sQGl9gq_VsVYxR3j_7g_SLvgqp_9";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

document.getElementById("loginForm").addEventListener("submit", async function(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorMessage = document.getElementById("error-message");

  if (!email || !password) {
    errorMessage.textContent = "Both fields are required!";
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    errorMessage.textContent = "Login failed: " + error.message;
    return;
  }

  alert("Login successful!");
  window.location.href = "dashboard.html";
});