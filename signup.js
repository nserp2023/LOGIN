const { createClient } = supabase;

const supabaseUrl = "https://YOUR-PROJECT-URL.supabase.co";
const supabaseKey = "YOUR-ANON-KEY";
const supabaseClient = createClient(supabaseUrl, supabaseKey);

document.getElementById("signupForm").addEventListener("submit", async function(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorMessage = document.getElementById("error-message");

  if (!email || !password) {
    errorMessage.textContent = "Both fields are required!";
    return;
  }

  // Supabase Auth: Sign up
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    errorMessage.textContent = "Signup failed: " + error.message;
    return;
  }

  alert("Signup successful! Please login.");
  window.location.href = "index.html";
});