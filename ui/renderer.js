const API_BASE = "http://127.0.0.1:3001";

// ── Debug helper ──
function dbg(label, data) {
  if (window.location.search.includes("debug")) {
    console.log(`[Renderer] ${label}:`, data);
  }
}

// ── State ──
let session = null;
let printerList = [];
let canManagePrinters = false;
let canCalibratePrint = false;
let statusUpdateTimer = null;
let pendingStatusUpdate = null;

// ── DOM refs ──
const views = {
  login: document.getElementById("view-login"),
  dashboard: document.getElementById("view-dashboard"),
};

// ── API helper ──
async function api(method, endpoint, body) {
  const url = `${API_BASE}${endpoint}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function showView(name) {
  Object.values(views).forEach((el) => el.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

function toast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);

  const timer = setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 4000);
  el._toastTimer = timer;
}

function clearToasts() {
  const container = document.getElementById("toast-container");
  if (!container) return;
  container.querySelectorAll(".toast").forEach((el) => {
    if (el._toastTimer) clearTimeout(el._toastTimer);
    el.remove();
  });
}

function setLoading(btn, loading) {
  const txt = btn.querySelector(".btn-text");
  const spin = btn.querySelector(".spinner");
  if (txt) txt.classList.toggle("hidden", loading);
  if (spin) spin.classList.toggle("hidden", !loading);
  btn.disabled = loading;
}

// ── Login ──
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-login");
    const errEl = document.getElementById("login-error");
    setLoading(btn, true);
    errEl.classList.add("hidden");

    try {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const data = await api("POST", "/auth/login", { email, password });
      session = data.session;
      dbg("Login success", session);
      toast(`Welcome, ${session.email}`, "success");
      enterDashboard();
    } catch (err) {
      dbg("Login error", err.message);
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      setLoading(btn, false);
    }
  });
}

// ── Dashboard ──
async function enterDashboard() {
  showView("dashboard");
  await loadSession();
  await loadPrinters();
  await loadPrintSettings();
  await loadQueue();
  await loadCloudStatus();
  await loadLogs();
  if (window.electronAPI) {
    try {
      const v = await window.electronAPI.getVersion();
      const el = document.getElementById("app-version");
      if (el) el.textContent = `v${v}`;
    } catch (err) {
      dbg("Version error", err.message);
    }
  }
}

async function loadSession() {
  try {
    const data = await api("GET", "/auth/session");
    dbg("Session", data);
    if (!data.loggedIn) {
      showView("login");
      return;
    }
    session = data.session;
    canManagePrinters = ["Manager", "Developer"].includes(session.role);
    canCalibratePrint = session.role === "Developer";
    const roleBadge = document.getElementById("role-badge");
    if (roleBadge) roleBadge.textContent = session.role || "Staff";
    if (!canManagePrinters) {
      const saveBtn = document.getElementById("btn-save-printers");
      if (saveBtn) saveBtn.style.display = "none";
      document
        .querySelectorAll(".select-group select")
        .forEach((s) => (s.disabled = true));
    }
  } catch (err) {
    dbg("Session error", err.message);
    showView("login");
  }
}

async function loadPrinters() {
  try {
    const data = await api("GET", "/printers");
    dbg("Printers data", data);

    printerList = data.availablePrinters || [];
    canManagePrinters = !!data.canManagePrinters;

    ["receipt", "dispatch", "label"].forEach((type) => {
      const sel = document.getElementById(`sel-${type}`);
      const currentVal = document.getElementById(`printer-${type}`);
      if (!sel) return;

      const current = data.assigned?.[type] || "";
      sel.innerHTML = '<option value="">— Select —</option>';
      printerList.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        if (p === current) opt.selected = true;
        sel.appendChild(opt);
      });

      if (currentVal) currentVal.textContent = current || "Not set";
    });

    dbg("Printers loaded", { count: printerList.length });
  } catch (err) {
    dbg("Printers error", err.message);
    toast("Failed to load printers: " + err.message, "error");
  }
}

async function savePrinters() {
  const btn = document.getElementById("btn-save-printers");
  const msg = document.getElementById("printer-msg");
  if (btn) btn.disabled = true;

  try {
    const payload = {
      receipt: document.getElementById("sel-receipt")?.value || null,
      dispatch: document.getElementById("sel-dispatch")?.value || null,
      label: document.getElementById("sel-label")?.value || null,
    };
    dbg("Saving printers", payload);
    await api("POST", "/printers", payload);
    if (msg) {
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 2000);
    }
    await loadPrinters();
  } catch (err) {
    dbg("Save printers error", err.message);
    toast(err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

const savePrintersBtn = document.getElementById("btn-save-printers");
if (savePrintersBtn) savePrintersBtn.addEventListener("click", savePrinters);

async function loadQueue() {
  try {
    const data = await api("GET", "/health");
    dbg("Health/Queue", data);
    const q = data.queue || { pending: 0, failed: 0, dead: 0 };
    const pendingEl = document.getElementById("queue-pending");
    const failedEl = document.getElementById("queue-failed");
    const deadEl = document.getElementById("queue-dead");
    if (pendingEl) pendingEl.textContent = q.pending || 0;
    if (failedEl) failedEl.textContent = `${q.failed || 0} failed`;
    if (deadEl) deadEl.textContent = `${q.dead || 0} dead`;
  } catch (err) {
    dbg("Queue error", err.message);
  }
}

function renderCloudStatus(status) {
  const pill = document.getElementById("cloud-pill");
  const stEl = document.getElementById("cloud-status");
  const detEl = document.getElementById("cloud-detail");
  if (!pill || !stEl || !detEl) return;

  if (status.localMode) {
    pill.className = "pill pill-online";
    pill.textContent = "Local";
    stEl.textContent = "Local Mode";
    stEl.style.color = "var(--success)";
    detEl.textContent = status.message || "No cloud backend configured";
    return;
  }

  if (status.online) {
    pill.className = "pill pill-online";
    pill.textContent = "Online";
    stEl.textContent = "Connected";
    stEl.style.color = "var(--success)";
    detEl.textContent = status.lastHeartbeatAt
      ? `Last ping ${new Date(status.lastHeartbeatAt).toLocaleTimeString()}`
      : "Active";
  } else {
    pill.className = "pill pill-offline";
    pill.textContent = "Offline";
    stEl.textContent = "Disconnected";
    stEl.style.color = "var(--danger)";
    detEl.textContent = status.lastError || "Waiting…";
  }
}

// Debounced status renderer to prevent DOM thrashing on IPC flood
function debouncedRenderCloudStatus(status) {
  pendingStatusUpdate = status;
  if (statusUpdateTimer) clearTimeout(statusUpdateTimer);
  statusUpdateTimer = setTimeout(() => {
    if (pendingStatusUpdate) {
      renderCloudStatus(pendingStatusUpdate);
      pendingStatusUpdate = null;
    }
  }, 250);
}

async function loadCloudStatus() {
  try {
    const data = await api("GET", "/cloud/status");
    dbg("Cloud status (HTTP)", data);
    renderCloudStatus(data.cloud || {});
  } catch (err) {
    dbg("Cloud status error", err.message);
    const pill = document.getElementById("cloud-pill");
    const stEl = document.getElementById("cloud-status");
    if (pill) pill.className = "pill pill-offline";
    if (stEl) stEl.textContent = "Error";
  }
}

async function loadLogs() {
  const logsOutput = document.getElementById("logs-output");
  if (logsOutput) {
    logsOutput.textContent =
      "Heartbeat active.\nQueue processor running.\nCheck DevTools Console (F12) for live debug logs.";
  }
}

const refreshLogsBtn = document.getElementById("btn-refresh-logs");
if (refreshLogsBtn) refreshLogsBtn.addEventListener("click", loadLogs);

// ── Logout ──
const logoutBtn = document.getElementById("btn-logout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await api("POST", "/auth/logout");
      session = null;
      showView("login");
      toast("Logged out", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ── Auto-update ──
if (window.electronAPI) {
  window.electronAPI.onUpdateAvailable(() => {
    const badge = document.getElementById("update-badge");
    if (badge) badge.classList.remove("hidden");
    toast("Update downloading…", "info");
  });
  window.electronAPI.onUpdateDownloaded(() => {
    const panel = document.getElementById("panel-update");
    if (panel) panel.classList.remove("hidden");
    toast("Update ready — restart to apply", "success");
  });
  window.electronAPI.onUpdateError((err) => {
    toast(`Update error: ${err}`, "error");
  });

  const checkUpdateBtn = document.getElementById("btn-check-update");
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", () => {
      window.electronAPI.checkForUpdates();
      toast("Checking for updates…", "info");
    });
  }

  const restartBtn = document.getElementById("btn-restart");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      window.electronAPI.restartApp();
    });
  }
}

// ── Cloud status pushed from main (IPC) ──
if (window.electronAPI) {
  window.electronAPI.onCloudStatus((status) => {
    dbg("Cloud status (IPC)", status);
    debouncedRenderCloudStatus(status);
  });
}

// ── Init ──
(async function init() {
  dbg("Renderer init", "Starting…");
  try {
    await loadSession();
    if (session) {
      enterDashboard();
    } else {
      showView("login");
    }
    if (window.electronAPI) {
      try {
        const v = await window.electronAPI.getVersion();
        const el = document.getElementById("app-version");
        if (el) el.textContent = `v${v}`;
      } catch (err) {
        dbg("Version error", err.message);
      }
    }
  } catch (err) {
    dbg("Init error", err.message);
    showView("login");
  }
})();
// ── 80mm print calibration ──
function getPrintForm() {
  return {
    paperWidthMm: Number(document.getElementById("print-paper-width")?.value || 80),
    printableWidthMm: Number(document.getElementById("print-content-width")?.value || 70),
    marginLeftMm: Number(document.getElementById("print-margin-left")?.value || 4),
    marginRightMm: Number(document.getElementById("print-margin-right")?.value || 6),
    fontScale: Number(document.getElementById("print-font-scale")?.value || 1),
    driverScale: document.getElementById("print-driver-scale")?.value || "fit",
  };
}

function setPrintForm(p = {}) {
  const values = {
    "print-paper-width": p.paperWidthMm ?? 80,
    "print-content-width": p.printableWidthMm ?? 70,
    "print-margin-left": p.marginLeftMm ?? 4,
    "print-margin-right": p.marginRightMm ?? 6,
    "print-font-scale": p.fontScale ?? 1,
    "print-driver-scale": p.driverScale ?? "fit",
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  updatePrintPreview();
}

function updatePrintPreview() {
  const p = getPrintForm();
  const paper = document.getElementById("paper-preview");
  const area = document.getElementById("printable-preview");
  if (!paper || !area || !p.paperWidthMm) return;
  const pxPerMm = 320 / p.paperWidthMm;
  area.style.width = `${Math.max(40, p.printableWidthMm * pxPerMm)}px`;
  area.style.marginLeft = `${Math.max(0, p.marginLeftMm * pxPerMm)}px`;
  area.style.fontSize = `${12 * p.fontScale}px`;
}

async function loadPrintSettings() {
  try {
    const data = await api("GET", "/settings/print");
    setPrintForm(data.print || {});
    canCalibratePrint = !!data.canCalibratePrint;
    const panel = document.getElementById("print-calibration");
    if (panel) panel.style.display = canCalibratePrint ? "block" : "none";
  } catch (err) { dbg("Print settings error", err.message); }
}

async function savePrintSettings() {
  try {
    const p = getPrintForm();
    if (p.marginLeftMm + p.printableWidthMm + p.marginRightMm > p.paperWidthMm + 0.01) {
      throw new Error("Left margin + printable width + right margin must fit inside paper width.");
    }
    await api("POST", "/settings/print", p);
    toast("80mm print calibration saved", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function testPrint() {
  try {
    await savePrintSettings();
    const printer = document.getElementById("sel-receipt")?.value || null;
    await api("POST", "/print/test", { printer });
    toast("Test receipt sent. Check both paper edges.", "success");
  } catch (err) { toast(err.message, "error"); }
}

document.querySelectorAll("#print-calibration input, #print-calibration select").forEach((el) => el.addEventListener("input", updatePrintPreview));
document.getElementById("btn-save-print")?.addEventListener("click", savePrintSettings);
document.getElementById("btn-test-print")?.addEventListener("click", testPrint);
document.getElementById("btn-reset-print")?.addEventListener("click", () => setPrintForm({ paperWidthMm:80, printableWidthMm:70, marginLeftMm:4, marginRightMm:6, fontScale:1, driverScale:"fit" }));
