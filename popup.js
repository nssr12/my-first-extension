let currentHost = "";
let mappings = []; // [{from,to}]
let captureTarget = null; // "from" | "to"

const $ = (id) => document.getElementById(id);

const ACTIONS = [
  { label: "ACTION:TOGGLE_PLAY = تبديل تشغيل/إيقاف", value: "ACTION:TOGGLE_PLAY" },
  { label: "ACTION:TOGGLE_FULLSCREEN = تبديل ملء الشاشة", value: "ACTION:TOGGLE_FULLSCREEN" },
  { label: "ACTION:TOGGLE_MUTE = كتم/إلغاء الكتم", value: "ACTION:TOGGLE_MUTE" },
  { label: "ACTION:VOLUME:+4 = رفع الصوت 4%", value: "ACTION:VOLUME:+4" },
  { label: "ACTION:VOLUME:-4 = خفض الصوت 4%", value: "ACTION:VOLUME:-4" },
  { label: "ACTION:SEEK:+1 = تقديم 1 ثانية", value: "ACTION:SEEK:+1" },
  { label: "ACTION:SEEK:-1 = إرجاع 1 ثانية", value: "ACTION:SEEK:-1" },
  { label: "ACTION:SEEK:+5 = تقديم 5 ثوانٍ", value: "ACTION:SEEK:+5" },
  { label: "ACTION:SEEK:-5 = إرجاع 5 ثوانٍ", value: "ACTION:SEEK:-5" },
  { label: "ACTION:SEEK:+10 = تقديم 10 ثوانٍ", value: "ACTION:SEEK:+10" },
  { label: "ACTION:SEEK:-10 = إرجاع 10 ثوانٍ", value: "ACTION:SEEK:-10" },
  { label: "ACTION:SEEK:+30 = تقديم 30 ثانية", value: "ACTION:SEEK:+30" },
  { label: "ACTION:SEEK:-30 = إرجاع 30 ثانية", value: "ACTION:SEEK:-30" },
  { label: "ACTION:SPEED:+0.25 = زيادة السرعة 0.25", value: "ACTION:SPEED:+0.25" },
  { label: "ACTION:SPEED:-0.25 = خفض السرعة 0.25", value: "ACTION:SPEED:-0.25" },
  { label: "ACTION:TOGGLE_PIP = صورة داخل صورة", value: "ACTION:TOGGLE_PIP" }
];

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

function fillActionPreset() {
  const sel = $("actionPreset");
  if (!sel) return;

  sel.innerHTML = `<option value="">اختر أكشن جاهز</option>`;
  for (const action of ACTIONS) {
    const opt = document.createElement("option");
    opt.value = action.value;
    opt.textContent = action.label;
    sel.appendChild(opt);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(kind, text) {
  const el = $("statusValue");
  if (!el) return;
  el.className = "statusValue";
  if (kind === "ok") el.classList.add("statusOk");
  if (kind === "warn") el.classList.add("statusWarn");
  if (kind === "bad") el.classList.add("statusBad");
  el.textContent = text;
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

function isRestrictedUrl(url) {
  return !url || /^(chrome|edge|about|brave|opera|vivaldi|moz-extension|chrome-extension):/i.test(url);
}

async function checkPageStatus() {
  const tab = await getActiveTab();
  const url = tab?.url || "";

  if (isRestrictedUrl(url)) {
    setStatus("bad", "هذه الصفحة محمية من المتصفح ولا يمكن تشغيل الإضافة عليها");
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GVZ_STATUS" });
    if (!res?.ok) {
      setStatus("warn", "الصفحة مفتوحة لكن لم يصلنا رد واضح من الإضافة");
      return;
    }
    if (res.blocked) {
      setStatus("warn", "الإضافة محظورة على هذا الموقع");
      return;
    }
    if (!res.globalEnabled) {
      setStatus("warn", "الإضافة متوقفة من خيار التفعيل العام");
      return;
    }
    setStatus("ok", "الإضافة شغالة على هذه الصفحة");
  } catch {
    setStatus("bad", "الإضافة غير محقونة في هذه الصفحة. استخدم التفعيل اليدوي");
  }
}

async function activateOnCurrentPage() {
  const tab = await getActiveTab();
  const url = tab?.url || "";

  if (!tab?.id || isRestrictedUrl(url)) {
    setStatus("bad", "لا يمكن التفعيل اليدوي على هذه الصفحة");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });
    await checkPageStatus();
  } catch {
    setStatus("bad", "فشل التفعيل اليدوي على هذه الصفحة");
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

  fillActionPreset();
  await loadGlobalData();
  await loadOverlayUI();
  await loadBlockedSiteUI();
  await checkPageStatus();

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
  $("checkStatus").addEventListener("click", checkPageStatus);
  $("manualActivate").addEventListener("click", activateOnCurrentPage);

  $("capFrom").addEventListener("click", () => beginCapture("from"));
  $("capTo").addEventListener("click", () => beginCapture("to"));
  $("actionPreset").addEventListener("change", () => {
    if ($("actionPreset").value) $("to").value = $("actionPreset").value;
  });

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
