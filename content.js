if (!window.__GVZ_CONTENT_LOADED__) {
window.__GVZ_CONTENT_LOADED__ = true;
let siteRules = { enabled: false, mappings: [] };
let map = new Map();
let blockedHosts = [];
let lastPointer = { x: null, y: null };
let soundDisplaySettings = { color: "#ffffff", fontSize: 48 };

let lastFsAt = 0;
let lastMouse2At = 0;
let suppressContextMenuUntil = 0;

function nowMs() { return Date.now(); }

function normalizeHost(host) {
  return (host || "").replace(/^www\./i, "").replace(/^m\./i, "");
}

function hostFromLocation() {
  try { return normalizeHost(location.host); } catch { return ""; }
}


function buildMap() {
  map = new Map();
  for (const m of (siteRules.mappings || [])) {
    if (m?.from && m?.to) map.set(m.from, m.to);
  }
}

// ✅ تضمن وجود إعدادات Zones حتى لو المستخدم ما فتح options.html
async function ensureZonesDefaults() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  let changed = false;
  const isTopFrame = window.top === window;

  if (!settings.zones) {
    settings.zones = {
      enabled: true,
      autoHideMs: 900,
      wheel: {
        preset: "grid3x3",
        map: {}
      }
    };
    changed = true;
  }

  // default enabled
  const enabled = settings.zones.enabled !== false;
  if (settings.zones.enabled !== enabled) {
    settings.zones.enabled = enabled;
    changed = true;
  }

  if (!settings.zones.wheel) {
    settings.zones.wheel = { preset: "grid3x3", map: {} };
    changed = true;
  }
  if (!settings.zones.wheel.map) {
    settings.zones.wheel.map = {};
    changed = true;
  }

  const map = settings.zones.wheel.map;

  // Defaults (تقدر تغيرها من options)
  if (!map["6"]) {
    map["6"] = { up: "ACTION:SEEK:+5", down: "ACTION:SEEK:-5" };
    changed = true;
  }
  if (!map["7"]) {
    map["7"] = { up: "ACTION:SEEK:+1", down: "ACTION:SEEK:-1" };
    changed = true;
  }
  if (!map["4"]) {
    map["4"] = { up: "ACTION:VOLUME:+4", down: "ACTION:VOLUME:-4" };
    changed = true;
  }

  if (changed && isTopFrame) {
    await chrome.storage.sync.set({ settings });
  }

  return settings.zones;
}

async function loadBlockedHosts() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  blockedHosts = Array.isArray(settings.blockedHosts) ? settings.blockedHosts : [];
}

async function loadSoundDisplaySettings() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  const sound = settings.soundDisplay || soundDisplaySettings;
  soundDisplaySettings = {
    color: sound.color || "#ffffff",
    fontSize: Number(sound.fontSize || 48)
  };

  if (vzOverlay) {
    vzOverlay.style.setProperty("--vz-volume-color", soundDisplaySettings.color);
    vzOverlay.style.setProperty("--vz-volume-size", `${soundDisplaySettings.fontSize}px`);
  }
  if (vzVolumeBadge) {
    vzVolumeBadge.style.setProperty("--vz-volume-color", soundDisplaySettings.color);
    vzVolumeBadge.style.setProperty("--vz-volume-size", `${soundDisplaySettings.fontSize}px`);
  }
}

function isBlockedHost() {
  return blockedHosts.includes(baseDomain(location.host));
}




// -------------------- Global Video Zones (3x3 + Wheel) --------------------
let zoneSettings = { enabled: true, wheel: { map: {} } };








async function loadZoneSettings() {
  const zones = await ensureZonesDefaults(); //  يضمن وجود الإعدادات حتى بدون فتح options
  zoneSettings = zones || zoneSettings;

  zoneSettings.enabled = zoneSettings.enabled !== false; // default true
  zoneSettings.wheel ||= { map: {} };
  zoneSettings.wheel.map ||= {};
}

function findVideoAtPoint(x, y) {
  if (typeof x !== "number" || typeof y !== "number") return null;

  const stack = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(x, y)
    : [document.elementFromPoint(x, y)].filter(Boolean);

  for (const el of stack) {
    if (!el) continue;
    if (el.tagName === "VIDEO") return el;

    const closestVideo = el.closest?.("video");
    if (closestVideo) return closestVideo;

    const descendantVideos = el.querySelectorAll?.("video");
    if (!descendantVideos?.length) continue;

    for (const video of descendantVideos) {
      const rect = video.getBoundingClientRect?.();
      if (!rect) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return video;
      }
    }
  }

  return null;
}

function getVideoUnderPointer(e) {
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    const v = findVideoAtPoint(e.clientX, e.clientY);
    if (v) return v;
  }
  return null;
}

// Zones numbered 1..9 from top-left to bottom-right
function getZoneNumber(rect, x, y) {
  const relX = x - rect.left;
  const relY = y - rect.top;
  if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return null;
  const col = Math.min(2, Math.floor((relX / rect.width) * 3));  // 0..2
  const row = Math.min(2, Math.floor((relY / rect.height) * 3)); // 0..2
  return row * 3 + col + 1;
}

function updatePointerFromEvent(e) {
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    lastPointer = { x: e.clientX, y: e.clientY };
  }
}

function getVideoFromPointerPosition() {
  if (typeof lastPointer.x !== "number" || typeof lastPointer.y !== "number") return null;
  return findVideoAtPoint(lastPointer.x, lastPointer.y);
}

window.addEventListener("mousemove", updatePointerFromEvent, true);

window.addEventListener("wheel", (e) => {
  updatePointerFromEvent(e);
  if (isBlockedHost()) return;
  if (!siteRules.enabled) return;
  if (!zoneSettings?.enabled) return;

const video = getVideoUnderPointer(e);
if (video) ensureVideoOverlay(video);
if (!video) return; // ✅ يمنع الخطأ إذا ما فيه فيديو

  const rect = video.getBoundingClientRect();
  const zone = getZoneNumber(rect, e.clientX, e.clientY);
  if (!zone) return;

  const entry = zoneSettings?.wheel?.map?.[String(zone)];
  if (!entry) return;

  const dir = e.deltaY < 0 ? "up" : "down";
  const action = entry[dir];
  if (!action) return;
  showOverlay(`Zone ${zone} • ${dir.toUpperCase()} → ${action}`);

  const ok = runAction(action, e);
  if (!ok) return;

  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}, { capture: true, passive: false });
// -------------------------------------------------------------------------
let overlaySettings = { enabled: true, autoHideMs: 900 };

async function loadOverlaySettings() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const s = data.settings || {};
  overlaySettings = s.overlay || overlaySettings;
  overlaySettings.autoHideMs = Number(overlaySettings.autoHideMs ?? 900);
  overlaySettings.enabled = overlaySettings.enabled !== false && overlaySettings.autoHideMs > 0;

  if (!overlaySettings.enabled) hideOverlayNow();
}

// -------- Overlay: Grid داخل الفيديو --------
function injectOverlayCSS() {
  if (document.getElementById("vz_overlay_css")) return;
  const style = document.createElement("style");
  style.id = "vz_overlay_css";
  style.textContent = `
    .vzWrap{ position:absolute; inset:0; pointer-events:none; z-index:999999; }
    .vzGrid{ position:absolute; inset:0; display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); }
    .vzCell{ border:1px solid rgba(255,255,255,.10); }
    .vzHint{
      position:absolute; left:10px; bottom:10px;
      background:rgba(0,0,0,.55); color:#fff;
      padding:6px 8px; border-radius:10px;
      font:12px/1.2 Arial; max-width:70%;
      opacity:.95;
    }
    .vzVolume{
      position:absolute; left:10px; top:10px;
      color:var(--vz-volume-color, #fff);
      font:700 var(--vz-volume-size, 48px)/1 Arial;
      text-shadow:0 2px 10px rgba(0,0,0,.75);
      pointer-events:none;
      opacity:.98;
    }
    .vzHidden{ display:none !important; }
  `;
  document.documentElement.appendChild(style);
}

let vzOverlay = null;
let vzOverlayVideo = null;
let vzVolumeBadge = null;

function ensureVideoOverlay(video) {
  if (!video) return;
  injectOverlayCSS();

  if (vzOverlay && vzOverlayVideo === video) return;

  if (vzOverlay) vzOverlay.remove();
  if (vzVolumeBadge) vzVolumeBadge.remove();

  vzOverlay = document.createElement("div");
  vzOverlay.className = "vzWrap vzHidden";
  vzOverlay.style.setProperty("--vz-volume-color", soundDisplaySettings.color);
  vzOverlay.style.setProperty("--vz-volume-size", `${soundDisplaySettings.fontSize}px`);
  vzOverlay.innerHTML = `
    <div class="vzGrid">
      <div class="vzCell"></div><div class="vzCell"></div><div class="vzCell"></div>
      <div class="vzCell"></div><div class="vzCell"></div><div class="vzCell"></div>
      <div class="vzCell"></div><div class="vzCell"></div><div class="vzCell"></div>
    </div>
    <div class="vzHint" id="vzHint">Zones</div>
  `;

  vzVolumeBadge = document.createElement("div");
  vzVolumeBadge.className = "vzVolume vzHidden";
  vzVolumeBadge.textContent = "100";
  vzVolumeBadge.style.setProperty("--vz-volume-color", soundDisplaySettings.color);
  vzVolumeBadge.style.setProperty("--vz-volume-size", `${soundDisplaySettings.fontSize}px`);

  const parent = video.parentElement || video;
  const cs = getComputedStyle(parent);
  if (cs.position === "static") parent.style.position = "relative";

  parent.appendChild(vzOverlay);
  parent.appendChild(vzVolumeBadge);
  vzOverlayVideo = video;
}

function showOverlay(text) {
  if (!overlaySettings.enabled) return; // ✅ OFF

  if (!vzOverlay) return;
  const hint = vzOverlay.querySelector("#vzHint");
  if (hint) hint.textContent = text || "Zones";
  vzOverlay.classList.remove("vzHidden");

  clearTimeout(showOverlay._t);
  const ms = Math.max(0, overlaySettings.autoHideMs || 900);

  if (ms === 0) return; // 0 = يبقى ظاهر (لين ما تطفيه يدويًا)

  showOverlay._t = setTimeout(() => {
    vzOverlay?.classList.add("vzHidden");
  }, ms);
}
function hideOverlayNow() {
  vzOverlay?.classList.add("vzHidden");
  vzVolumeBadge?.classList.add("vzHidden");
}

function showVolumeIndicator(video) {
  if (!overlaySettings.enabled || !video) return;
  ensureVideoOverlay(video);
  if (!vzVolumeBadge || vzOverlayVideo !== video) return;

  const percent = video.muted ? 0 : Math.round((video.volume ?? 1) * 100);
  vzVolumeBadge.textContent = String(percent);
  vzVolumeBadge.style.setProperty("--vz-volume-color", soundDisplaySettings.color);
  vzVolumeBadge.style.setProperty("--vz-volume-size", `${soundDisplaySettings.fontSize}px`);
  vzVolumeBadge.classList.remove("vzHidden");

  clearTimeout(showVolumeIndicator._t);
  const ms = Math.max(0, overlaySettings.autoHideMs || 900);
  showVolumeIndicator._t = setTimeout(() => {
    vzVolumeBadge?.classList.add("vzHidden");
  }, ms);
}
// -------------------------------------------


function baseDomain(host) {
  const h = (host || "").replace(/^www\./i, "").replace(/^m\./i, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join("."); // twitch.tv, kick.com
}

/*async function loadRulesForThisHost() {
  const host = baseDomain(location.host);

  const data = await chrome.storage.sync.get({ sites: {} });

  // جرّب: نفس الهوست، ثم الدومين الأساسي
  siteRules =
    data.sites[(location.host || "").replace(/^www\./i, "").replace(/^m\./i, "")] ||
    data.sites[host] ||
    { enabled: false, mappings: [] };

  buildMap();
}*/

function normalizeHost(host) {
  return (host || "").replace(/^www\./i, "").replace(/^m\./i, "");
}

function baseDomain(host) {
  const h = normalizeHost(host);
  const p = h.split(".");
  return p.length <= 2 ? h : p.slice(-2).join(".");
}

async function loadRulesForThisHost() {
  const data = await chrome.storage.sync.get({
    globalSiteRules: { enabled: false, mappings: [] }
  });
  siteRules = data.globalSiteRules || { enabled: false, mappings: [] };
  buildMap();
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GVZ_STATUS") {
    sendResponse({
      ok: true,
      blocked: isBlockedHost(),
      globalEnabled: !!siteRules.enabled,
      hasVideoUnderPointer: !!getVideoFromPointerPosition(),
      host: baseDomain(location.host)
    });
    return true;
  }
  if (msg?.type === "SITE_RULES_UPDATED") {
    siteRules = msg.siteRules || { enabled: false, mappings: [] };
    buildMap();
    if (!siteRules.enabled) hideOverlayNow();
  }
  if (msg?.type === "RELOAD_SITE_RULES") {
    loadRulesForThisHost();
  }
  // from Options page
  if (msg?.type === "GVZ_RELOAD" || msg?.type === "RELOAD_ZONE_SETTINGS") {
    loadZoneSettings();
    loadBlockedHosts();
    loadSoundDisplaySettings();
  }
  if (msg?.type === "RELOAD_OVERLAY_SETTINGS") loadOverlaySettings();
  
});

loadRulesForThisHost();
loadZoneSettings(); // ✅ مهم: تشغيل zones بعد refresh مباشرة
loadOverlaySettings();
loadBlockedHosts();
loadSoundDisplaySettings();

function normalizeKeyEvent(e) {
  // نخلي ArrowRight/ArrowLeft يطلع كما هو
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") return e.key;

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

function normalizeMouseEvent(e) {
  const mapBtns = ["Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5"];
  return mapBtns[e.button] || `Mouse${e.button + 1}`;
}
function getVideoUnderPointerStrict(e) {
  if (typeof e.clientX !== "number" || typeof e.clientY !== "number") return null;
  const v = findVideoAtPoint(e.clientX, e.clientY);
  return v || null;
}

function findVideoFromEvent(e) {
  // نبحث عن فيديو تحت المؤشر أو داخل العنصر المضغوط
  const t = e.target;
  if (!t) return null;

  // لو ضغطت على فيديو مباشرة
  if (t.tagName === "VIDEO") return t;

  // لو ضغطت على طبقة فوق الفيديو
  const v1 = t.closest?.("video");
  if (v1) return v1;

  // fallback: نطلع العنصر تحت إحداثيات الماوس
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    const v2 = findVideoAtPoint(e.clientX, e.clientY);
    if (v2) return v2;
  }

  // آخر حل: أول فيديو في الصفحة (لو المشغل واحد)
  return null;
}

function togglePlay(video) {
  if (!video) return;
  if (video.paused) video.play().catch(()=>{});
  else video.pause();
}

function seek(video, deltaSec) {
  if (!video) return;
  // بعض الستريمات live ما تدعم seek
  if (isNaN(video.duration) || !isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.currentTime + deltaSec, video.duration));
}

function runAction(action, e) {
  // Play/Pause: فقط فيديو نفسه
  if (action === "ACTION:TOGGLE_PLAY") {
    const video = e.__videoUnderPointer || findVideoLoose(e);
    if (!video) return false;
    togglePlay(video);
    return true;
  }

  // Seek: نقدر نستخدم loose لأن الأسهم غالبًا بدون target فيديو
  if (action.startsWith("ACTION:SEEK:")) {
    const n = Number(action.split(":")[2]);
    if (isNaN(n)) return false;
    const video = findVideoLoose(e);
    if (!video) return false;
    seek(video, n);
    return true;
  }

  // Fullscreen: loose (عشان Twitch overlays/iframes)
if (action === "ACTION:TOGGLE_FULLSCREEN") {
  // ✅ لو Mouse2 جهّز لنا فيديو تحت المؤشر، استخدمه
  const video = e.__videoUnderPointer || findVideoLoose(e);
  if (!video) return false;

  const t = nowMs();
  if (t - lastFsAt < 450) return true;
  lastFsAt = t;

  toggleFullscreen(video);
  return true;
}


  // Mute
  if (action === "ACTION:TOGGLE_MUTE") {
    const video = findVideoLoose(e);
    if (!video) return false;
    video.muted = !video.muted;
    showVolumeIndicator(video);
    return true;
  }

  // PiP
  if (action === "ACTION:TOGGLE_PIP") {
    const video = findVideoLoose(e);
    if (!video) return false;
    const doc = document;
    const pipEl = doc.pictureInPictureElement;
    if (pipEl) {
      doc.exitPictureInPicture?.().catch(()=>{});
    } else {
      video.requestPictureInPicture?.().catch(()=>{});
    }
    return true;
  }

  // Volume delta in percent
  if (action.startsWith("ACTION:VOLUME:")) {
    const n = Number(action.split(":")[2]);
    if (isNaN(n)) return false;
    const video = findVideoLoose(e);
    if (!video) return false;
    const delta = n / 100;
    video.volume = Math.max(0, Math.min(1, (video.volume ?? 1) + delta));
    showVolumeIndicator(video);
    return true;
  }

  // Speed delta
  if (action.startsWith("ACTION:SPEED:")) {
    const n = Number(action.split(":")[2]);
    if (isNaN(n)) return false;
    const video = findVideoLoose(e);
    if (!video) return false;
    const r = (video.playbackRate || 1) + n;
    video.playbackRate = Math.max(0.25, Math.min(4, Math.round(r * 100) / 100));
    return true;
  }

  return false;
}

function pickFullscreenContainer(video) {
  if (!video) return null;

  // جرّب نلقى أقرب حاوية “تشبه مشغل” (عادة تحتوي أزرار/controls overlay)
  const candidates = [];
  let cur = video;
  for (let i = 0; i < 8 && cur; i++) {
    candidates.push(cur);
    cur = cur.parentElement;
  }

  // فلترة: نفضّل عنصر:
  // - يحتوي الفيديو
  // - وفيه buttons/controls أو class/role تشير للمشغل
  const scored = candidates
    .map(el => {
      const cls = (el.className || "").toString();
      const role = (el.getAttribute?.("role") || "");
      const hasButtons = !!el.querySelector?.("button, [role='button'], input[type='range']");
      const looksPlayer = /player|video|controls|overlay|container/i.test(cls + " " + role);
      const score = (hasButtons ? 3 : 0) + (looksPlayer ? 2 : 0) + (el === video ? 0 : 1);
      return { el, score };
    })
    .sort((a, b) => b.score - a.score);

  // أفضل خيار: أعلى سكور، وإلا استخدم parent للفيديو
  return scored[0]?.el || video.parentElement || video;
}

function toggleFullscreen(video) {
  const doc = document;
  const v = video;
  if (!v) return;

  // خروج
  if (doc.fullscreenElement) {
    doc.exitFullscreen?.().catch(()=>{});
    return;
  }

  const req = v.requestFullscreen || v.webkitRequestFullscreen;
  if (req) {
    try { req.call(v); } catch {}
  }
}




function findVideoStrict(e) {
  return (e.target?.tagName === "VIDEO") ? e.target : null;
}

function findVideoLoose(e) {
  if (e.target?.tagName === "VIDEO") return e.target;

  // لو الهدف overlay فوق الفيديو
  const v1 = e.target?.closest?.("video");
  if (v1) return v1;

  // الأهم: خذ العنصر تحت المؤشر (غالباً الفيديو يكون تحته)
  if (typeof e.clientX === "number" && typeof e.clientY === "number") {
    const v2 = findVideoAtPoint(e.clientX, e.clientY);
    if (v2) return v2;
  }

  return getVideoFromPointerPosition();
}




function shouldIgnoreKeyBecauseTyping(e) {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.settings) {
    loadZoneSettings();
    loadOverlaySettings();
    loadBlockedHosts();
    loadSoundDisplaySettings();
  }
  if (changes.globalSiteRules) loadRulesForThisHost();
});
/*chrome.tabs.query({active:true,currentWindow:true}, ([t])=>{
  chrome.tabs.sendMessage(t.id, {type:"RELOAD_OVERLAY_SETTINGS"});
});
*/









// ✅ ArrowRight/Left: نمنع الافتراضي ونطبق 5 ثواني
window.addEventListener("keydown", (e) => {
  updatePointerFromEvent(e);
  if (isBlockedHost()) return;
  if (!siteRules.enabled) return;
  if (shouldIgnoreKeyBecauseTyping(e)) return;
  if (!getVideoFromPointerPosition()) return;

  const sig = normalizeKeyEvent(e);
  if (!sig) return;

  const to = map.get(sig);
  if (!to) return;

  const ok = to.startsWith("ACTION:") ? runAction(to, e) : false;
  if (ok) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function handleMouse(e) {
  updatePointerFromEvent(e);
  if (isBlockedHost()) return;
  if (!siteRules.enabled) return;

  const sig = normalizeMouseEvent(e); // Mouse1..Mouse5
  const to = map.get(sig);
  if (!to) return;

  // Mouse1 (Play/Pause): فقط click + فقط على VIDEO نفسه (من runAction)
  if (sig === "Mouse1") {
    if (e.type !== "click") return;
  }

  // Mouse2 (Fullscreen): auxclick أو mousedown (حسب الجهاز) + Debounce
  if (sig === "Mouse2") {
    if (!(e.type === "auxclick" || e.type === "mousedown")) return;

    const t = nowMs();
    if (t - lastMouse2At < 350) return; // يمنع double-trigger
    lastMouse2At = t;
  }

  // Mouse3 = الزر الأيمن: نفّذ الاختصار وامنع قائمة الزر الأيمن
  if (sig === "Mouse3") {
    if (!(e.type === "mousedown" || e.type === "contextmenu")) return;

    const v = getVideoUnderPointerStrict(e);
    if (!v) return;
    e.__videoUnderPointer = v;

    if (e.type === "contextmenu") {
      if (nowMs() < suppressContextMenuUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }
      delete e.__videoUnderPointer;
      return;
    }
  }

  // باقي الأزرار (لو عندك): خله mousedown فقط
  if (sig !== "Mouse1" && sig !== "Mouse2" && sig !== "Mouse3") {
    if (e.type !== "mousedown") return;
  }

  if (sig === "Mouse2") {
  const v = getVideoUnderPointerStrict(e);
  if (!v) return;            // خارج الفيديو = لا تسوي شي
  // نخلي runAction يستخدم هذا الفيديو بدل fallback
  e.__videoUnderPointer = v; // نخزن مؤقتًا (اختياري)
}



  const ok = to.startsWith("ACTION:") ? runAction(to, e) : false;
  if (ok && sig === "Mouse3") {
    suppressContextMenuUntil = nowMs() + 800;
  }
  delete e.__videoUnderPointer;
  if (!ok) return;

  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}

window.addEventListener("click", handleMouse, true);
window.addEventListener("auxclick", handleMouse, true);
window.addEventListener("mousedown", handleMouse, true);
window.addEventListener("contextmenu", handleMouse, true);
}
