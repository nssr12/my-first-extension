let currentHost = "";
let mappings = []; // [{from,to}]
let captureTarget = null; // "from" | "to"

const $ = (id) => document.getElementById(id);

function normalizeComboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let k = e.key;
  if (k === " ") k = "Space";
  if (k === "Escape") k = "Esc";
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return null;

  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join("+");
}

function normalizeMouseFromEvent(e) {
  const map = ["Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5"];
  return map[e.button] || `Mouse${e.button + 1}`;
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";

  const c = $("count");
  if (c) c.textContent = String(mappings.length);

  mappings.forEach((m, idx) => {
    const fromVal = (m.from || "").replaceAll('"', "&quot;");
    const toVal = (m.to || "").replaceAll('"', "&quot;");

    const div = document.createElement("div");
    div.className = "rule";
    div.innerHTML = `
      <input value="${fromVal}" data-i="${idx}" data-k="from" type="text">
      <input value="${toVal}" data-i="${idx}" data-k="to" type="text">
      <button class="btnDanger delBtn" title="حذف" type="button" data-del="${idx}">🗑️</button>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.del);
      mappings.splice(i, 1);
      renderList();
      await saveGlobalData();
    });
  });

  list.querySelectorAll("input[data-i]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      mappings[i][k] = inp.value.trim();
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function normalizeHost(host) {
  return (host || "").replace(/^www\./i, "").replace(/^m\./i, "");
}

function baseDomain(host) {
  const h = normalizeHost(host);
  const parts = h.split(".");
  return parts.length <= 2 ? h : parts.slice(-2).join(".");
}

function hostFromUrl(url) {
  try {
    return baseDomain(new URL(url).host);
  } catch {
    return "";
  }
}

async function loadGlobalData() {
  const data = await chrome.storage.sync.get({
    globalSiteRules: { enabled: false, mappings: [] }
  });
  const rules = data.globalSiteRules || { enabled: false, mappings: [] };
  $("enabled").checked = !!rules.enabled;
  mappings = Array.isArray(rules.mappings) ? rules.mappings : [];
  renderList();
}

async function saveGlobalData() {
  const cleaned = [];
  const seen = new Set();

  for (const m of mappings || []) {
    const from = (m.from || "").trim();
    const to = (m.to || "").trim();
    if (!from || !to) continue;
    const key = from + "->" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ from, to });
  }

  const globalSiteRules = {
    enabled: $("enabled").checked,
    mappings: cleaned
  };

  await chrome.storage.sync.set({ globalSiteRules });

  mappings = cleaned;
  renderList();

  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SITE_RULES_UPDATED",
      siteRules: globalSiteRules
    }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: "RELOAD_SITE_RULES" }).catch(() => {});
  }
}

async function loadBlockedSiteUI() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  const blockedHosts = Array.isArray(settings.blockedHosts) ? settings.blockedHosts : [];
  const blockCurrentSite = $("blockCurrentSite");
  if (blockCurrentSite) blockCurrentSite.checked = !!currentHost && blockedHosts.includes(currentHost);
}

async function saveBlockedSiteState() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  const blockedHosts = new Set(Array.isArray(settings.blockedHosts) ? settings.blockedHosts : []);
  const shouldBlock = !!$("blockCurrentSite")?.checked;

  if (!currentHost) return;

  if (shouldBlock) blockedHosts.add(currentHost);
  else blockedHosts.delete(currentHost);

  settings.blockedHosts = Array.from(blockedHosts).sort();
  await chrome.storage.sync.set({ settings });

  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "GVZ_RELOAD" }).catch(() => {});
}

async function loadOverlayUI() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const s = data.settings || {};
  const overlay = s.overlay || { enabled: true, autoHideMs: 900 };
  const dur = $("overlayDuration");
  const value = $("overlayDurationValue");
  const ms = overlay.enabled === false ? 0 : Number(overlay.autoHideMs ?? 900);

  if (dur) dur.value = String(ms);
  if (value) value.textContent = formatOverlayDuration(ms);
}

async function saveOverlayUI() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  const dur = $("overlayDuration");
  const ms = dur ? Number(dur.value) : 900;

  settings.overlay = {
    enabled: ms > 0,
    autoHideMs: ms
  };

  await chrome.storage.sync.set({ settings });

  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "RELOAD_OVERLAY_SETTINGS" }).catch(() => {});
}

function formatOverlayDuration(ms) {
  if (ms <= 0) return "معطل";
  return `${(ms / 1000).toFixed(1)} ثانية`;
}

function beginCapture(targetId) {
  captureTarget = targetId;
  const el = $(targetId);
  el.value = "… اضغط اختصار الآن …";
  el.focus();
}

document.addEventListener("keydown", (e) => {
  if (!captureTarget) return;
  e.preventDefault();
  e.stopPropagation();

  const combo = normalizeComboFromEvent(e);
  if (!combo) return;

  $(captureTarget).value = combo;
  captureTarget = null;
}, true);

document.addEventListener("mousedown", (e) => {
  if (!captureTarget) return;
  e.preventDefault();
  e.stopPropagation();

  const combo = normalizeMouseFromEvent(e);
  $(captureTarget).value = combo;
  captureTarget = null;
}, true);

(async () => {
  const tab = await getActiveTab();
  currentHost = hostFromUrl(tab?.url || "");
  $("siteLabel").textContent = currentHost
    ? `الموقع الحالي: ${currentHost}`
    : "يعمل على جميع المواقع التي تحتوي على فيديو";

  await loadGlobalData();
  await loadOverlayUI();
  await loadBlockedSiteUI();

  const od = $("overlayDuration");
  const odValue = $("overlayDurationValue");

  if (od) {
    od.addEventListener("input", () => {
      if (odValue) odValue.textContent = formatOverlayDuration(Number(od.value));
    });
    od.addEventListener("change", saveOverlayUI);
  }

  $("enabled").addEventListener("change", saveGlobalData);
  $("blockCurrentSite").addEventListener("change", saveBlockedSiteState);

  $("capFrom").addEventListener("click", () => beginCapture("from"));
  $("capTo").addEventListener("click", () => beginCapture("to"));

  $("add").addEventListener("click", () => {
    const from = $("from").value.trim();
    const to = $("to").value.trim();
    if (!from || !to) return;

    const i = mappings.findIndex((x) => (x.from || "").trim() === from);
    if (i >= 0) {
      mappings[i] = { from, to };
    } else {
      mappings.push({ from, to });
    }

    $("from").value = "";
    $("to").value = "";
    renderList();
  });

  $("save").addEventListener("click", async () => {
    await saveGlobalData();
    $("save").textContent = "تم الحفظ ✅";
    setTimeout(() => {
      $("save").textContent = "حفظ الإعدادات";
    }, 800);
  });
})();

const optBtn = $("openOptions");
if (optBtn) {
  optBtn.addEventListener("click", async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  });
}
