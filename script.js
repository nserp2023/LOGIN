const { createClient } = supabase;

// Replace with your Supabase project details
const supabaseUrl = "https://gqxczzijntbvtlmmzppt.supabase.co";
const supabaseKey = "sb_secret_6ZPdaheVaDNfygdOmVDsmQ_TOUwJSjI";
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

  // Supabase Auth: Sign in
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