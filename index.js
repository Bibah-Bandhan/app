const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyyoGSVz24Cj73t--_LS8mjqJP8B6SAYg8_dJCaNkBbqB91Zqynoj1kkRba5Jh9ndtA4Q/exec";

const state = {
  profiles: [],
  agents: [],
  payments: [],
  agentPayouts: [],
  stories: [],
  filtered: [],
  session: null,
  currentAgent: null,
  activeTab: "profiles",
  dashboardSearch: "",
  croppedPhotoDataUrl: "",
  activeAgentDetail: null,
  crop: { img: null, imageUrl: "", zoom: 1, minZoom: 1, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const AGENT_ADDRESS_FIELDS = ["houseNo", "villageTown", "postOffice", "policeStation", "district", "state", "pinCode"];
const AGENT_BANK_FIELDS = ["bankName", "ifscCode", "accountNumber", "accountHolderName", "upiId"];

function formatAgentAddress(agent = {}) {
  const parts = AGENT_ADDRESS_FIELDS.map((key) => agent[key]).filter(Boolean);
  if (parts.length) return parts.join(", ");
  return agent.address || "";
}

function formatAgentBank(agent = {}) {
  const segments = [];
  if (agent.bankName) segments.push(agent.bankName);
  if (agent.ifscCode) segments.push(`IFSC: ${agent.ifscCode}`);
  if (agent.accountNumber) segments.push(`A/C: ${agent.accountNumber}`);
  if (agent.accountHolderName) segments.push(agent.accountHolderName);
  if (segments.length) return segments.join(" | ");
  return agent.bankDetails || "";
}

function hydrateLegacyAgent(agent = {}) {
  const hydrated = { ...agent };
  if (!AGENT_ADDRESS_FIELDS.some((key) => hydrated[key]) && agent.address) {
    hydrated.villageTown = agent.address;
  }
  if (!agent.bankName && !agent.accountNumber && agent.bankDetails) {
    hydrated.accountHolderName = agent.bankDetails;
  }
  return hydrated;
}

function normalizeAgentPayload(payload = {}) {
  const data = { ...payload };
  if (data.pinCode) data.pinCode = String(data.pinCode).replace(/\D/g, "").slice(0, 6);
  if (data.ifscCode) data.ifscCode = String(data.ifscCode).trim().toUpperCase();
  if (data.accountNumber) data.accountNumber = String(data.accountNumber).replace(/\s/g, "");
  return data;
}

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
let inactivityTimer = null;
let activeReceiptTitle = "";
let activeNoteContext = null;
let activeMarriageProfile = null;

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  bindCodeProtection();
  bindActivityTracking();
  loadPublicData();
});

function bindActivityTracking() {
  ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
}

function resetInactivityTimer() {
  if (!state.session) return;
  clearInactivityTimer();
  inactivityTimer = setTimeout(() => {
    toast("Session expired due to inactivity");
    logout();
  }, INACTIVITY_TIMEOUT_MS);
}

function clearInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
}

function bindCodeProtection() {
  const blockedKeys = ["u", "i", "j", "c", "s"];
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    
  });
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const blockedCombo =
      event.key === "F12" ||
      (event.ctrlKey && key === "u") ||
      (event.ctrlKey && event.shiftKey && blockedKeys.includes(key)) ||
      (event.metaKey && event.altKey && blockedKeys.includes(key));

    if (blockedCombo) {
      event.preventDefault();
      event.stopPropagation();
      
    }
  }, true);
  document.addEventListener("dragstart", (event) => event.preventDefault());
}

function bindUi() {
    const loginDropdown = $(".login-dropdown");
  const loginToggle = $(".login-toggle");
  if (loginDropdown && loginToggle) {
    loginToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = loginDropdown.classList.toggle("open");
      loginToggle.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (event) => {
      if (!loginDropdown.contains(event.target)) {
        loginDropdown.classList.remove("open");
        loginToggle.setAttribute("aria-expanded", "false");
      }
    });
  }
  if ($("#paymentForm")) $("#paymentForm").addEventListener("submit", submitPayment);
  if ($("#profileNoteForm")) $("#profileNoteForm").addEventListener("submit", submitProfileNote);
  if ($("#marriageForm")) $("#marriageForm").addEventListener("submit", submitMarriageComplete);
  bindPhotoCropper();
  if ($("#printReceiptBtn")) $("#printReceiptBtn").addEventListener("click", printReceipt);
  if ($("#dashboardSearch")) {
    $("#dashboardSearch").addEventListener("input", (event) => {
      state.dashboardSearch = event.target.value || "";
      renderDashboard();
    });
  }
  $$("[data-open-profile]").forEach((button) => button.addEventListener("click", () => openProfileForm()));
  $$("[data-open-login]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      $(".login-dropdown")?.classList.remove("open");
      $(".login-toggle")?.setAttribute("aria-expanded", "false");
      openLogin(button.dataset.openLogin || "agent");
    });
  });
  $("#showAgentSignupBtn")?.addEventListener("click", () => showAgentSignupView());
  $("#backToAgentLoginBtn")?.addEventListener("click", () => showAgentLoginView());
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
  $$("[data-close-message]").forEach((button) => button.addEventListener("click", closeMessageModal));
  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.id === "messageModal" ? closeMessageModal() : closeModals();
      }
    });
  });

  $("#quickSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters(new FormData(event.target));
    document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  });
  $("#sideFilters").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters(new FormData(event.target));
  });
  $("#resetFilters").addEventListener("click", () => {
    $("#quickSearch").reset();
    $("#sideFilters").reset();
    state.filtered = state.profiles.filter((profile) => profile.status === "verified" && String(profile.marriageStatus || "").toLowerCase() !== "completed");
    renderCards(state.filtered);
  });

  $("#loginForm").addEventListener("submit", submitLogin);
  $("#profileForm").addEventListener("submit", submitProfile);
  $("#agentForm").addEventListener("submit", submitAgent);
  $("#clearAgentForm").addEventListener("click", () => { $("#agentForm").reset(); clearAgentFileInputs(); });
  if ($("#agentRegisterForm")) $("#agentRegisterForm").addEventListener("submit", submitAgentRegister);
  if ($("#myAccountForm")) $("#myAccountForm").addEventListener("submit", submitMyAccount);
  if ($("#agentPayoutForm")) $("#agentPayoutForm").addEventListener("submit", submitAgentPayout);
  if ($("#agentIdCardBtn")) $("#agentIdCardBtn").addEventListener("click", () => openAgentIdCard(state.currentAgent));
  if ($("#printAgentIdBtn")) $("#printAgentIdBtn").addEventListener("click", printAgentIdCard);
  $$("[data-open-agent-register]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    $(".login-dropdown")?.classList.remove("open");
    $(".login-toggle")?.setAttribute("aria-expanded", "false");
    openLogin("agent", "signup");
  }));
  $("#storyForm").addEventListener("submit", submitStory);
  $("#clearStoryForm").addEventListener("click", () => $("#storyForm").reset());
  $("#logoutBtn").addEventListener("click", logout);
}

async function api(action, payload = {}) {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return { ok: false, error: text || "Invalid server response" };
  }
}

async function loadPublicData() {
  $("#cards").innerHTML = emptyMessage("Loading profiles...");
  try {
    const response = await fetch(`${SCRIPT_URL}?view=public&t=${Date.now()}`,{cache:"no-store"});
    const data = await response.json();
    state.profiles = cleanProfiles(Array.isArray(data.profiles) ? data.profiles : Array.isArray(data) ? data : []);
    state.agents = cleanAgents(Array.isArray(data.agents) ? data.agents : []);
    state.stories = cleanStories(Array.isArray(data.stories) ? data.stories : []);
    state.filtered = state.profiles.filter((profile) => profile.status === "verified" && String(profile.marriageStatus || "").toLowerCase() !== "completed");
    renderStats();
    renderCards(state.filtered);
    renderStories();
  } catch (error) {
    $("#cards").innerHTML = emptyMessage("Could not load profiles. Check Apps Script deployment URL.");
  }
}

async function loadDashboardData() {
  if (!state.session) return;
  const payload = {
    token: state.session.token,
    role: state.session.role,
    agentId: state.session.agentId || "",
  };
  const result = await api("dashboard", payload);
  if (!result.ok) {
    toast(result.error || "Dashboard loading failed");
    return;
  }
  state.profiles = cleanProfiles(result.profiles || []);
  state.agents = cleanAgents(result.agents || []);
  state.payments = cleanPayments(result.payments || []);
  state.agentPayouts = cleanAgentPayouts(result.agentPayouts || []);
  state.currentAgent = result.currentAgent || null;
  state.stories = cleanStories(result.stories || []);
  renderStats();
  renderDashboard();
}

function applyFilters(formData) {
  const filters = Object.fromEntries(formData.entries());
  state.filtered = state.profiles.filter((profile) => {
    if (String(profile.marriageStatus || "").toLowerCase() === "completed") return false;
    if (profile.status !== "verified") return false;
    if (filters.ageMin && Number(profile.age || 0) < Number(filters.ageMin)) return false;
    if (filters.ageMax && Number(profile.age || 0) > Number(filters.ageMax)) return false;
    if (filters.gender && !sameChoice(profile.gender, filters.gender)) return false;
    if (filters.religion && !sameChoice(profile.religion, filters.religion)) return false;
    if (filters.city) {
      const location = [profile.villageTown, profile.district, profile.city, profile.state].filter(Boolean).join(" ");
      if (!includes(location, filters.city)) return false;
    }
    if (filters.education && !includes(profile.education, filters.education)) return false;
    if (filters.occupation && !includes(profile.occupation, filters.occupation)) return false;
    if (filters.community && !includes(profile.community, filters.community)) return false;
    if (filters.maritalStatus && normalize(profile.maritalStatus) !== normalize(filters.maritalStatus)) return false;
    return true;
  });
  renderCards(state.filtered);
}

function renderCards(list) {
  const cards = $("#cards");
  list = cleanProfiles(list);
  cards.innerHTML = "";
  if (!list.length) {
    cards.innerHTML = emptyMessage("No verified profiles found.");
    return;
  }
  list.forEach((profile) => cards.appendChild(profileCard(profile)));
}

function profileCard(profile) {
  const card = document.createElement("article");
  card.className = "profile-card";
  const photo = photoUrl(profile.photo);
  card.innerHTML = `
    <div class="cover">
      <span class="pill">${profile.status === "verified" ? "Verified" : "New"}</span>
      <div class="avatar">${photo ? `<img src="${escapeAttr(photo)}" referrerpolicy="no-referrer" alt="${escapeAttr(profile.fullName || "Profile")}">` : initials(profile.fullName)}</div>
    </div>
    <div class="card-body">
      <div class="card-title">
        <strong>${escapeHtml(profile.fullName || "Profile")}</strong>
        <span class="id">#${escapeHtml(profile.id || "")}</span>
      </div>
      <div class="meta">
        ${chip(profile.age ? `${profile.age} yrs` : "")}
        ${chip(profile.height)}
        ${chip(profile.complexion)}
        ${chip([profile.district].filter(Boolean).join(", "))}
      </div>
      <div class="meta">
        ${chip(profile.religion)}
        ${chip(profile.community)}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn btn-soft" type="button">♡ Shortlist</button>
      <button class="btn btn-primary" type="button">View Profile</button>
    </div>`;
  card.querySelector(".btn-soft").addEventListener("click", () => toast("Added to shortlist"));
  card.querySelector(".btn-primary").addEventListener("click", () => openDetails(profile));
  return card;
}

function renderStats() {
  const activeProfiles = activeClientProfiles();
  const total = activeProfiles.length;
  const verified = activeProfiles.filter((profile) => profile.status === "verified").length;
  if ($("#statProfiles")) $("#statProfiles").textContent = total;
  if ($("#statVerified")) $("#statVerified").textContent = verified;
  if ($("#statAgents")) $("#statAgents").textContent = state.agents.length;
}

function showAgentSignupView() {
  $("#loginPanel")?.classList.add("hidden");
  $("#agentSignupPanel")?.classList.remove("hidden");
  $("#loginModalCard")?.classList.add("wide");
  $("#loginTitle").textContent = "এজেন্ট একাউন্ট তৈরি";
}

function showAgentLoginView() {
  $("#loginPanel")?.classList.remove("hidden");
  $("#agentSignupPanel")?.classList.add("hidden");
  $("#loginModalCard")?.classList.remove("wide");
  $("#loginTitle").textContent = "Agent Login";
}

function openLogin(role, view = "login") {
  const isAgent = role === "agent";
  $("#loginForm [name='role']").value = role;
  $("#loginForm").reset();
  $("#loginForm [name='role']").value = role;
  $("#agentLoginFooter")?.classList.toggle("hidden", !isAgent);
  if (isAgent) {
    view === "signup" ? showAgentSignupView() : showAgentLoginView();
  } else {
    $("#loginTitle").textContent = "Admin Login";
    $("#loginPanel")?.classList.remove("hidden");
    $("#agentSignupPanel")?.classList.add("hidden");
    $("#loginModalCard")?.classList.remove("wide");
  }
  openModal("loginModal");
}

async function submitLogin(event) {
  event.preventDefault();
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Checking...";
  const payload = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await api("login", payload);
    if (!result.ok) throw new Error(result.error || "Login failed");
    state.session = result.session;
    closeModals();
    showDashboard();
    await loadDashboardData();
    resetInactivityTimer();
    toast("Login successful");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Login";
  }
}

function restoreSession() {
  localStorage.removeItem("bandhanSession");
}

function showDashboard() {
  document.body.classList.add("dashboard-mode");
  document.body.classList.toggle("admin-mode", state.session.role === "admin");
  document.body.classList.toggle("agent-mode", state.session.role === "agent");
  $$(".public-view").forEach((element) => element.classList.add("hidden"));
  $("#dashboardSection").classList.remove("hidden");
  $("#dashboardTitle").textContent = state.session.role === "admin" ? "Admin Dashboard" : "Agent Dashboard";
  $("#dashboardSub").textContent = state.session.role === "admin"
    ? "Manage agents, client profiles, payments and payouts."
    : "Manage your clients, payments, account and view commission details.";
  $("#sessionName").textContent = state.session.name || state.session.role;
  if (state.session.role === "admin") {
    $("#sessionInfo").textContent = "Admin can see every profile, agent and payout.";
    $("#agentCommissionBar")?.classList.add("hidden");
    $("#agentIdCardBtn")?.classList.add("hidden");
  } else {
    const agent = state.currentAgent || {};
    $("#sessionInfo").textContent = `Agent ID: ${state.session.agentId || ""} · Level: ${agent.level || state.session.level || "Standard"}`;
    $("#agentCommissionBar")?.classList.remove("hidden");
    if ($("#commReg")) $("#commReg").textContent = `${agent.regCommission || state.session.regCommission || 30}%`;
    if ($("#commMarriage")) $("#commMarriage").textContent = `${agent.marriageCommission || state.session.marriageCommission || 25}%`;
    if ($("#commLevel")) $("#commLevel").textContent = agent.level || state.session.level || "Standard";
    if ($("#commAgentId")) $("#commAgentId").textContent = state.session.agentId || "-";
    $("#agentIdCardBtn")?.classList.remove("hidden");
  }
  $("#agentTools").classList.toggle("hidden", true);
  $("#myAccountTools")?.classList.toggle("hidden", true);
  $("#agentPayoutTools")?.classList.toggle("hidden", true);
  renderTabs();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderTabs() {
  const tabs = $("#dashboardTabs");
  const items = state.session.role === "admin"
    ? [["profiles", "Profiles"], ["marriages", "Marriages"], ["payments", "Client Payments"], ["agents", "Agents"], ["agentPayouts", "Agent Payouts"], ["agentForm", "Create Agent"], ["stories", "Stories"]]
    : [["profiles", "My Clients"], ["marriages", "Marriages"], ["payments", "Client Payments"], ["agentPayouts", "My Payouts"], ["myAccount", "My Account"]];
  tabs.innerHTML = "";
  items.forEach(([key, label]) => {
    const button = document.createElement("button");
    button.className = `btn tab ${state.activeTab === key ? "active" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      state.activeTab = key;
      renderTabs();
      renderDashboard();
    });
    tabs.appendChild(button);
  });
}

function renderDashboard() {
  const activeProfiles = activeClientProfiles();
  const filteredProfiles = filterDashboardProfiles(activeProfiles);
  $("#dashTotal").textContent = activeProfiles.length;
  $("#dashPending").textContent = activeProfiles.filter((profile) => profile.status === "pending").length;
  $("#dashVerified").textContent = activeProfiles.filter((profile) => profile.status === "verified").length;
  if ($("#dashMarriages")) $("#dashMarriages").textContent = completedMarriageProfiles().length;
  if ($("#dashMonthMarriages")) $("#dashMonthMarriages").textContent = marriageCountThisMonth();
  if ($("#dashAgents")) $("#dashAgents").textContent = state.session.role === "admin" ? state.agents.length : "-";

  const filterPanel = $("#dashboardFilter");
  $("#storyTools").classList.toggle("hidden", !(state.activeTab === "stories" && state.session.role === "admin"));
  if (filterPanel) {
    const showFilter = state.activeTab === "profiles";
    filterPanel.classList.toggle("hidden", !showFilter);
    $("#dashboardSearch").value = state.dashboardSearch || "";
    $("#dashboardSearchCount").textContent = showFilter
      ? `${filteredProfiles.length} / ${activeProfiles.length} active client`
      : "";
  }

  $("#agentTools").classList.toggle("hidden", !(state.activeTab === "agentForm" && state.session.role === "admin"));
  $("#myAccountTools")?.classList.toggle("hidden", !(state.activeTab === "myAccount" && state.session.role === "agent"));
  $("#agentPayoutTools")?.classList.toggle("hidden", !(state.activeTab === "agentPayouts" && state.session.role === "admin"));

  if (state.activeTab === "payments") {
    renderPaymentTable();
  } else if (state.activeTab === "agentPayouts") {
    renderAgentPayoutTable();
  } else if (state.activeTab === "marriages") {
    renderMarriageTable();
  } else if (state.activeTab === "agents" && state.session.role === "admin") {
    renderAgentTable();
  } else if (state.activeTab === "agentForm" && state.session.role === "admin") {
    renderAgentFormView();
  } else if (state.activeTab === "myAccount" && state.session.role === "agent") {
    renderMyAccountView();
  } else if (state.activeTab === "stories" && state.session.role === "admin") {
    renderStoryTable();
  } else {
    renderProfileTable(filteredProfiles);
  }
}

function activeClientProfiles() {
  return cleanProfiles(state.profiles).filter((profile) => String(profile.marriageStatus || "").toLowerCase() !== "completed");
}

function completedMarriageProfiles() {
  return cleanProfiles(state.profiles).filter((profile) => String(profile.marriageStatus || "").toLowerCase() === "completed");
}

function marriageCountThisMonth() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return completedMarriageProfiles().filter((profile) => String(profile.marriageDate || "").startsWith(monthKey)).length;
}

function filterDashboardProfiles(list) {
  const query = normalize(state.dashboardSearch || "");
  const allowedIds = new Set(cleanProfiles(list).map((profile) => String(profile.id || "")));
  const activeProfiles = activeClientProfiles().filter((profile) => allowedIds.has(String(profile.id || "")));
  if (!query) return activeProfiles;
  return activeProfiles.filter((profile) => {
    const haystack = [
      profile.id,
      profile.fullName,
      profile.phone,
      profile.email,
      profile.agentId,
      profile.district,
      profile.villageTown,
      profile.city,
      profile.status
    ].map(normalize).join(" ");
    return haystack.includes(query);
  });
}

function renderAgentFormView() {
  $("#tableHead").innerHTML = "";
  const body = $("#tableBody");
  body.innerHTML = `<tr><td>Create or update agent details using the form above.</td></tr>`;
}

function renderStories() {
  const cards = $("#storyCards");
  if (!cards) return;
  const stories = cleanStories(state.stories).filter((story) => story.status === "published");
  cards.innerHTML = "";
  if (!stories.length) {
    cards.innerHTML = `<article class="panel"><h3>Stories coming soon</h3><p class="note">Admin-approved client stories will appear here.</p></article>`;
    return;
  }
  stories.slice(0, 6).forEach((story) => {
    const card = document.createElement("article");
    card.className = "profile-card";
    const photo = photoUrl(story.photo);
    card.innerHTML = `
      <div class="cover">
        <span class="pill">Published</span>
        <div class="avatar">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(story.coupleName || "Success story")}">` : "BB"}</div>
      </div>
      <div class="card-body">
        <div class="card-title"><strong>${escapeHtml(story.coupleName || "Success Story")}</strong><span class="id">${escapeHtml(story.matchDate || "")}</span></div>
        <div class="meta">${chip(story.location)}</div>
        <p class="note">${escapeHtml(story.story || "")}</p>
      </div>`;
    cards.appendChild(card);
  });
}

function renderStoryTable() {
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>Couple</th><th>Location</th><th>Date</th><th>Status</th><th>Consent</th><th>Story</th><th>Actions</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  const stories = cleanStories(state.stories);
  if (!stories.length) {
    body.innerHTML = `<tr><td colspan="8">No success stories yet.</td></tr>`;
    return;
  }
  stories.forEach((story) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(story.id || "")}</td>
      <td>${escapeHtml(story.coupleName || "")}</td>
      <td>${escapeHtml(story.location || "")}</td>
      <td>${escapeHtml(story.matchDate || "")}</td>
      <td>${statusBadge(story.status || "draft")}</td>
      <td>${escapeHtml(story.consent || "")}</td>
      <td>${escapeHtml(String(story.story || "").slice(0, 90))}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "Edit", "btn-gold", () => fillStoryForm(story));
    addAction(actions, "Delete", "btn-danger", () => deleteStory(story));
    body.appendChild(tr);
  });
}

function cleanStories(list) {
  return (Array.isArray(list) ? list : []).filter((story) =>
    String(story?.id || "").trim() ||
    String(story?.coupleName || "").trim() ||
    String(story?.story || "").trim()
  );
}
function renderProfileTable(list) {
  const allowedIds = new Set(cleanProfiles(list).map((profile) => String(profile.id || "")));
  list = activeClientProfiles().filter((profile) => allowedIds.has(String(profile.id || "")));
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>ছবি</th><th>নাম</th><th>যোগাযোগ</th><th>ঠিকানা</th><th>স্ট্যাটাস</th><th>এজেন্ট</th><th>কাজ</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8">কোনো client পাওয়া যায়নি। Search spelling বা ID আরেকবার দেখুন।</td></tr>`;
    return;
  }
  list.forEach((profile) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(profile.id || "")}</td>
      <td>${photoUrl(profile.photo) ? `<img class="thumb" src="${escapeAttr(photoUrl(profile.photo))}" referrerpolicy="no-referrer" alt="">` : ""}</td>
      <td><strong>${escapeHtml(profile.fullName || "")}</strong><br><span class="note">${escapeHtml(profile.gender || "")}, ${escapeHtml(profile.age || "")}</span></td>
      <td>${escapeHtml(profile.phone || "")}<br><span class="note">${escapeHtml(profile.email || "")}</span></td>
      <td>${escapeHtml([profile.villageTown || profile.city, profile.district, profile.state].filter(Boolean).join(", "))}</td>
      <td>${statusBadge(profile.status || "pending")}</td>
      <td>${escapeHtml(profile.agentId || "Public")}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, state.session.role === "admin" ? "Admin View" : "Agent View", "btn-blue", () => openDetails(profile));
    if (state.session.role === "admin") {
      addAction(actions, profile.status === "verified" ? "Pending" : "Approve", "btn-green", () => setProfileStatus(profile, profile.status === "verified" ? "pending" : "verified"));
      addAction(actions, "Delete", "btn-danger", () => deleteProfile(profile));
    }
    body.appendChild(tr);
  });
}

function renderMarriageTable() {
  const marriages = completedMarriageProfiles();
  $("#tableHead").innerHTML = `<tr><th>Client ID</th><th>Client</th><th>Marriage Date</th><th>Married With</th><th>Agent</th><th>Note</th><th>Actions</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!marriages.length) {
    body.innerHTML = `<tr><td colspan="7">No completed marriage records yet.</td></tr>`;
    return;
  }
  marriages.forEach((profile) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(profile.id || "")}</td>
      <td><strong>${escapeHtml(profile.fullName || "")}</strong><br><span class="note">${escapeHtml(profile.phone || "")}</span></td>
      <td>${escapeHtml(formatDate(profile.marriageDate) || profile.marriageDate || "")}</td>
      <td>${escapeHtml(profile.marriedWithName || "")}<br><span class="note">${escapeHtml(profile.marriedWithProfileId || "")}</span></td>
      <td>${escapeHtml(profile.agentId || "Public")}</td>
      <td>${escapeHtml(profile.marriageNote || "")}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "View", "btn-blue", () => openDetails(profile));
    if (state.session.role === "admin") addAction(actions, "Update", "btn-gold", () => openMarriageModal(profile));
    body.appendChild(tr);
  });
}

function renderPaymentTable() {
  const payments = cleanPayments(state.payments || []);
  $("#tableHead").innerHTML = `<tr><th>Payment ID</th><th>Client</th><th>Type</th><th>Amount</th><th>Balance</th><th>Date</th><th>Mode</th><th>Purpose</th><th>Received By</th><th>Receipt</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!payments.length) {
    body.innerHTML = `<tr><td colspan="10">No payments yet.</td></tr>`;
    return;
  }
  payments.forEach((payment) => {
    const type = paymentDirection(payment);
    const balance = payment.balanceAfter !== undefined && payment.balanceAfter !== ""
      ? Number(payment.balanceAfter || 0)
      : paymentBalanceForProfile(payment.profileId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(payment.paymentId || "")}</td>
      <td><strong>${escapeHtml(payment.clientName || "")}</strong><br><span class="note">${escapeHtml(payment.profileId || "")}</span></td>
      <td><span class="ledger-type ${type}">${type === "debit" ? "Debit" : "Receive"}</span></td>
      <td><strong class="amount-${type}">${type === "debit" ? "-" : "+"}₹${escapeHtml(payment.amount || "0")}</strong></td>
      <td><strong>₹${escapeHtml(balance)}</strong></td>
      <td>${escapeHtml(formatDate(payment.paymentDate) || payment.paymentDate || "")}</td>
      <td>${escapeHtml(payment.mode || "")}</td>
      <td>${escapeHtml(payment.purpose || "")}</td>
      <td>${escapeHtml(payment.receivedByName || payment.receivedByRole || "")}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "Receipt", "btn-blue", () => openReceiptModal(payment));
    body.appendChild(tr);
  });
}
function renderAgentTable() {
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>Photo</th><th>Name</th><th>Phone</th><th>Area</th><th>Level</th><th>Status</th><th>Clients</th><th>Actions</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!state.agents.length) {
    body.innerHTML = `<tr><td colspan="9">No agents yet.</td></tr>`;
    return;
  }
  state.agents.forEach((agent) => {
    const count = state.profiles.filter((profile) => String(profile.agentId || "") === String(agent.id || "")).length;
    const photo = photoUrl(agent.photo);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(agent.id || "")}</td>
      <td>${photo ? `<img class="thumb" src="${escapeAttr(photo)}" alt="">` : ""}</td>
      <td><strong>${escapeHtml(agent.name || "")}</strong><br><span class="note">${escapeHtml(agent.email || "")}</span></td>
      <td>${escapeHtml(agent.phone || "")}</td>
      <td>${escapeHtml(agent.area || "")}</td>
      <td>${escapeHtml(agent.level || "Standard")}</td>
      <td>${statusBadge(agent.status || "active")}</td>
      <td>${count}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "View", "btn-blue", () => openAgentDetail(agent));
    addAction(actions, "Edit", "btn-gold", () => fillAgentForm(agent));
    if (agent.status === "pending") addAction(actions, "Approve", "btn-green", () => approveAgent(agent));
    addAction(actions, agent.status === "blocked" ? "Activate" : "Block", "btn-blue", () => toggleAgent(agent));
    addAction(actions, "Delete", "btn-danger", () => deleteAgent(agent));
    body.appendChild(tr);
  });
}

function renderAgentPayoutTable() {
  const payouts = cleanAgentPayouts(state.agentPayouts || []);
  $("#tableHead").innerHTML = `<tr><th>Payout ID</th><th>Agent</th><th>Amount</th><th>Date</th><th>Mode</th><th>For</th><th>Note</th><th>Paid By</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!payouts.length) {
    body.innerHTML = `<tr><td colspan="8">No agent payouts yet.</td></tr>`;
    return;
  }
  payouts.forEach((payout) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(payout.payoutId || "")}</td>
      <td><strong>${escapeHtml(payout.agentName || "")}</strong><br><span class="note">${escapeHtml(payout.agentId || "")}</span></td>
      <td><strong class="amount-credit">+₹${escapeHtml(payout.amount || "0")}</strong></td>
      <td>${escapeHtml(formatDate(payout.payoutDate) || payout.payoutDate || "")}</td>
      <td>${escapeHtml(payout.mode || "")}</td>
      <td>${escapeHtml(payout.purpose || "")}</td>
      <td>${escapeHtml(payout.note || "")}</td>
      <td>${escapeHtml(payout.paidByName || payout.paidByRole || "")}</td>`;
    body.appendChild(tr);
  });
}

function renderMyAccountView() {
  $("#tableHead").innerHTML = "";
  const body = $("#tableBody");
  body.innerHTML = `<tr><td>Use the form above to view and edit your agent profile.</td></tr>`;
  fillMyAccountForm(state.currentAgent || {});
}

function fillMyAccountForm(agent) {
  const form = $("#myAccountForm");
  if (!form) return;
  const hydrated = hydrateLegacyAgent(agent);
  ["name", "gender", "dob", ...AGENT_ADDRESS_FIELDS, "phone", "whatsapp", "email", "aadhaar", ...AGENT_BANK_FIELDS, "area"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = key === "dob" ? formatDate(hydrated[key]) : hydrated[key] || "";
  });
  if (form.elements.currentPassword) form.elements.currentPassword.value = "";
  if (form.elements.newPassword) form.elements.newPassword.value = "";
  if ($("#myAccountPhotoFile")) $("#myAccountPhotoFile").value = "";
}

function openAgentDetail(agent) {
  state.activeAgentDetail = agent;
  $("#agentDetailTitle").textContent = agent.name || "Agent Profile";
  const photo = photoUrl(agent.photo);
  const payouts = cleanAgentPayouts(state.agentPayouts || []).filter((p) => String(p.agentId || "") === String(agent.id || ""));
  const totalPayout = payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const fields = [
    ["Agent ID", agent.id], ["Name", agent.name], ["Gender", agent.gender], ["DOB", formatDate(agent.dob)],
    ["House No", agent.houseNo], ["Village / Town", agent.villageTown], ["Post Office", agent.postOffice],
    ["Police Station", agent.policeStation], ["District", agent.district], ["State", agent.state], ["PIN Code", agent.pinCode],
    ["Full Address", formatAgentAddress(agent)],
    ["Phone", agent.phone], ["WhatsApp", agent.whatsapp], ["Email", agent.email],
    ["Aadhaar", agent.aadhaar],
    ["Bank Name", agent.bankName], ["IFSC Code", agent.ifscCode], ["Account Number", agent.accountNumber],
    ["Account Holder", agent.accountHolderName], ["Bank Summary", formatAgentBank(agent)], ["UPI ID", agent.upiId],
    ["Working Area", agent.area], ["Level", agent.level], ["Status", agent.status],
    ["Reg. Commission", `${agent.regCommission || 30}%`], ["Marriage Commission", `${agent.marriageCommission || 25}%`],
    ["Password", agent.password || "Set new password"], ["Total Payout", `₹${totalPayout}`]
  ];
  $("#agentDetailBody").innerHTML = `
    <div class="detail-hero">
      <div class="detail-photo-wrap">${photo ? `<img class="detail-photo" src="${escapeAttr(photo)}" alt="">` : `<div class="detail-photo avatar">${initials(agent.name)}</div>`}</div>
      <div class="detail-summary">
        ${statusBadge(agent.status || "active")}
        <h4>${escapeHtml(agent.name || "Agent")}</h4>
        <p>${escapeHtml([agent.level, agent.area].filter(Boolean).join(" · "))}</p>
      </div>
    </div>
    <div class="agent-detail-grid">${fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong>${formatDetailValue(value)}</p>`).join("")}</div>
    ${payouts.length ? `<div class="detail-payment-list" style="margin-top:12px">${payouts.map((p) => `<div class="payment-mini-row"><strong>+₹${escapeHtml(p.amount || "0")}</strong><span>${escapeHtml(p.payoutDate || "")}</span><span>${escapeHtml(p.mode || "")}</span><em>${escapeHtml(p.purpose || "")}</em></div>`).join("")}</div>` : ""}`;
  const actions = $("#agentDetailActions");
  actions.innerHTML = "";
  addAction(actions, "Edit", "btn-gold", () => { closeModals(); fillAgentForm(agent); });
  addAction(actions, "ID Card", "btn-blue", () => openAgentIdCard(agent));
  addAction(actions, "Reset Password", "btn-green", () => resetAgentPassword(agent));
  if (state.session.role === "admin") {
    addAction(actions, "Add Payout", "btn-green", () => { closeModals(); openAgentPayoutForm(agent); });
    if (agent.status === "pending") addAction(actions, "Approve", "btn-green", () => approveAgent(agent));
  }
  openModal("agentDetailModal");
}

function openAgentPayoutForm(agent) {
  state.activeTab = "agentPayouts";
  renderTabs();
  renderDashboard();
  const form = $("#agentPayoutForm");
  if (!form) return;
  form.reset();
  if ($("#payoutAgentId")) $("#payoutAgentId").value = agent?.id || "";
  if (form.elements.payoutDate) form.elements.payoutDate.value = new Date().toISOString().slice(0, 10);
  if ($("#agentPayoutSub")) $("#agentPayoutSub").textContent = agent?.name ? `Record payout for ${agent.name} (${agent.id})` : "Record commission payout to agent.";
  $("#agentPayoutTools")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function openAgentIdCard(agent) {
  if (!agent?.id) return toast("Agent profile not found");
  const photo = photoUrl(agent.photo);
  $("#agentIdCardBody").innerHTML = `
    <div class="agent-id-card" id="agentIdPrintArea">
      <div class="id-header"><h4 style="margin:0">বিবাহ বন্ধন 2026</h4><small>Authorized Agent</small></div>
      <div class="id-body">
        ${photo ? `<img class="id-photo" src="${escapeAttr(photo)}" alt="">` : `<div class="id-photo avatar">${initials(agent.name)}</div>`}
        <h4 style="margin:8px 0 4px">${escapeHtml(agent.name || "")}</h4>
        <p class="note" style="margin:0 0 12px">${escapeHtml(agent.id || "")}</p>
        <div class="id-meta">
          <p><span>Level</span><strong>${escapeHtml(agent.level || "Standard")}</strong></p>
          <p><span>Phone</span><strong>${escapeHtml(agent.phone || "")}</strong></p>
          <p><span>Area</span><strong>${escapeHtml(agent.area || "")}</strong></p>
          <p><span>Reg. Comm.</span><strong>${escapeHtml(agent.regCommission || 30)}%</strong></p>
          <p><span>Marriage Comm.</span><strong>${escapeHtml(agent.marriageCommission || 25)}%</strong></p>
        </div>
      </div>
    </div>`;
  openModal("agentIdCardModal");
}

function printAgentIdCard() {
  window.print();
}

async function approveAgent(agent) {
  const level = prompt("Set agent level (Standard / Silver / Gold / Platinum):", agent.level || "Standard");
  if (level === null) return;
  const result = await api("approveAgent", { token: state.session.token, id: agent.id, status: "active", level: level || agent.level || "Standard" });
  if (!result.ok) return toast(result.error || "Approve failed");
  toast("Agent approved");
  closeModals();
  loadDashboardData();
}

async function resetAgentPassword(agent) {
  const password = prompt(`New password for ${agent.name || agent.id}:`, agent.password || "");
  if (!password) return;
  const result = await api("resetAgentPassword", { token: state.session.token, id: agent.id, password });
  if (!result.ok) return toast(result.error || "Password reset failed");
  toast(`Password reset: ${result.password || password}`);
  loadDashboardData();
}

async function submitAgentPayout(event) {
  event.preventDefault();
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(event.target).entries());
    payload.token = state.session.token;
    const result = await api("saveAgentPayout", payload);
    if (!result.ok) throw new Error(result.error || "Payout save failed");
    toast("Agent payout saved");
    event.target.reset();
    if (event.target.elements.payoutDate) event.target.elements.payoutDate.value = new Date().toISOString().slice(0, 10);
    await loadDashboardData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Payout";
  }
}

async function submitMyAccount(event) {
  event.preventDefault();
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = normalizeAgentPayload(Object.fromEntries(new FormData(event.target).entries()));
    payload.token = state.session.token;
    payload.phone = String(payload.phone || "").replace(/\D/g, "");
    payload.whatsapp = String(payload.whatsapp || "").replace(/\D/g, "");
    if (payload.pinCode && !/^\d{6}$/.test(payload.pinCode)) throw new Error("Valid 6-digit PIN code required");
    const photoFile = $("#myAccountPhotoFile")?.files?.[0];
    if (photoFile) payload.photo = await fileToDataUrl(photoFile);
    const result = await api("updateAgentSelf", payload);
    if (!result.ok) throw new Error(result.error || "Profile update failed");
    state.currentAgent = result.agent || state.currentAgent;
    if (result.agent?.name) state.session.name = result.agent.name;
    toast("Profile updated");
    await loadDashboardData();
    showDashboard();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save My Profile";
  }
}

async function submitAgentRegister(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Submitting...";
  try {
    const payload = normalizeAgentPayload(Object.fromEntries(new FormData(form).entries()));
    if (payload.password !== payload.passwordConfirm) throw new Error("Password and confirm password do not match");
    delete payload.passwordConfirm;
    payload.phone = String(payload.phone || "").replace(/\D/g, "");
    payload.whatsapp = String(payload.whatsapp || "").replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(payload.phone)) throw new Error("Valid 10-digit phone number required");
    if (payload.pinCode && !/^\d{6}$/.test(payload.pinCode)) throw new Error("Valid 6-digit PIN code required");
    const photoFile = $("#regAgentPhotoFile")?.files?.[0];
    const aadhaarFile = $("#regAgentAadhaarFile")?.files?.[0];
    const bankFile = $("#regAgentBankFile")?.files?.[0];
    if (photoFile) payload.photo = await fileToDataUrl(photoFile);
    if (aadhaarFile) payload.aadhaarDoc = await fileToDataUrl(aadhaarFile);
    if (bankFile) payload.bankDoc = await fileToDataUrl(bankFile);
    const result = await api("registerAgent", payload);
    if (!result.ok) throw new Error(result.error || "Registration failed");
    form.reset();
    clearAgentFileInputs("reg");
    showAgentLoginView();
    showMessageModal("Agent registration submitted. Admin will approve your account.", "success");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Submit Registration";
  }
}

function clearAgentFileInputs(prefix = "admin") {
  const map = prefix === "reg"
    ? ["regAgentPhotoFile", "regAgentAadhaarFile", "regAgentBankFile"]
    : ["agentPhotoFile", "agentAadhaarFile", "agentBankFile"];
  map.forEach((id) => { if ($("#" + id)) $("#" + id).value = ""; });
}

function cleanAgentPayouts(list) {
  return (Array.isArray(list) ? list : []).filter((payout) =>
    String(payout?.payoutId || "").trim() ||
    String(payout?.agentId || "").trim() ||
    String(payout?.amount || "").trim()
  );
}

function cleanProfiles(list) {
  return (Array.isArray(list) ? list : []).filter((profile) =>
    String(profile?.id || "").trim() ||
    String(profile?.fullName || "").trim() ||
    String(profile?.phone || "").trim()
  );
}

function openProfileNoteModal(profile, noteType) {
  activeNoteContext = { profile, noteType };
  const isRequirement = noteType === "requirement";
  $("#profileNoteTitle").textContent = isRequirement ? "Client Requirement" : "Field Verification Remark";
  $("#profileNoteClient").textContent = `${profile.fullName || "Client"} (${profile.id || ""})`;
  $("#profileNoteText").value = isRequirement ? (profile.specialRequirement || "") : (profile.verificationRemark || "");
  $("#profileNoteHelp").textContent = isRequirement
    ? "Agent/Admin client-er special requirement ekhane likhte parbe."
    : "Client data thik na bhul, field verified remark/review ekhane likhun.";
  openModal("profileNoteModal");
}

async function submitProfileNote(event) {
  event.preventDefault();
  if (!activeNoteContext?.profile) return toast("Profile note missing");
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await api("saveProfileNote", {
      token: state.session.token,
      id: activeNoteContext.profile.id,
      noteType: activeNoteContext.noteType,
      note: $("#profileNoteText").value || ""
    });
    if (!result.ok) throw new Error(result.error || "Note save failed");
    closeModals();
    toast("Note saved");
    await loadDashboardData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Note";
  }
}

function openMarriageModal(profile) {
  activeMarriageProfile = profile;
  $("#marriageClient").textContent = `${profile.fullName || "Client"} (${profile.id || ""})`;
  const form = $("#marriageForm");
  form.reset();
  form.elements.marriageDate.value = formatDate(profile.marriageDate) || new Date().toISOString().slice(0, 10);
  form.elements.marriedWithProfileId.value = profile.marriedWithProfileId || "";
  form.elements.marriedWithName.value = profile.marriedWithName || "";
  form.elements.marriageNote.value = profile.marriageNote || "";
  openModal("marriageModal");
}

async function submitMarriageComplete(event) {
  event.preventDefault();
  if (!activeMarriageProfile?.id) return toast("Profile missing");
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(event.target).entries());
    const result = await api("completeMarriage", { ...payload, token: state.session.token, id: activeMarriageProfile.id });
    if (!result.ok) throw new Error(result.error || "Marriage complete failed");
    closeModals();
    toast("Marriage completed");
    state.activeTab = "marriages";
    await loadDashboardData();
    renderTabs();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Marriage";
  }
}

function cleanAgents(list) {
  return (Array.isArray(list) ? list : []).filter((agent) =>
    String(agent?.id || "").trim() ||
    String(agent?.name || "").trim() ||
    String(agent?.phone || "").trim() ||
    String(agent?.email || "").trim()
  );
}

function cleanPayments(list) {
  return (Array.isArray(list) ? list : []).filter((payment) =>
    String(payment?.paymentId || "").trim() ||
    String(payment?.profileId || "").trim() ||
    String(payment?.amount || "").trim()
  );
}
function addAction(container, label, className, handler) {
  const button = document.createElement("button");
  button.className = `btn ${className}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  container.appendChild(button);
}

function openProfileForm(profile = {}) {
  $("#profileModalTitle").textContent = profile.id ? "প্রোফাইল এডিট" : "প্রোফাইল তৈরি";
  const form = $("#profileForm");
  form.reset();
  Object.entries(profile).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input) input.value = key === "dob" ? formatDate(value) : value || "";
  });
  if ($("#photoFile")) $("#photoFile").value = "";
  clearPhotoCropper();
  if ($("#docFile")) $("#docFile").value = "";
  if (state.session?.role === "agent" && !profile.id) {
    form.elements.agentId.value = state.session.agentId || "";
  }
  openModal("profileModal");
}

async function submitProfile(event) {
  event.preventDefault();
  const agreeCheckbox = $("#agreeTerms");
  if (agreeCheckbox && !agreeCheckbox.checked) {
    alert("❌ অনুগ্রহ করে 'বিবাহ বন্ধন ম্যারেজ ব্যুরো'-এর আইনি শর্তাবলীতে সম্মত হয়ে চেকবক্সে টিক দিন।");
    agreeCheckbox.focus();
    return;
  }

  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.phone = String(payload.phone || "").replace(/\D/g, "");
    payload.pin = String(payload.pin || "").replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(payload.phone)) {
      throw new Error("সঠিক ১০ সংখ্যার ভারতীয় মোবাইল নম্বর দিন");
    }
    if (payload.pin && !/^\d{6}$/.test(payload.pin)) {
      throw new Error("সঠিক ৬ সংখ্যার পিন কোড দিন");
    }
    const file = $("#photoFile").files[0];
    if (file) {
      payload.photo = state.croppedPhotoDataUrl || cropProfilePhotoToDataUrl();
    }
    const docFile = $("#docFile").files[0];
    if (docFile) payload.document = await fileToDataUrl(docFile);
    payload.token = state.session?.token || "";
    payload.role = state.session?.role || "public";
    if (state.session?.role === "agent" && !payload.agentId) payload.agentId = state.session.agentId;
    const action = payload.id ? "editProfile" : "createProfile";
    const result = await api(action, payload);
    if (!result.ok) throw new Error(result.error || "Profile save failed");
    const savedId = result.id || payload.id || "";
    closeModals();
    await (state.session ? loadDashboardData() : loadPublicData());
    showProfileSuccess(payload.fullName, savedId, Boolean(payload.id));
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Profile";
  }
}

async function setProfileStatus(profile, status) {
  const result = await api("setProfileStatus", { token: state.session.token, id: profile.id, status });
  if (!result.ok) return toast(result.error || "Status update failed");
  toast("Status updated");
  loadDashboardData();
}

async function deleteProfile(profile) {
  if (!confirm(`Delete ${profile.fullName || profile.id}?`)) return;
  const result = await api("deleteProfile", { token: state.session?.token || "", role: state.session?.role || "", agentId: state.session?.agentId || "", id: profile.id });
  if (!result.ok) return toast(result.error || "Delete failed");
  toast("Profile deleted");
  state.session ? loadDashboardData() : loadPublicData();
}

async function submitAgent(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = normalizeAgentPayload(Object.fromEntries(new FormData(form).entries()));
    payload.token = state.session.token;
    payload.phone = String(payload.phone || "").replace(/\D/g, "");
    payload.whatsapp = String(payload.whatsapp || "").replace(/\D/g, "");
    if (payload.pinCode && !/^\d{6}$/.test(payload.pinCode)) throw new Error("Valid 6-digit PIN code required");
    const photoFile = $("#agentPhotoFile")?.files?.[0];
    const aadhaarFile = $("#agentAadhaarFile")?.files?.[0];
    const bankFile = $("#agentBankFile")?.files?.[0];
    if (photoFile) payload.photo = await fileToDataUrl(photoFile);
    if (aadhaarFile) payload.aadhaarDoc = await fileToDataUrl(aadhaarFile);
    if (bankFile) payload.bankDoc = await fileToDataUrl(bankFile);
    const result = await api("saveAgent", payload);
    if (!result.ok) throw new Error(result.error || "Agent save failed");
    toast("Agent saved");
    form.reset();
    clearAgentFileInputs();
    state.activeTab = "agents";
    await loadDashboardData();
    renderTabs();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Agent";
  }
}

async function submitStory(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  payload.token = state.session.token;
  const result = await api("saveStory", payload);
  if (!result.ok) return toast(result.error || "Story save failed");
  toast("Story saved");
  event.target.reset();
  state.activeTab = "stories";
  await loadDashboardData();
  renderTabs();
}

function fillStoryForm(story) {
  state.activeTab = "stories";
  renderTabs();
  renderDashboard();
  const form = $("#storyForm");
  form.reset();
  Object.entries(story).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input) input.value = value || "";
  });
  window.scrollTo({ top: $("#storyTools").offsetTop - 90, behavior: "smooth" });
}

async function deleteStory(story) {
  if (!confirm(`Delete story ${story.coupleName || story.id}?`)) return;
  const result = await api("deleteStory", { token: state.session.token, id: story.id });
  if (!result.ok) return toast(result.error || "Story delete failed");
  toast("Story deleted");
  $("#storyForm").reset();
  loadDashboardData();
}

function fillAgentForm(agent) {
  state.activeTab = "agentForm";
  renderTabs();
  renderDashboard();
  const form = $("#agentForm");
  form.reset();
  clearAgentFileInputs();
  Object.entries(hydrateLegacyAgent(agent)).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input) input.value = key === "dob" ? formatDate(value) : value || "";
  });
  if (form.elements.password) form.elements.password.value = agent.password || "";
  if (form.elements.regCommission && !agent.regCommission) form.elements.regCommission.value = "30";
  if (form.elements.marriageCommission && !agent.marriageCommission) form.elements.marriageCommission.value = "25";
  $("#agentTools").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function toggleAgent(agent) {
  const status = agent.status === "blocked" ? "active" : "blocked";
  const result = await api("saveAgent", { ...agent, status, token: state.session.token });
  if (!result.ok) return toast(result.error || "Agent update failed");
  toast("Agent status updated");
  loadDashboardData();
}

async function deleteAgent(agent) {
  if (!confirm(`Delete agent ${agent.name || agent.id}?`)) return;
  const result = await api("deleteAgent", { token: state.session.token, id: agent.id });
  if (!result.ok) return toast(result.error || "Agent delete failed");
  toast("Agent deleted");
  $("#agentForm").reset();
  loadDashboardData();
}

function paymentDirection(payment) {
  const type = String(payment?.transactionType || "").toLowerCase();
  const status = String(payment?.status || "").toLowerCase();
  return type === "debit" || status === "debited" || status === "refund" || status === "service" ? "debit" : "credit";
}

function signedPaymentAmount(payment) {
  const amount = Number(payment?.amount || 0);
  return paymentDirection(payment) === "debit" ? -amount : amount;
}

function paymentBalanceForProfile(profileId) {
  return cleanPayments(state.payments || [])
    .filter((payment) => String(payment.profileId || "") === String(profileId || ""))
    .reduce((sum, payment) => sum + signedPaymentAmount(payment), 0);
}

function openReceiptModal(payment) {
  const type = paymentDirection(payment);
  const balance = payment.balanceAfter !== undefined && payment.balanceAfter !== ""
    ? Number(payment.balanceAfter || 0)
    : paymentBalanceForProfile(payment.profileId);
  const receipt = {
    paymentId: payment.paymentId || "",
    clientName: payment.clientName || "",
    profileId: payment.profileId || "",
    transactionType: type,
    amount: payment.amount || "0",
    balanceAfter: balance,
    paymentDate: formatDate(payment.paymentDate) || payment.paymentDate || "",
    mode: payment.mode || "",
    purpose: payment.purpose || "",
    receivedBy: payment.receivedByName || payment.receivedByRole || ""
  };
  activeReceiptTitle = receiptFileName(receipt);
  $("#receiptBody").innerHTML = receiptTemplate(receipt);
  openModal("receiptModal");
}

function receiptTemplate(receipt) {
  const isDebit = receipt.transactionType === "debit";
  return `
    <div class="receipt-paper receipt-4x6" id="receiptPrintArea">
      <div class="receipt-top">
        <div class="receipt-brand">
          <div class="receipt-logo">BB</div>
          <div>
            <h3>বিবাহ বন্ধন 2026</h3>
            <p>${isDebit ? "Debit Voucher" : "Money Receipt"}</p>
          </div>
        </div>
        <div class="receipt-no">
          <span>Receipt No</span>
          <strong>${escapeHtml(receipt.paymentId || "N/A")}</strong>
        </div>
      </div>
      <div class="receipt-money-row">
        <div class="receipt-amount ${isDebit ? "debit" : "credit"}">
          <span>${isDebit ? "Debited Amount" : "Received Amount"}</span>
          <strong>${isDebit ? "-" : "+"}Rs. ${escapeHtml(receipt.amount || "0")}</strong>
        </div>
        <div class="receipt-balance">
          <span>Customer Total Balance</span>
          <strong>Rs. ${escapeHtml(receipt.balanceAfter || 0)}</strong>
        </div>
      </div>
      <div class="receipt-grid">
        <p><span>Client</span><strong>${escapeHtml(receipt.clientName || "N/A")}</strong></p>
        <p><span>Profile ID</span><strong>${escapeHtml(receipt.profileId || "N/A")}</strong></p>
        <p><span>Date</span><strong>${escapeHtml(receipt.paymentDate || "N/A")}</strong></p>
        <p><span>Mode</span><strong>${escapeHtml(receipt.mode || "N/A")}</strong></p>
        <p><span>Purpose</span><strong>${escapeHtml(receipt.purpose || "N/A")}</strong></p>
        <p><span>Received By</span><strong>${escapeHtml(receipt.receivedBy || "N/A")}</strong></p>
      </div>
      <div class="receipt-footer single">
        <div><span>Receiver Signature</span></div>
      </div>
    </div>`;
}

function setReceiptPrintSize(size) {
  const selectedSize = size === "a4" ? "a4" : "4x6";
  const style = $("#receiptPageStyle") || document.createElement("style");
  style.id = "receiptPageStyle";
  style.textContent = selectedSize === "a4"
    ? "@page { size: A4; margin: 0; }"
    : "@page { size: 4in 6in; margin: 0; }";
  if (!style.parentNode) document.head.appendChild(style);
  $("#receiptPrintArea")?.classList.toggle("receipt-a4", selectedSize === "a4");
  $("#receiptPrintArea")?.classList.toggle("receipt-4x6", selectedSize !== "a4");
}

function printReceipt() {
  setReceiptPrintSize($("#receiptSize")?.value || "4x6");
  const previousTitle = document.title;
  if (activeReceiptTitle) document.title = activeReceiptTitle;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };
  window.addEventListener("afterprint", restoreTitle);
  window.print();
}

function receiptFileName(receipt) {
  const client = String(receipt?.clientName || "Client").trim() || "Client";
  return `${sanitizeFileName(client)} payment receipt`;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function submitPayment(event) {
  event.preventDefault();
  if (!state.session?.token) return toast("Login required");
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.token = state.session.token;
    const result = await api("savePayment", payload);
    if (!result.ok) throw new Error(result.error || "Payment save failed");
    closeModals();
    openReceiptModal(result.payment || payload);
    state.activeTab = "payments";
    await loadDashboardData();
    renderTabs();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Payment";
  }
}
function openDetails(profile) {
  $("#detailTitle").textContent = profile.fullName || "Profile";
  const photo = photoUrl(profile.photo);
  const isLoggedIn = Boolean(state.session);
  const profilePayments = cleanPayments(state.payments || []).filter((payment) => String(payment.profileId || "") === String(profile.id || ""));
  const totalPaid = profilePayments.reduce((sum, payment) => sum + signedPaymentAmount(payment), 0);
  const lastPayment = profilePayments[profilePayments.length - 1];
  const publicFields = [
    ["ID", profile.id], ["বয়স", profile.age], ["লিঙ্গ", profile.gender],
    ["উচ্চতা", profile.height], ["গায়ের রং", profile.complexion],
    ["ধর্ম", profile.religion],
    ["শিক্ষা", profile.education],
    ["বৈবাহিক অবস্থা", profile.maritalStatus], ["খাদ্যাভ্যাস", profile.diet],
    ["জেলা", profile.district], ["রাজ্য", profile.state],
    ["পছন্দের গায়ের রং", profile.prefComplexion], ["পছন্দের শিক্ষা", profile.prefEducationLevel],
    ["পছন্দের বয়স", profile.prefAgeRange], ["পছন্দের উচ্চতা", profile.prefHeight],
    ["পছন্দের পেশা", profile.prefLivelihood], 
    ["যোগাযোগ", "এই প্রোফাইল পছন্দ হলে আমাদের অফিসে অথবা এজেন্টের সঙ্গে যোগাযোগ করুন। অফিস নম্বর - 9064899089."]
  ];
  const privateFields = [
    ["ID", profile.id], ["বয়স", profile.age], ["লিঙ্গ", profile.gender],
    ["বাবার নাম", profile.fatherName], ["মায়ের নাম", profile.motherName],
    ["ওজন", profile.weight], ["উচ্চতা", profile.height], ["গায়ের রং", profile.complexion],
    ["ধর্ম", profile.religion], ["সম্প্রদায়", profile.community], ["জাতি", profile.caste],
    ["গোত্র", profile.gotra], ["লগ্ন / রাশি", profile.rashi], ["শিক্ষা", profile.education],
    ["নিজের পেশা", profile.occupation], ["বাবার পেশা", profile.fatherProfession],
    ["মায়ের পেশা", profile.motherProfession], ["আয়", profile.income],
    ["বাড়ির ধরন", profile.homeType], ["কত নম্বর সন্তান", profile.childOrder],
    ["ভাই সংখ্যা", profile.brothersCount], ["বোন সংখ্যা", profile.sistersCount], ["জীবনের ইচ্ছা", profile.lifeWish],
    ["বৈবাহিক অবস্থা", profile.maritalStatus], ["প্রথম বিবাহ", profile.firstMarriage], ["খাদ্যাভ্যাস", profile.diet],
    ["ঠিকানা", [profile.addressLine, profile.villageTown, profile.postOffice, profile.policestation, profile.district, profile.state, profile.pin].filter(Boolean).join(", ")],
    ["পছন্দের গায়ের রং", profile.prefComplexion], ["পছন্দের শিক্ষা", profile.prefEducationLevel],
    ["পছন্দের বয়স", profile.prefAgeRange], ["পছন্দের উচ্চতা", profile.prefHeight],
    ["পছন্দের পেশা", profile.prefLivelihood], ["পছন্দের আয়", profile.prefIncomeType],
    ["নিজের সম্পর্কে", profile.about], ["মোবাইল", profile.phone], ["ইমেল", profile.email],
    ["ডকুমেন্ট টাইপ", profile.documentType], ["ডকুমেন্ট", profile.document]
  ];
  if (isLoggedIn) {
    privateFields.push(
      ["স্পেশাল রিকোয়ারমেন্ট", profile.specialRequirement],
      ["ফিল্ড ভেরিফিকেশন রিমার্ক", profile.verificationRemark],
      ["ম্যারেজ স্ট্যাটাস", profile.marriageStatus],
      ["বিয়ের তারিখ", profile.marriageDate],
      ["যার সাথে বিয়ে", [profile.marriedWithName, profile.marriedWithProfileId].filter(Boolean).join(" - ")],
      ["ম্যারেজ নোট", profile.marriageNote]
    );
  }
  const fields = isLoggedIn ? privateFields : publicFields;
  const paymentPanel = isLoggedIn ? `
    <div class="detail-payment-panel">
      <div class="detail-payment-summary">
        <p><strong>₹${escapeHtml(totalPaid || 0)}</strong><span>Balance</span></p>
        <p><strong>${escapeHtml(profilePayments.length)}</strong><span>Payments</span></p>
        <p><strong>${escapeHtml(lastPayment?.paymentDate || "N/A")}</strong><span>Last Payment</span></p>
      </div>
      <div class="detail-payment-list">
        ${profilePayments.length ? profilePayments.map((payment) => `
          <div class="payment-mini-row">
            <strong>${paymentDirection(payment) === "debit" ? "-" : "+"}₹${escapeHtml(payment.amount || "0")}</strong>
            <span>${escapeHtml(payment.paymentDate || "")}</span>
            <span>${escapeHtml(payment.mode || "")}</span>
            <em>${escapeHtml(payment.purpose || "")}</em>
          </div>`).join("") : `<div class="payment-mini-row empty">No payment added yet.</div>`}
      </div>
    </div>` : "";
  $("#detailBody").innerHTML = `
    <div class="detail-hero">
      <div class="detail-photo-wrap">${photo ? `<img class="detail-photo" src="${escapeAttr(photo)}" referrerpolicy="no-referrer" alt="${escapeAttr(profile.fullName || "Profile")}">` : `<div class="detail-photo avatar" style="aspect-ratio:1">${initials(profile.fullName)}</div>`}</div>
      <div class="detail-summary">
        <span class="status ${escapeAttr(profile.status || "pending")}">${escapeHtml(profile.status || "pending")}</span>
        <h4>${escapeHtml(profile.fullName || "Profile")}</h4>
        <p>${escapeHtml([profile.age ? `${profile.age} yrs` : "", profile.height, profile.education, profile.occupation].filter(Boolean).join(" • "))}</p>
        <div class="detail-tags">${[profile.religion, profile.community, profile.district].filter(Boolean).map(chip).join("")}</div>
      </div>
    </div>
    ${paymentPanel}
    ${isLoggedIn ? `<div class="row-actions detail-actions"></div>` : ""}
    <div class="detail-list upgraded">${fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong>${formatDetailValue(value)}</p>`).join("")}</div>`;
  const detailActions = $(".detail-actions", $("#detailBody"));
  if (detailActions) {
    addAction(detailActions, "Edit", "btn-gold", () => openProfileForm(profile));
    addAction(detailActions, "Payment", "btn-green", () => openPaymentModal(profile));
    addAction(detailActions, "Requirement", "btn-blue", () => openProfileNoteModal(profile, "requirement"));
    addAction(detailActions, "Verify Note", "btn-gold", () => openProfileNoteModal(profile, "verification"));
    if (state.session.role === "admin" && String(profile.marriageStatus || "").toLowerCase() !== "completed") {
      addAction(detailActions, "Marriage Complete", "btn-green", () => openMarriageModal(profile));
    }
  }
  openModal("detailModal");
}
function formatDetailValue(value) {
  if (!value) return "N/A";
  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeAttr(text)}" target="_blank" rel="noopener">Open link</a>`;
  }
  return escapeHtml(text);
}
function showProfileSuccess(name, id, isUpdate) {
  $("#successTitle").textContent = isUpdate ? "প্রোফাইল আপডেট হয়েছে" : "প্রোফাইল তৈরি হয়েছে";
  $("#successMessage").textContent = `${name || "Client"} - এর profile সফলভাবে ${isUpdate ? "আপডেট" : "সেভ"} করা হয়েছে।`;
  $("#successProfileId").textContent = id ? `Profile ID: ${id}` : "Profile ID save হওয়ার পর পাওয়া যাবে";
  openModal("successModal");
}
function logout() {
  clearInactivityTimer();
  state.session = null;
  state.activeTab = "profiles";
  document.body.classList.remove("dashboard-mode", "admin-mode", "agent-mode");
  $("#dashboardSection").classList.add("hidden");
  $$(".public-view").forEach((element) => element.classList.remove("hidden"));
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Logged out");
}

function openModal(id) {
  closeModals();
  const modal = document.getElementById(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModals() {
  $$(".modal").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function closeMessageModal() {
  const modal = $("#messageModal");
  if (!modal) return;
  modal.classList.remove("open", "success", "error", "info");
  modal.setAttribute("aria-hidden", "true");
}

function toast(message, type) {
  showMessageModal(message, type);
}

function showMessageModal(message, type = "") {
  const modal = $("#messageModal");
  if (!modal) return;
  const normalized = normalizeMessage(message);
  const messageType = type || normalized.type;
  modal.classList.remove("success", "error", "info");
  modal.classList.add(messageType);
  $("#messageMark").textContent = messageType === "error" ? "!" : messageType === "info" ? "i" : "✓";
  $("#messageTitle").textContent = normalized.title;
  $("#messageText").textContent = normalized.text;
  $("#messageDetail").textContent = normalized.detail || "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function normalizeMessage(message) {
  const raw = String(message || "").trim();
  const isError = /failed|error|required|invalid|delete failed|save failed|login failed|loading failed|update failed|not allowed|expired|সঠিক|দিন/i.test(raw);
  const successMap = {
    "Login successful": ["লগইন সফল হয়েছে", "আপনি সফলভাবে dashboard-এ প্রবেশ করেছেন।"],
    "Logged out": ["লগআউট সম্পন্ন হয়েছে", "আপনি সফলভাবে account থেকে বের হয়েছেন।"],
    "Status updated": ["স্ট্যাটাস আপডেট হয়েছে", "Client profile-এর status সফলভাবে পরিবর্তন করা হয়েছে।"],
    "Profile deleted": ["প্রোফাইল ডিলিট হয়েছে", "Client profile list থেকে এই profile সরানো হয়েছে।"],
    "Agent saved": ["Agent সেভ হয়েছে", "Agent account সফলভাবে সেভ করা হয়েছে।"],
    "Agent approved": ["Agent approve হয়েছে", "Agent account active করা হয়েছে।"],
    "Agent payout saved": ["Agent payout সেভ হয়েছে", "Commission payout record সফলভাবে সেভ করা হয়েছে।"],
    "Profile updated": ["প্রোফাইল আপডেট হয়েছে", "আপনার agent profile সফলভাবে আপডেট করা হয়েছে।"],
    "Agent status updated": ["Agent status আপডেট হয়েছে", "Agent account-এর status সফলভাবে পরিবর্তন করা হয়েছে।"],
    "Agent deleted": ["Agent ডিলিট হয়েছে", "Agent account list থেকে সরানো হয়েছে।"],
    "Story saved": ["Story সেভ হয়েছে", "Success story homepage-এর জন্য সেভ করা হয়েছে।"],
    "Story deleted": ["Story ডিলিট হয়েছে", "Success story list থেকে সরানো হয়েছে।"],
    "Note saved": ["নোট সেভ হয়েছে", "Client requirement / verification remark সফলভাবে সেভ হয়েছে।"],
    "Marriage completed": ["ম্যারেজ সম্পন্ন হিসেবে সেভ হয়েছে", "Client data delete না করে admin marriage record-এ রাখা হয়েছে।"],
    "Added to shortlist": ["Shortlist-এ যোগ হয়েছে", "এই profile shortlist-এ রাখা হয়েছে।"]
  };
  if (successMap[raw]) {
    return { type: "success", title: successMap[raw][0], text: successMap[raw][1] };
  }
  if (raw.startsWith("Payment saved:")) {
    const id = raw.replace("Payment saved:", "").trim();
    return { type: "success", title: "Payment সেভ হয়েছে", text: "Client payment details সফলভাবে সেভ করা হয়েছে।", detail: id ? `Payment ID: ${id}` : "" };
  }
  if (raw === "Session expired due to inactivity") {
    return { type: "info", title: "Session শেষ হয়েছে", text: "২ মিনিট কোনো কাজ না হওয়ায় নিরাপত্তার জন্য আপনাকে logout করা হয়েছে।" };
  }
  if (isError) {
    return { type: "error", title: "কাজটি সম্পন্ন হয়নি", text: "দয়া করে তথ্যগুলো আরেকবার দেখে আবার চেষ্টা করুন।", detail: raw || "Unknown error" };
  }
  return { type: "info", title: "বার্তা", text: raw || "কাজটি সম্পন্ন হয়েছে।" };
}

function bindPhotoCropper() {
  const input = $("#photoFile");
  if (!input) return;
  input.addEventListener("change", handlePhotoSelection);
  $("#cropZoom")?.addEventListener("input", (event) => {
    state.crop.zoom = Number(event.target.value || 1);
    renderCropImage();
  });
  $("#applyCropBtn")?.addEventListener("click", () => {
    if (!state.crop.img) return toast("Please select a profile photo first");
    state.croppedPhotoDataUrl = cropProfilePhotoToDataUrl();
    if ($("#cropPreview")) {
      $("#cropPreview").src = state.croppedPhotoDataUrl;
      $("#cropPreview").classList.remove("hidden");
    }
    toast("Cropped photo ready");
  });
  $("#resetCropBtn")?.addEventListener("click", resetCropPosition);

  const stage = $("#cropStage");
  if (!stage) return;
  stage.addEventListener("pointerdown", startCropDrag);
  stage.addEventListener("pointermove", moveCropDrag);
  stage.addEventListener("pointerup", endCropDrag);
  stage.addEventListener("pointercancel", endCropDrag);
  stage.addEventListener("wheel", zoomCropWithWheel, { passive: false });
}

function handlePhotoSelection(event) {
  const file = event.target.files?.[0];
  clearPhotoCropper(false);
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    event.target.value = "";
    toast("Please select an image file");
    return;
  }

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (state.crop.imageUrl) URL.revokeObjectURL(state.crop.imageUrl);
    state.crop.imageUrl = imageUrl;
    state.crop.img = image;
    resetCropPosition();
    $("#photoCropPanel")?.classList.remove("hidden");
  };
  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    event.target.value = "";
    toast("Could not load this photo");
  };
  image.src = imageUrl;
}

function resetCropPosition() {
  const stage = $("#cropStage");
  const image = state.crop.img;
  if (!stage || !image) return;
  const rect = stage.getBoundingClientRect();
  const minZoom = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  state.crop.minZoom = minZoom;
  state.crop.zoom = minZoom;
  state.crop.offsetX = 0;
  state.crop.offsetY = 0;
  if ($("#cropZoom")) {
    $("#cropZoom").min = String(minZoom);
    $("#cropZoom").max = String(Math.max(minZoom * 3, 3));
    $("#cropZoom").value = String(minZoom);
  }
  renderCropImage();
}

function renderCropImage() {
  const cropImage = $("#cropImage");
  const image = state.crop.img;
  if (!cropImage || !image) return;
  cropImage.src = state.crop.imageUrl;
  cropImage.style.width = `${image.naturalWidth * state.crop.zoom}px`;
  cropImage.style.height = `${image.naturalHeight * state.crop.zoom}px`;
  clampCropOffset();
  cropImage.style.transform = `translate(calc(-50% + ${state.crop.offsetX}px), calc(-50% + ${state.crop.offsetY}px))`;
}

function clampCropOffset() {
  const stage = $("#cropStage");
  const image = state.crop.img;
  if (!stage || !image) return;
  const rect = stage.getBoundingClientRect();
  const width = image.naturalWidth * state.crop.zoom;
  const height = image.naturalHeight * state.crop.zoom;
  const maxX = Math.max(0, (width - rect.width) / 2);
  const maxY = Math.max(0, (height - rect.height) / 2);
  state.crop.offsetX = Math.min(maxX, Math.max(-maxX, state.crop.offsetX));
  state.crop.offsetY = Math.min(maxY, Math.max(-maxY, state.crop.offsetY));
}

function startCropDrag(event) {
  if (!state.crop.img) return;
  state.crop.dragging = true;
  state.crop.startX = event.clientX;
  state.crop.startY = event.clientY;
  state.crop.baseX = state.crop.offsetX;
  state.crop.baseY = state.crop.offsetY;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveCropDrag(event) {
  if (!state.crop.dragging) return;
  state.crop.offsetX = state.crop.baseX + event.clientX - state.crop.startX;
  state.crop.offsetY = state.crop.baseY + event.clientY - state.crop.startY;
  renderCropImage();
}

function endCropDrag() {
  state.crop.dragging = false;
}

function zoomCropWithWheel(event) {
  if (!state.crop.img) return;
  event.preventDefault();
  const zoomInput = $("#cropZoom");
  const min = Number(zoomInput?.min || state.crop.minZoom || 1);
  const max = Number(zoomInput?.max || 3);
  const next = Math.min(max, Math.max(min, state.crop.zoom + (event.deltaY > 0 ? -0.05 : 0.05)));
  state.crop.zoom = next;
  if (zoomInput) zoomInput.value = String(next);
  renderCropImage();
}

function cropProfilePhotoToDataUrl() {
  const image = state.crop.img;
  const stage = $("#cropStage");
  if (!image || !stage) return "";
  const outputWidth = 800;
  const outputHeight = 1000;
  const rect = stage.getBoundingClientRect();
  const scale = 1 / state.crop.zoom;
  const sourceWidth = rect.width * scale;
  const sourceHeight = rect.height * scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2 - state.crop.offsetX * scale;
  const sourceY = (image.naturalHeight - sourceHeight) / 2 - state.crop.offsetY * scale;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function clearPhotoCropper(revoke = true) {
  state.croppedPhotoDataUrl = "";
  if (revoke && state.crop.imageUrl) URL.revokeObjectURL(state.crop.imageUrl);
  Object.assign(state.crop, { img: null, imageUrl: "", zoom: 1, minZoom: 1, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  $("#photoCropPanel")?.classList.add("hidden");
  if ($("#cropImage")) $("#cropImage").removeAttribute("src");
  if ($("#cropPreview")) {
    $("#cropPreview").removeAttribute("src");
    $("#cropPreview").classList.add("hidden");
  }
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function statusBadge(status) {
  const clean = status || "pending";
  return `<span class="status ${escapeAttr(clean)}">${escapeHtml(clean)}</span>`;
}

function chip(value) {
  return value ? `<span>${escapeHtml(value)}</span>` : "";
}

function photoUrl(value) {
  if (!value) return "";
  const url = String(value).trim();
  if (url.startsWith("data:image/")) return url;
  const idMatch = url.match(/(?:id=|\/d\/)([-\w]{20,})/);
  if (url.includes("drive.google.com") && idMatch) {
    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
  }
  return url;
}

function initials(name = "") {
  const text = String(name).trim();
  if (!text) return "BB";
  return text.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sameChoice(value, expected) {
  const aliases = {
    female: "মেয়ে",
    bride: "মেয়ে",
    male: "ছেলে",
    groom: "ছেলে",
    hindu: "হিন্দু",
    muslim: "মুসলিম",
    christian: "খ্রিস্টান",
    sikh: "শিখ",
    jain: "জৈন",
    buddhist: "বৌদ্ধ",
  };
  const left = aliases[normalize(value)] || normalize(value);
  const right = aliases[normalize(expected)] || normalize(expected);
  return left === right;
}

function includes(value, query) {
  return normalize(value).includes(normalize(query));
}

function emptyMessage(text) {
  return `<div class="panel" style="grid-column:1/-1;text-align:center">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function openPaymentModal(profile) {
  const form = $("#paymentForm");
  form.reset();
  form.profileId.value = profile.id || "";
  form.clientName.value = profile.fullName || "";
  form.agentId.value = profile.agentId || "";
  form.paymentDate.value = new Date().toISOString().slice(0, 10);
  if ($("#paymentClientName")) $("#paymentClientName").textContent = profile.fullName || "Client";
  if ($("#paymentProfileId")) $("#paymentProfileId").textContent = profile.id ? `Profile ID: ${profile.id}` : "";
  openModal("paymentModal");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then((registration) => {
        registration.update();
        console.log("Service Worker Registered");
      })
      .catch(err => console.log(err));
  });
}



