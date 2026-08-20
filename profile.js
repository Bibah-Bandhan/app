const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw4gQHKykWExnU_dkGSEl-2fMY-7pkpe5-BblvTIZDLAvW5n2fmmEIDO-2-wUhmQHb37w/exec";
const FEATURED_PROFILE_LIMIT = 6;

const state = {
  profiles: [],
  agents: [],
  payments: [],
  agentPayouts: [],
  commonExpenses: [],
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
let activeAgreementUploadProfile = null;

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
  if ($("#serviceAgreementForm")) $("#serviceAgreementForm").addEventListener("submit", submitServiceAgreement);
  if ($("#agreementUploadForm")) $("#agreementUploadForm").addEventListener("submit", submitAgreementScanUpload);
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
    document.getElementById("profiles")?.scrollIntoView({ behavior: "smooth" });
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
  if ($("#commonExpenseForm")) $("#commonExpenseForm").addEventListener("submit", submitCommonExpense);
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
  if ($("#cards")) $("#cards").innerHTML = emptyMessage("Loading profiles...");
  if ($("#featuredCards")) $("#featuredCards").innerHTML = emptyMessage("Loading profiles...");
  try {
    const response = await fetch(`${SCRIPT_URL}?view=public&t=${Date.now()}`,{cache:"no-store"});
    const data = await response.json();
    state.profiles = cleanProfiles(Array.isArray(data.profiles) ? data.profiles : Array.isArray(data) ? data : []);
    state.agents = cleanAgents(Array.isArray(data.agents) ? data.agents : []);
    state.stories = cleanStories(Array.isArray(data.stories) ? data.stories : []);
    state.filtered = state.profiles.filter((profile) => profile.status === "verified" && String(profile.marriageStatus || "").toLowerCase() !== "completed");
    renderStats();
    renderCards(state.filtered);
    applyUrlFilters();
    renderStories();
  } catch (error) {
    const message = emptyMessage(" সার্ভারের সাথে যোগাযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    if ($("#cards")) $("#cards").innerHTML = message;
    if ($("#featuredCards")) $("#featuredCards").innerHTML = message;
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
  state.commonExpenses = cleanCommonExpenses(result.commonExpenses || []);
  state.currentAgent = result.currentAgent || null;
  state.stories = cleanStories(result.stories || []);
  renderAgentDashboardPhoto(state.currentAgent);
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

function renderFeaturedCards(list) {
  const featuredCards = $("#featuredCards");
  if (!featuredCards) return;
  const featured = cleanProfiles(list).slice(0, FEATURED_PROFILE_LIMIT);
  featuredCards.innerHTML = "";
  if (!featured.length) {
    featuredCards.innerHTML = emptyMessage("No verified profiles found.");
    return;
  }
  featured.forEach((profile) => featuredCards.appendChild(profileCard(profile)));
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
        ${chip([profile.district].filter(Boolean).join(", "))}
      </div>
      <div class="meta">
        ${chip(profile.religion)}
        ${chip(profile.community)}
      </div>
      <p class="card-summary">${escapeHtml([profile.education, profile.occupation].filter(Boolean).join(" • "))}</p>
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
  renderAgentDashboardPhoto(state.currentAgent);
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

function renderAgentDashboardPhoto(agent) {
  const box = $("#agentDashboardPhoto");
  if (!box) return;
  if (state.session?.role !== "agent") {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const photo = photoUrl(agent?.photo);
  box.classList.remove("hidden");
  box.innerHTML = photo
    ? `<img src="${escapeAttr(photo)}" referrerpolicy="no-referrer" alt="${escapeAttr(agent?.name || "Agent")}">`
    : `<div class="agent-dashboard-initials">${initials(agent?.name || state.session?.name)}</div>`;
}

function renderTabs() {
  const tabs = $("#dashboardTabs");
  const items = state.session.role === "admin"
    ? [["profiles", "Profiles"], ["marriages", "Marriages"], ["payments", "Client Payments"], ["agents", "Agents"], ["agentPayouts", "Agent Payouts"], ["commonExpenses", "Common Expenses"], ["agentForm", "Create Agent"], ["stories", "Stories"]]
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
  $("#commonExpenseTools")?.classList.toggle("hidden", !(state.activeTab === "commonExpenses" && state.session.role === "admin"));

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


function renderCommonExpenseTable() {
  const expenses = cleanCommonExpenses(state.commonExpenses || []);
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>Date</th><th>Category</th><th>Amount</th><th>Meter / Month</th><th>Mode</th><th>Paid To</th><th>Note</th><th>Recorded By</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!expenses.length) {
    body.innerHTML = `<tr><td colspan="9">No common expenses yet.</td></tr>`;
    return;
  }
  expenses.forEach((expense) => {
    const meterInfo = expense.category === "Electricity"
      ? `${escapeHtml(expense.meterName || "Meter")}<br><span class="note">${escapeHtml(expense.previousReading || "0")} → ${escapeHtml(expense.currentReading || "0")} = ${escapeHtml(expense.units || "0")} unit @ ₹${escapeHtml(expense.ratePerUnit || "0")}</span>`
      : escapeHtml(expense.roomRentMonth || "");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(expense.expenseId || "")}</td>
      <td>${escapeHtml(formatDate(expense.expenseDate) || expense.expenseDate || "")}</td>
      <td>${escapeHtml(expense.category || "")}</td>
      <td><strong class="amount-debit">-₹${escapeHtml(expense.amount || "0")}</strong></td>
      <td>${meterInfo}</td>
      <td>${escapeHtml(expense.mode || "")}</td>
      <td>${escapeHtml(expense.paidTo || "")}</td>
      <td>${escapeHtml(expense.note || "")}</td>
      <td>${escapeHtml(expense.recordedByName || expense.recordedByRole || "")}</td>`;
    body.appendChild(tr);
  });
  const summary = document.createElement("tr");
  summary.innerHTML = `<td colspan="3"><strong>Total Common Expense</strong></td><td><strong class="amount-debit">-₹${escapeHtml(total)}</strong></td><td colspan="5"></td>`;
  body.prepend(summary);
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
    ["Photo", agent.photo], ["Aadhaar Document", agent.aadhaarDoc], ["Bank Document", agent.bankDoc],
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
      <div class="id-header">
        <div class="id-brand">BB</div>
        <div><h4>বিবাহ বন্ধন 2026</h4><small>Authorized Field Agent</small></div>
      </div>
      <div class="id-body">
        ${photo ? `<img class="id-photo" src="${escapeAttr(photo)}" alt="">` : `<div class="id-photo avatar">${initials(agent.name)}</div>`}
        <h4>${escapeHtml(agent.name || "")}</h4>
        <p class="id-number">${escapeHtml(agent.id || "")}</p>
        <div class="id-meta">
          <p><span>Level</span><strong>${escapeHtml(agent.level || "Standard")}</strong></p>
          <p><span>Phone</span><strong>${escapeHtml(agent.phone || "")}</strong></p>
          <p><span>Area</span><strong>${escapeHtml(agent.area || "")}</strong></p>
          <p><span>Reg. Comm.</span><strong>${escapeHtml(agent.regCommission || 30)}%</strong></p>
          <p><span>Marriage Comm.</span><strong>${escapeHtml(agent.marriageCommission || 25)}%</strong></p>
        </div>
        <div class="id-sign-row">
          <span>Agent Signature</span>
          <span>Office Seal</span>
        </div>
      </div>
    </div>`;
  openModal("agentIdCardModal");
}

function printAgentIdCard() {
  setActivePrintMode("agent-id-card");
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


async function submitCommonExpense(event) {
  event.preventDefault();
  if (!state.session || state.session.role !== "admin") return toast("Only admin can save common expenses");
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.token = state.session.token;
    const result = await api("saveCommonExpense", payload);
    if (!result.ok) throw new Error(result.error || "Expense save failed");
    toast("Common expense saved");
    form.reset();
    if (form.expenseDate) form.expenseDate.value = new Date().toISOString().slice(0, 10);
    await loadDashboardData();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Expense";
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


function cleanCommonExpenses(list) {
  return (Array.isArray(list) ? list : []).filter((expense) =>
    String(expense?.expenseId || "").trim() ||
    String(expense?.category || "").trim() ||
    String(expense?.amount || "").trim()
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
    payload.whatsapp = String(payload.whatsapp || "").replace(/\D/g, "");
    payload.pin = String(payload.pin || "").replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(payload.phone)) {
      throw new Error("সঠিক ১০ সংখ্যার ভারতীয় মোবাইল নম্বর দিন");
    }
    if (payload.whatsapp && !/^[6-9]\d{9}$/.test(payload.whatsapp)) {
      throw new Error("সঠিক ১০ সংখ্যার WhatsApp নম্বর দিন");
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
  if ($("#receiptModalTitle")) $("#receiptModalTitle").textContent = "Payment Receipt";
  if ($("#printReceiptBtn")) $("#printReceiptBtn").textContent = "Print / Save PDF";
  if ($("#receiptSize")) $("#receiptSize").value = "4x6";
  setActivePrintMode("receipt");
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
            <h3>বিবাহ বন্ধন</h3>
            <p>Marriage Bureau Office</p>
            <small>Registration No.: 1852</small>
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
  const mode = document.body.dataset.printMode === "agreement" ? "agreement" : "receipt";
  setActivePrintMode(mode);
  setReceiptPrintSize(mode === "agreement" ? "a4" : ($("#receiptSize")?.value || "4x6"));
  const previousTitle = document.title;
  if (activeReceiptTitle) document.title = activeReceiptTitle;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };
  window.addEventListener("afterprint", restoreTitle);
  window.print();
}

function setActivePrintMode(mode) {
  document.body.dataset.printMode = mode || "";
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
    ["ধর্ম", profile.religion], ["সম্প্রদায়", profile.community], ["মাতৃভাষা", profile.motherTongue],
    ["শিক্ষা", profile.education], ["নিজের পেশা", profile.occupation],
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
    ["নিজের সম্পর্কে", profile.about], ["মোবাইল", profile.phone], ["WhatsApp", profile.whatsapp], ["ইমেল", profile.email],
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
  const agreementScanUrl = profile.agreementScanUrl || profile.agreementScan || profile.agreementFile || profile.agreementFileUrl || "";
  const agreementPanel = isLoggedIn ? `
    <div class="detail-payment-panel">
      <div class="detail-payment-summary">
        <p><strong>₹${escapeHtml(profile.registrationFee || 0)}</strong><span>Registration Charge</span></p>
        <p><strong>₹${escapeHtml(profile.meetingFee || 1000)}</strong><span>Meeting Charge</span></p>
        <p><strong>₹${escapeHtml(profile.agreementAmount || profile.marriageFee || 0)}</strong><span>Marriage Service</span></p>
      </div>
      <div class="payment-mini-row">
        <strong>Agreement Scan</strong>
        ${agreementScanUrl ? `<a class="document-link" href="${escapeAttr(agreementScanUrl)}" target="_blank" rel="noopener">Open uploaded scan</a>` : `<span>No scan uploaded</span>`}
        <em>${escapeHtml(profile.agreementNote || "")}</em>
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
    ${agreementPanel}
    ${isLoggedIn ? `<div class="row-actions detail-actions"></div>` : ""}
    <div class="detail-list upgraded">${fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong>${formatDetailValue(value)}</p>`).join("")}</div>`;
  const detailActions = $(".detail-actions", $("#detailBody"));
  if (detailActions) {
    addAction(detailActions, "Edit", "btn-gold", () => openProfileForm(profile));
    addAction(detailActions, "Payment", "btn-green", () => openPaymentModal(profile));
    addAction(detailActions, "Requirement", "btn-blue", () => openProfileNoteModal(profile, "requirement"));
    addAction(detailActions, "Verify Note", "btn-gold", () => openProfileNoteModal(profile, "verification"));
    if (state.session.role === "admin") {
      addAction(detailActions, "Service Charge Agreement", "btn-gold", () => openServiceAgreementPrompt(profile));
    }
    if (state.session.role === "admin" && String(profile.marriageStatus || "").toLowerCase() !== "completed") {
      addAction(detailActions, "Marriage Complete", "btn-green", () => openMarriageModal(profile));
    }
    addAction(detailActions, "Print Agreement", "btn-blue", () => openAgreementPrint(profile));
    if (state.session.role === "admin") {
      addAction(detailActions, "Upload Agreement Scan", "btn-green", () => uploadAgreementScan(profile));
    }
  }
  openModal("detailModal");
}

function updateProfileInState(updatedProfile) {
  if (!updatedProfile?.id) return;
  const index = state.profiles.findIndex((profile) => String(profile.id || "") === String(updatedProfile.id || ""));
  if (index !== -1) state.profiles[index] = { ...state.profiles[index], ...updatedProfile };
}

function openServiceAgreementPrompt(profile) {
  if (!state.session || state.session.role !== "admin") return toast("Only admin can save service agreement");
  activeAgreementUploadProfile = profile;
  const form = $("#serviceAgreementForm");
  if (!form) return;
  form.reset();
  form.registrationFee.value = profile.registrationFee || "0";
  form.meetingFee.value = profile.meetingFee || "1000";
  form.agreementAmount.value = profile.agreementAmount || profile.marriageFee || "";
  form.agreementNote.value = profile.agreementNote || "";
  if ($("#serviceAgreementClient")) $("#serviceAgreementClient").textContent = `${profile.fullName || "Client"}${profile.id ? ` (${profile.id})` : ""}`;
  openModal("serviceAgreementModal");
}

async function submitServiceAgreement(event) {
  event.preventDefault();
  if (!state.session || state.session.role !== "admin") return toast("Only admin can save service agreement");
  const profile = activeAgreementUploadProfile;
  if (!profile?.id) return toast("Client profile not found");
  const form = event.target;
  const registrationFee = form.registrationFee.value;
  const meetingFee = form.meetingFee.value;
  const agreementAmount = form.agreementAmount.value;
  const note = form.agreementNote.value || "";
  const result = await api("saveServiceAgreement", {
    token: state.session.token,
    id: profile.id,
    registrationFee: Number(registrationFee || 0),
    meetingFee: Number(meetingFee || 0),
    agreementAmount: Number(agreementAmount || 0),
    marriageFee: Number(agreementAmount || 0),
    agreementNote: note,
  });
  if (!result.ok) return toast(result.error || "Agreement save failed");
  updateProfileInState(result.profile || { ...profile, registrationFee, meetingFee, agreementAmount, marriageFee: agreementAmount, agreementNote: note });
  activeAgreementUploadProfile = null;
  await loadDashboardData();
  closeModals();
  toast("Service agreement saved");
}

function uploadAgreementScan(profile) {
  if (!state.session || state.session.role !== "admin") return toast("Only admin can upload agreement scan");
  activeAgreementUploadProfile = profile;
  const form = $("#agreementUploadForm");
  if (!form) return;
  form.reset();
  if ($("#agreementUploadClient")) $("#agreementUploadClient").textContent = `${profile.fullName || "Client"}${profile.id ? ` (${profile.id})` : ""}`;
  openModal("agreementUploadModal");
}

async function submitAgreementScanUpload(event) {
  event.preventDefault();
  const form = event.target;
  const file = form.agreementScanFile?.files?.[0];
  const profile = activeAgreementUploadProfile;
  if (!file || !profile?.id) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    const result = await api("uploadAgreementScan", {
      token: state.session.token,
      id: profile.id,
      fileName: file.name || "agreement-scan",
      file: dataUrl,
    });
    if (!result.ok) throw new Error(result.error || "Agreement upload failed");
    updateProfileInState(result.profile || { ...profile, agreementScanUrl: result.url });
    activeAgreementUploadProfile = null;
    await loadDashboardData();
    closeModals();
    toast("Agreement scan uploaded");
  } catch (error) {
    toast(error.message);
  }
}

function openAgreementPrint(profile) {

  if (!profile?.id) {
    return toast("Client profile not found");
  }

  activeReceiptTitle =
    `${sanitizeFileName(profile.fullName || profile.id)} agreement`;

  const address = [
    profile.houseNo,
    profile.addressLine,
    profile.villageTown,
    profile.postOffice,
    profile.policeStation || profile.policestation,
    profile.district,
    profile.state,
    profile.pinCode || profile.pin
  ].filter(Boolean).join(", ");

  const partner = [
    profile.marriedWithName,
    profile.marriedWithProfileId
  ].filter(Boolean).join(" - ") || "প্রযোজ্য নয়";

  const agreementId =
    `AGR-${new Date().getFullYear()}-${String(profile.id).replace(/[^a-zA-Z0-9]/g, "")}`;

  /*
   * Service charge
   * এখানে আপনার আসল amount বসাবেন।
   * এখন profile-এর payment data না থাকলে 0 দেখাবে।
   */
  const registrationPaid =
    Number(profile.registrationPaid || profile.regPaid || 0);

  const meetingPaid =
    Number(profile.meetingPaid || profile.meetingFeePaid || 0);

  const marriagePaid =
    Number(profile.marriagePaid || profile.marriageFeePaid || 0);

  const registrationFee =
    Number(profile.registrationFee || 0);

  const meetingFee =
    Number(profile.meetingFee || 1000);

  const marriageFee =
    Number(profile.agreementAmount || profile.marriageFee || 0);

  const due = (total, paid) =>
    Math.max(Number(total || 0) - Number(paid || 0), 0);

  const money = (value) =>
    `₹${Number(value || 0).toLocaleString("en-IN")}`;

  $("#receiptBody").innerHTML = `

    <div
      class="receipt-paper receipt-a4 agreement-paper"
      id="receiptPrintArea"
    >

      <!-- =========================
           PAGE 1 : CLIENT DETAILS
      ========================== -->

      <div class="agreement-header">

        <div class="agreement-logo-wrap">
          <img
            src="bibah-bandhan-logo.png"
            class="agreement-main-logo"
            alt="বিবাহ বন্ধন"
          >
        </div>

        <div class="agreement-header-text">
          <h1>বিবাহ বন্ধন</h1>
          <p>Marriage Bureau Office</p>
          <small>Registration No.: 1852</small>
        </div>

        <div class="agreement-id-box">
          <span>PROFILE ID</span>
          <strong>${escapeHtml(profile.id)}</strong>

          <span>AGREEMENT ID</span>
          <strong>${escapeHtml(agreementId)}</strong>
        </div>

      </div>


      <div class="agreement-title-box">
        <h2>CLIENT REGISTRATION DETAILS</h2>
        <p>
          এই নথিটি ক্লায়েন্টের Offline Record ও Service Agreement-এর
          অংশ হিসেবে সংরক্ষণ করা হবে।
        </p>
      </div>


      <div class="agreement-client-layout">

        <div class="agreement-client-photo">

          ${
            profile.photoUrl || profile.photo
              ? `
                <img
                  src="${escapeHtml(profile.photoUrl || profile.photo)}"
                  alt="Client Photo"
                >
              `
              : `
                <div class="photo-placeholder">
                  CLIENT<br>PHOTO
                </div>
              `
          }

        </div>


        <div class="agreement-client-details">

  <!-- =========================
       BASIC INFORMATION
  ========================== -->

  <div class="agreement-field">
    <span>Client Name / ক্লায়েন্টের নাম</span>
    <strong>
      ${escapeHtml(profile.fullName || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Gender / লিঙ্গ</span>
    <strong>
      ${escapeHtml(profile.gender || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Date of Birth / জন্ম তারিখ</span>
    <strong>
      ${escapeHtml(formatDate(profile.dob) || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Age / বয়স</span>
    <strong>
      ${escapeHtml(
        profile.age ? `${profile.age} Years` : "N/A"
      )}
    </strong>
  </div>


  <!-- =========================
       FAMILY INFORMATION
  ========================== -->

  <div class="agreement-field">
    <span>Father's Name / পিতার নাম</span>
    <strong>
      ${escapeHtml(profile.fatherName || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Mother's Name / মাতার নাম</span>
    <strong>
      ${escapeHtml(profile.motherName || "N/A")}
    </strong>
  </div>


  <!-- =========================
       MARITAL & SOCIAL DETAILS
  ========================== -->

  <div class="agreement-field">
    <span>Marital Status / বৈবাহিক অবস্থা</span>
    <strong>
      ${escapeHtml(profile.maritalStatus || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>First Marriage / প্রথম বিবাহ</span>
    <strong>
      ${escapeHtml(profile.firstMarriage || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Religion / ধর্ম</span>
    <strong>
      ${escapeHtml(profile.religion || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Community / সম্প্রদায়</span>
    <strong>
      ${escapeHtml(profile.community || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Caste / জাতি</span>
    <strong>
      ${escapeHtml(profile.caste || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Mother Tongue / মাতৃভাষা</span>
    <strong>
      ${escapeHtml(profile.motherTongue || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Gotra / গোত্র</span>
    <strong>
      ${escapeHtml(profile.gotra || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Rashi / রাশি</span>
    <strong>
      ${escapeHtml(profile.rashi || "N/A")}
    </strong>
  </div>


  <!-- =========================
       EDUCATION & PROFESSION
  ========================== -->

  <div class="agreement-field">
    <span>Education / শিক্ষাগত যোগ্যতা</span>
    <strong>
      ${escapeHtml(profile.education || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Occupation / পেশা</span>
    <strong>
      ${escapeHtml(profile.occupation || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Monthly Income / মাসিক আয়</span>
    <strong>
      ${escapeHtml(profile.monthlyIncome || "N/A")}
    </strong>
  </div>


  <!-- =========================
       CONTACT INFORMATION
  ========================== -->

  <div class="agreement-field">
    <span>Mobile / মোবাইল</span>
    <strong>
      ${escapeHtml(profile.phone || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Email / ই-মেইল</span>
    <strong>
      ${escapeHtml(profile.email || "N/A")}
    </strong>
  </div>


  <!-- =========================
       ADDRESS
  ========================== -->

  <div class="agreement-field full">
    <span>House / Road / বাড়ি ও রাস্তা</span>
    <strong>
      ${escapeHtml(profile.addressLine || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Village / Town / গ্রাম / শহর</span>
    <strong>
      ${escapeHtml(profile.villageTown || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Post Office / ডাকঘর</span>
    <strong>
      ${escapeHtml(profile.postOffice || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Police Station / থানা</span>
    <strong>
      ${escapeHtml(profile.policestation || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>District / জেলা</span>
    <strong>
      ${escapeHtml(profile.district || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>State / রাজ্য</span>
    <strong>
      ${escapeHtml(profile.state || "N/A")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>PIN Code / পিন কোড</span>
    <strong>
      ${escapeHtml(profile.pin || "N/A")}
    </strong>
  </div>


  <!-- =========================
       OFFICE RECORD
  ========================== -->

  <div class="agreement-field">
    <span>Agent ID / এজেন্ট আইডি</span>
    <strong>
      ${escapeHtml(profile.agentId || "Public")}
    </strong>
  </div>

  <div class="agreement-field">
    <span>Registration Date / নিবন্ধনের তারিখ</span>
    <strong>
      ${escapeHtml(
        formatDate(profile.registrationDate) ||
        formatDate(profile.createdAt) ||
        new Date().toLocaleDateString("en-IN")
      )}
    </strong>
  </div>

</div>

</div>


      <div class="agreement-section">

        <h3>ক্লায়েন্টের ঘোষণা</h3>

        <p>
          আমি ঘোষণা করছি যে, এই Agreement-এ প্রদত্ত আমার ব্যক্তিগত
          ও যোগাযোগ সংক্রান্ত তথ্য আমার জানা অনুযায়ী সঠিক।
          কোনো তথ্য ভুল, অসম্পূর্ণ বা বিভ্রান্তিকর হলে তার দায়ভার
          আমার নিজস্ব।
        </p>

      </div>


      <div class="agreement-watermark">
        <img src="bfi.png" alt="">
      </div>


      <!-- PAGE BREAK -->

      <div class="agreement-page-break"></div>


      <!-- =========================
           PAGE 2 : TERMS & CHARGES
      ========================== -->

      <div class="agreement-page-header">

        <img
          src="bibah-bandhan-logo.png"
          alt="বিবাহ বন্ধন"
        >

        <div>
          <strong>বিবাহ বন্ধন</strong>
          <span>Marriage Service Agreement</span>
        </div>

        <div>
          <span>Profile ID</span>
          <strong>${escapeHtml(profile.id)}</strong>
        </div>

      </div>


      <div class="agreement-title-box centered">
        <h2>ম্যারেজ / সার্ভিস এগ্রিমেন্ট</h2>
        <p>
          Terms, Conditions & Service Charges
        </p>
      </div>


      <!-- =========================
     TERMS & CONDITIONS
========================== -->

<div class="agreement-section">

  <h3>শর্ত ও নিয়মাবলী</h3>

  <ol class="agreement-terms">

    <li>
      <strong>বিবাহ বন্ধন</strong> একটি Marriage Bureau / Matrimonial
      Service, যার মূল উদ্দেশ্য উপযুক্ত পাত্র-পাত্রীর পরিচয় করিয়ে
      দেওয়া। বিবাহ বা সম্পর্ক সম্পন্ন হওয়ার কোনো নিশ্চয়তা
      বিবাহ বন্ধন প্রদান করে না।
    </li>

    <li>
      Client বা তার পরিবারের দেওয়া তথ্য সত্য, সঠিক ও হালনাগাদ
      রাখা এবং প্রয়োজনীয় তথ্য যাচাই করা Client/Guardian-এর
      দায়িত্ব।
    </li>

    <li>
      কোনো পাত্র-পাত্রীর সঙ্গে যোগাযোগ, সাক্ষাৎ বা বিবাহের
      সিদ্ধান্ত নেওয়ার আগে Client নিজ দায়িত্বে পরিচয়পত্র,
      পারিবারিক তথ্য, ঠিকানা, পেশা, আয় এবং অন্যান্য গুরুত্বপূর্ণ
      তথ্য যাচাই করবেন।
    </li>

    <li>
      কোনো Client-এর দেওয়া ভুল তথ্য, ভুয়া পরিচয়, প্রতারণামূলক
      আচরণ বা গুরুত্বপূর্ণ তথ্য গোপন করার ঘটনা পাওয়া গেলে
      বিবাহ বন্ধন প্রয়োজন অনুযায়ী সেবা সীমিত, স্থগিত বা বাতিল
      করার অধিকার রাখে।
    </li>

    <li>
      অন্য Client বা কোনো পাত্র-পাত্রীর ব্যক্তিগত তথ্য, ছবি,
      ফোন নম্বর, ঠিকানা বা অন্যান্য তথ্য তার অনুমতি ছাড়া
      প্রকাশ, শেয়ার বা অপব্যবহার করা যাবে না।
    </li>

  </ol>

</div>


<!-- =========================
     পরিচয় ও পরিষেবা চার্জ
========================== -->

<div class="agreement-section agreement-fee-notice">

  <h3>পরিচয় ও পরিষেবা চার্জ সংক্রান্ত গুরুত্বপূর্ণ ঘোষণা</h3>

  <div class="agreement-highlight">

    <p>
      <strong>১. পরিচয়ের ভিত্তিতে পরিষেবা চার্জ:</strong><br>
      বিবাহ বন্ধনের মাধ্যমে কোনো পাত্র-পাত্রীর পরিচয় হওয়ার পর,
      উভয় পক্ষ পরবর্তীতে বিবাহ বা বৈবাহিক সম্পর্ক স্থাপন করলে,
      তা সরাসরি, পরিবারের মাধ্যমে অথবা অন্য কোনো উপায়ে হোক না কেন,
      বিবাহ বন্ধনের নির্ধারিত পরিষেবা চার্জ/পারিশ্রমিক প্রযোজ্য হবে।
    </p>

    <p>
      <strong>২. সরাসরি যোগাযোগ হলেও:</strong><br>
      বিবাহ বন্ধনের মাধ্যমে পরিচয় হওয়ার পর Client ও অপর পক্ষ
      নিজেদের মধ্যে সরাসরি Phone, WhatsApp, Social Media, পরিবার
      অথবা অন্য কোনো মাধ্যমে যোগাযোগ স্থাপন করলেও, পরবর্তীতে
      উক্ত পরিচয়ের সূত্রে বিবাহ সম্পন্ন হলে নির্ধারিত
      Marriage Service Charge প্রযোজ্য থাকবে।
    </p>

    <p>
      <strong>৩. বিবাহের তথ্য জানানোর দায়িত্ব:</strong><br>
      বিবাহ বন্ধনের মাধ্যমে পরিচয়প্রাপ্ত কোনো পাত্র-পাত্রীর সঙ্গে
      পরবর্তীতে বিবাহ সম্পন্ন হলে, বিবাহের বিষয়টি বিবাহ বন্ধন
      অফিসকে জানানো এবং প্রযোজ্য পরিষেবা চার্জ পরিশোধ করা
      Client-এর দায়িত্ব।
    </p>

    <p>
      <strong>৪. পরিচয় গোপন করে পারিশ্রমিক এড়ানো:</strong><br>
      কোনো Client যদি বিবাহ বন্ধনের মাধ্যমে পরিচয় হওয়া
      পক্ষের সঙ্গে বিবাহ সম্পন্ন করেন কিন্তু ইচ্ছাকৃতভাবে
      প্রতিষ্ঠানকে না জানিয়ে বা নির্ধারিত পারিশ্রমিক প্রদান
      এড়িয়ে যান, তবে বিবাহ বন্ধন তার প্রাপ্য পরিষেবা ফি
      আদায়ের জন্য প্রচলিত আইন অনুযায়ী প্রয়োজনীয় ব্যবস্থা
      গ্রহণের অধিকার সংরক্ষণ করে।
    </p>

    <p>
      <strong>৫. অফিসিয়াল রেকর্ড:</strong><br>
      কোনো পরিচয়, Profile ID, Meeting Record, অফিস রসিদ
      এবং অন্যান্য অফিসিয়াল রেকর্ড বিবাহ বন্ধন সংরক্ষণ করতে পারে।
      ভবিষ্যতে উক্ত পরিচয়ের সূত্রে বিবাহ সম্পন্ন হয়েছে কিনা
      নির্ধারণের ক্ষেত্রে এসব রেকর্ড প্রাসঙ্গিক নথি হিসেবে
      বিবেচিত হতে পারে।
    </p>

    <p>
      <strong>৬. সম্পূর্ণ ভিন্ন ব্যক্তির সঙ্গে বিবাহ:</strong><br>
      যদি কোনো Client বিবাহ বন্ধনের মাধ্যমে পরিচয়প্রাপ্ত ব্যক্তি
      ছাড়া সম্পূর্ণ ভিন্ন কোনো ব্যক্তি বা পরিবারের সঙ্গে
      স্বাধীনভাবে বিবাহ সম্পন্ন করেন, সেক্ষেত্রে বিবাহ বন্ধন
      কোনো Marriage Service Charge বা অতিরিক্ত দাবি করবে না।
    </p>

    <p>
      <strong>৭. Client-এর সম্মতি:</strong><br>
      এই Agreement-এ স্বাক্ষর করার মাধ্যমে Client ঘোষণা করছেন যে,
      উপরোক্ত শর্তাবলি তিনি পড়েছেন, বুঝেছেন এবং স্বেচ্ছায়
      এতে সম্মতি প্রদান করেছেন।
    </p>

  </div>

</div>


<!-- =========================
     SERVICE CHARGES
========================== -->

<div class="agreement-section">

  <h3>পরিষেবা চার্জ</h3>

  <p class="agreement-note">
    Service Charge-এর পরিমাণ Client-এর নির্বাচিত Service Plan
    এবং প্রযোজ্য Office Rate অনুযায়ী নির্ধারিত হবে।
    প্রতিটি Payment-এর জন্য অবশ্যই অফিস রসিদ সংগ্রহ করুন।
  </p>

  <table class="service-charge-table">

    <thead>
      <tr>
        <th>ধাপ</th>
        <th>পরিষেবা</th>
        <th>নির্ধারিত চার্জ</th>
      </tr>
    </thead>

    <tbody>

      <tr>
        <td>১</td>
        <td>Registration</td>
        <td>${money(registrationFee)}</td>
      </tr>

      <tr>
        <td>২</td>
        <td>Meeting / Introduction</td>
        <td>${money(meetingFee)}</td>
      </tr>

      <tr>
        <td>৩</td>
        <td>Marriage Service</td>
        <td>${money(marriageFee)}</td>
      </tr>

    </tbody>

  </table>

</div>


      <div class="agreement-important-note">

        <strong>গুরুত্বপূর্ণ:</strong>

        Service Charge-এর পরিমাণ Client-এর নির্বাচিত
        service plan / applicable office rate অনুযায়ী হবে।
        Payment করার সময় অবশ্যই অফিসের রসিদ সংগ্রহ করুন।

      </div>


      <!-- PAGE BREAK -->

      <div class="agreement-page-break"></div>


      <!-- =========================
           PAGE 3 : DECLARATION
      ========================== -->

      <div class="agreement-page-header">

        <img
          src="bibah-bandhan-logo.png"
          alt="বিবাহ বন্ধন"
        >

        <div>
          <strong>বিবাহ বন্ধন</strong>
          <span>Client Declaration & Signature</span>
        </div>

        <div>
          <span>Agreement ID</span>
          <strong>${escapeHtml(agreementId)}</strong>
        </div>

      </div>


      <div class="agreement-title-box centered">
        <h2>CLIENT DECLARATION</h2>
      </div>


      <div class="declaration-box">

        <ol class="declaration-list">
          <li>
            আমি ${escapeHtml(profile.fullName || "________________")}
            ঘোষণা করছি যে, আমি এই Agreement-এর সমস্ত তথ্য,
            শর্তাবলী এবং Service Charge সম্পর্কে অবগত হয়েছি।
          </li>
          <li>
            আমি স্বেচ্ছায় এই Agreement গ্রহণ করছি এবং আমার
            দেওয়া তথ্য সঠিক বলে নিশ্চিত করছি।
          </li>
          <li>
            ভবিষ্যতে কোনো পরিচয়, সম্পর্ক, আর্থিক লেনদেন বা
            বিবাহ সংক্রান্ত সিদ্ধান্ত নেওয়ার আগে আমি নিজ দায়িত্বে
            প্রয়োজনীয় যাচাই করব।
          </li>
        </ol>

      </div>


      <div class="agreement-record-box">

        <div>
          <span>Profile ID</span>
          <strong>${escapeHtml(profile.id)}</strong>
        </div>

        <div>
          <span>Agreement ID</span>
          <strong>${escapeHtml(agreementId)}</strong>
        </div>

        <div>
          <span>Date</span>
          <strong>${new Date().toLocaleDateString("en-IN")}</strong>
        </div>

      </div>


      <div class="signature-grid">

        <div class="signature-box">
          <div class="signature-line"></div>
          <strong>Client Signature</strong>
          <span>${escapeHtml(profile.fullName || "")}</span>
        </div>

        <div class="signature-box">
          <div class="signature-line"></div>
          <strong>Guardian Signature</strong>
          <span>Name & Signature</span>
        </div>

        <div class="signature-box">
          <div class="signature-line"></div>
          <strong>Agent / Representative</strong>
          <span>${escapeHtml(profile.agentId || "Public")}</span>
        </div>

        <div class="signature-box office-signature">
          <div class="seal-space">
            OFFICE<br>SEAL
          </div>
          <strong>Office Signature & Seal</strong>
          <span>বিবাহ বন্ধন</span>
        </div>

      </div>


      <div class="scan-box-new">

  <strong>OFFICE RECORD</strong>

  <span>
    Profile / Document Reference:
    ${escapeHtml(profile.id || "N/A")}
  </span>

  <div class="scan-line"></div>

</div>


      <div class="agreement-footer">

        <div>
          <strong>বিবাহ বন্ধন</strong>
          <span>Marriage Bureau & Matrimonial Service</span>
        </div>

        <div>
          Profile ID:
          <strong>${escapeHtml(profile.id)}</strong>
        </div>

        <div>
          Agreement ID:
          <strong>${escapeHtml(agreementId)}</strong>
        </div>

      </div>

    </div>
  `;

  $("#receiptSize").value = "a4";

  setReceiptPrintSize("a4");

  setActivePrintMode("agreement");

  closeModals();

  openModal("receiptModal");
  setActivePrintMode("agreement");
  if ($("#receiptModalTitle")) $("#receiptModalTitle").textContent = "Service Agreement";
  if ($("#printReceiptBtn")) $("#printReceiptBtn").textContent = "Print / Save Agreement PDF";
  if ($("#receiptSize")) $("#receiptSize").value = "a4";
}
function formatDetailValue(value) {
  if (!value) return "N/A";
  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    return `<a class="document-link" href="${escapeAttr(text)}" target="_blank" rel="noopener">Open link</a>`;
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

function applyUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;

  const quickForm = document.getElementById("quickSearch");
  const sideForm = document.getElementById("sideFilters");
  if (!quickForm) return;

  ["gender", "ageMin", "ageMax", "city"].forEach((key) => {
    const value = params.get(key);
    if (!value) return;

    const quickField = quickForm.querySelector(`[name="${key}"]`);
    const sideField = sideForm?.querySelector(`[name="${key}"]`);

    if (quickField) quickField.value = value;
    if (sideField) sideField.value = value;
  });

  applyFilters(new FormData(quickForm));
  document.getElementById("profiles")?.scrollIntoView({ behavior: "smooth" });
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









