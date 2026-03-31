// page_permissions.js

const permClient = window.sbcc;

if (!permClient) {
  console.error("Supabase client is not initialized. Make sure supabaseClient.js is loaded before page_permissions.js");
}

async function getLoggedInProfile() {
  if (!permClient) {
    alert("Supabase client not initialized.");
    window.location.href = "index.html";
    return null;
  }

  const { data, error } = await permClient.auth.getUser();

  if (error || !data?.user) {
    localStorage.clear();
    window.location.href = "index.html";
    return null;
  }

  const user = data.user;

  const { data: profile, error: profileError } = await permClient
    .from("user_profiles")
    .select("id, email, full_name, role, approved")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    alert("User profile not found.");
    await permClient.auth.signOut();
    localStorage.clear();
    window.location.href = "index.html";
    return null;
  }

  if (!profile.approved) {
    alert("Your account is waiting for approval.");
    await permClient.auth.signOut();
    localStorage.clear();
    window.location.href = "index.html";
    return null;
  }

  localStorage.setItem("user_id", profile.id || "");
  localStorage.setItem("email", profile.email || "");
  localStorage.setItem("username", profile.full_name || profile.email || "User");
  localStorage.setItem("full_name", profile.full_name || "");
  localStorage.setItem("role", profile.role || "PENDING");
  localStorage.setItem("approved", profile.approved ? "true" : "false");

  return profile;
}

async function hasPageAccess(pageKey) {
  const profile = await getLoggedInProfile();
  if (!profile) return false;

  const role = (profile.role || "").toUpperCase();

  if (role === "OWNER" || role === "ADMIN") return true;

  const { data, error } = await permClient
    .from("user_page_access")
    .select("allowed")
    .eq("user_id", profile.id)
    .eq("page_key", pageKey)
    .maybeSingle();

  if (error) {
    console.error("Permission fetch error:", error);
    return false;
  }

  return !!(data && data.allowed === true);
}

async function requirePageAccess(pageKey) {
  const allowed = await hasPageAccess(pageKey);
  if (!allowed) {
    alert("You do not have permission to open this page.");
    window.location.href = "dashboard.html";
    return false;
  }
  return true;
}

async function logoutPermissionUser() {
  if (permClient) {
    await permClient.auth.signOut();
  }
  localStorage.clear();
  window.location.href = "index.html";
}

function setPermissionUserBadge(roleElementId = "userRoleBadge", welcomeElementId = "welcome") {
  const username = localStorage.getItem("username") || "User";
  const role = (localStorage.getItem("role") || "PENDING")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  const roleEl = document.getElementById(roleElementId);
  const welcomeEl = document.getElementById(welcomeElementId);

  if (roleEl) roleEl.innerText = role;
  if (welcomeEl) welcomeEl.innerText = `Welcome, ${username}`;
}