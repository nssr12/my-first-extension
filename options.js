const $ = (id) => document.getElementById(id);

const ACTIONS = [
  { label: "(None)", value: "" },
  { label: "Toggle Play/Pause", value: "ACTION:TOGGLE_PLAY" },
  { label: "Toggle Fullscreen", value: "ACTION:TOGGLE_FULLSCREEN" },
  { label: "Toggle Mute", value: "ACTION:TOGGLE_MUTE" },
  { label: "Volume +4%", value: "ACTION:VOLUME:+4" },
  { label: "Volume -4%", value: "ACTION:VOLUME:-4" },
  { label: "Seek +1s", value: "ACTION:SEEK:+1" },
  { label: "Seek -1s", value: "ACTION:SEEK:-1" },
  { label: "Seek +5s", value: "ACTION:SEEK:+5" },
  { label: "Seek -5s", value: "ACTION:SEEK:-5" },
  { label: "Seek +10s", value: "ACTION:SEEK:+10" },
  { label: "Seek -10s", value: "ACTION:SEEK:-10" },
  { label: "Seek +30s", value: "ACTION:SEEK:+30" },
  { label: "Seek -30s", value: "ACTION:SEEK:-30" },
  { label: "Speed +0.25", value: "ACTION:SPEED:+0.25" },
  { label: "Speed -0.25", value: "ACTION:SPEED:-0.25" },
  { label: "Toggle PiP", value: "ACTION:TOGGLE_PIP" }
];

function actionLabel(v) {
  const a = ACTIONS.find(x => x.value === v);
  return a ? a.label : v;
}

async function getSettings() {
  const data = await chrome.storage.sync.get({ settings: {} });
  const settings = data.settings || {};
  settings.zones ||= { enabled: true, wheel: { map: {} } };
  settings.zones.wheel ||= { map: {} };
  settings.zones.wheel.map ||= {};
  settings.blockedHosts ||= [];
  settings.soundDisplay ||= { color: "#ffffff", fontSize: 48 };
  return settings;
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id) chrome.tabs.sendMessage(t.id, { type: "GVZ_RELOAD" }).catch(()=>{});
  }
}

function defaultMap() {
  return {
    "6": { up: "ACTION:SEEK:+5", down: "ACTION:SEEK:-5" },
    "7": { up: "ACTION:SEEK:+1", down: "ACTION:SEEK:-1" },
    "4": { up: "ACTION:VOLUME:+4", down: "ACTION:VOLUME:-4" }
  };
}

function renderGrid(map) {
  const g = $("grid");
  g.innerHTML = "";
  for (let i = 1; i <= 9; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.zone = String(i);

    const num = document.createElement("div");
    num.className = "zoneNum";
    num.textContent = `#${i}`;

    const up = map[String(i)]?.up || "";
    const down = map[String(i)]?.down || "";

    const l1 = document.createElement("div");
    l1.className = "actionLine";
    l1.innerHTML = `<span class="badge">Up</span>${up ? actionLabel(up) : "—"}`;

    const l2 = document.createElement("div");
    l2.className = "actionLine";
    l2.innerHTML = `<span class="badge">Down</span>${down ? actionLabel(down) : "—"}`;

    cell.appendChild(num);
    cell.appendChild(l1);
    cell.appendChild(l2);

    cell.addEventListener("click", () => openModal(i, up, down));
    g.appendChild(cell);
  }
}

let modalZone = 1;

function fillSelect(sel, value) {
  sel.innerHTML = "";
  for (const a of ACTIONS) {
    const opt = document.createElement("option");
    opt.value = a.value;
    opt.textContent = a.label;
    sel.appendChild(opt);
  }
  sel.value = value || "";
}

function openModal(zone, up, down) {
  modalZone = zone;
  $("modalTitle").textContent = `Zone #${zone}`;
  fillSelect($("wheelUp"), up);
  fillSelect($("wheelDown"), down);
  $("modalOverlay").hidden = false;
}

function closeModal() {
  $("modalOverlay").hidden = true;
}

function renderBlockedSites(blockedHosts) {
  const list = $("blockedList");
  const empty = $("blockedEmpty");
  list.innerHTML = "";

  const hosts = Array.isArray(blockedHosts) ? [...blockedHosts].sort() : [];
  empty.hidden = hosts.length > 0;

  for (const host of hosts) {
    const item = document.createElement("div");
    item.className = "blockedItem";

    const label = document.createElement("div");
    label.className = "blockedHost";
    label.textContent = host;

    const btn = document.createElement("button");
    btn.className = "btnGhost";
    btn.textContent = "إزالة";
    btn.addEventListener("click", async () => {
      const s = await getSettings();
      s.blockedHosts = (s.blockedHosts || []).filter((x) => x !== host);
      await saveSettings(s);
      renderBlockedSites(s.blockedHosts);
    });

    item.appendChild(label);
    item.appendChild(btn);
    list.appendChild(item);
  }
}

function renderSoundSettings(soundDisplay) {
  const color = soundDisplay?.color || "#ffffff";
  const size = Number(soundDisplay?.fontSize || 48);
  $("soundColor").value = color;
  $("soundSize").value = String(size);
  $("soundSizeValue").textContent = `${size}px`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await getSettings();
  const zones = settings.zones;
  const map = zones.wheel.map;

  $("enabled").checked = !!zones.enabled;

  if (Object.keys(map).length === 0) {
    zones.wheel.map = defaultMap();
    await saveSettings(settings);
  }

  renderGrid(zones.wheel.map);
  renderBlockedSites(settings.blockedHosts);
  renderSoundSettings(settings.soundDisplay);

  $("enabled").addEventListener("change", async () => {
    const s = await getSettings();
    s.zones.enabled = $("enabled").checked;
    if (Object.keys(s.zones.wheel.map).length === 0) s.zones.wheel.map = defaultMap();
    await saveSettings(s);
    renderGrid(s.zones.wheel.map);
  });

  $("reset").addEventListener("click", async () => {
    const s = await getSettings();
    s.zones = { enabled: true, wheel: { map: defaultMap() } };
    await saveSettings(s);
    $("enabled").checked = true;
    renderGrid(s.zones.wheel.map);
    renderBlockedSites(s.blockedHosts);
    renderSoundSettings(s.soundDisplay);
  });

  $("soundColor").addEventListener("change", async () => {
    const s = await getSettings();
    s.soundDisplay ||= { color: "#ffffff", fontSize: 48 };
    s.soundDisplay.color = $("soundColor").value;
    await saveSettings(s);
    renderSoundSettings(s.soundDisplay);
  });

  $("soundSize").addEventListener("input", () => {
    $("soundSizeValue").textContent = `${$("soundSize").value}px`;
  });

  $("soundSize").addEventListener("change", async () => {
    const s = await getSettings();
    s.soundDisplay ||= { color: "#ffffff", fontSize: 48 };
    s.soundDisplay.fontSize = Number($("soundSize").value);
    await saveSettings(s);
    renderSoundSettings(s.soundDisplay);
  });

  $("modalClose").addEventListener("click", closeModal);
  $("modalCancel").addEventListener("click", closeModal);
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) closeModal();
  });

  $("modalSave").addEventListener("click", async () => {
    const s = await getSettings();
    const z = s.zones;
    z.wheel.map ||= {};
    z.wheel.map[String(modalZone)] = {
      up: $("wheelUp").value,
      down: $("wheelDown").value
    };
    await saveSettings(s);
    renderGrid(z.wheel.map);
    closeModal();
  });
});
