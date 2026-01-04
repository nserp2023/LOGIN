// script.js
document.getElementById("loginForm").addEventListener("submit", function(event) {
  event.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorMessage = document.getElementById("error-message");

  if (username === "" || password === "") {
    errorMessage.textContent = "Both fields are required!";
  } else if (username === "admin" && password === "12345") {
    alert("Login successful!");
    // Redirect to dashboard page
    window.location.href = "dashboard.html";
  } else {
    errorMessage.textContent = "Invalid username or password!";
  }
});