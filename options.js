const PRESETS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.8-flash",
    format: "gemini",
    auth: "query",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    format: "openai",
    auth: "bearer",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    format: "openai",
    auth: "bearer",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
    format: "openai",
    auth: "bearer",
  },
  custom: {
    baseUrl: "",
    model: "",
    format: "openai",
    auth: "bearer",
  },
};

const presetEl = document.querySelector("#preset");
const baseUrlEl = document.querySelector("#baseUrl");
const modelEl = document.querySelector("#model");
const formatEl = document.querySelector("#format");
const authEl = document.querySelector("#auth");
const keyInput = document.querySelector("#key");
const jsonModeEl = document.querySelector("#jsonMode");
const notesInput = document.querySelector("#notes");
const updateUrlInput = document.querySelector("#updateUrl");
const errorEl = document.querySelector("#error");
const statusEl = document.querySelector("#status");
const formatsEl = document.querySelector("#formats");
const tasteEl = document.querySelector("#taste");
const brain = globalThis.SuperXBrain;

for (const format of brain.FORMATS) {
  const item = document.createElement("li");
  const name = document.createElement("strong");
  name.textContent = format.name;
  const when = document.createElement("span");
  when.textContent = format.when;
  item.append(name, when);
  formatsEl.append(item);
}

function applyPreset(id, overwrite) {
  const preset = PRESETS[id] || PRESETS.custom;
  if (overwrite || !baseUrlEl.value) baseUrlEl.value = preset.baseUrl;
  if (overwrite || !modelEl.value) modelEl.value = preset.model;
  formatEl.value = preset.format;
  authEl.value = preset.auth;
}

presetEl.addEventListener("change", () => {
  applyPreset(presetEl.value, true);
});

chrome.storage.sync.get(
  ["apiPreset", "apiBaseUrl", "apiModel", "apiFormat", "apiAuth", "apiKey", "apiJsonMode", "extraNotes", "updateCheckUrl", "geminiApiKey"],
  (stored) => {
    presetEl.value = stored.apiPreset || "gemini";
    baseUrlEl.value = stored.apiBaseUrl || PRESETS.gemini.baseUrl;
    modelEl.value = stored.apiModel || PRESETS.gemini.model;
    formatEl.value = stored.apiFormat || "gemini";
    authEl.value = stored.apiAuth || "query";
    keyInput.value = stored.apiKey || stored.geminiApiKey || "";
    jsonModeEl.checked = stored.apiJsonMode !== false;
    notesInput.value = stored.extraNotes || "";
    updateUrlInput.value = stored.updateCheckUrl || "";
  },
);

function renderTaste() {
  chrome.storage.local.get(["taste"], (stored) => {
    const taste = stored.taste || { keeps: [], kills: [] };
    const keeps = Array.isArray(taste.keeps) ? taste.keeps.length : 0;
    const kills = Array.isArray(taste.kills) ? taste.kills.length : 0;
    tasteEl.textContent = `Kept ${keeps} · Dropped ${kills}. Kept and dropped lines steer the next run.`;
  });
}

renderTaste();

document.querySelector("#save").addEventListener("click", () => {
  const apiKey = keyInput.value.trim();
  const baseUrl = baseUrlEl.value.trim().replace(/\/+$/, "");
  const model = modelEl.value.trim();
  errorEl.textContent = "";
  if (apiKey && apiKey.length < 8) {
    errorEl.textContent = "Key looks too short.";
    return;
  }
  if (baseUrl && !/^https:\/\//i.test(baseUrl)) {
    errorEl.textContent = "Base URL must start with https://";
    return;
  }
  chrome.storage.sync.set(
    {
      apiPreset: presetEl.value,
      apiBaseUrl: baseUrl,
      apiModel: model,
      apiFormat: formatEl.value,
      apiAuth: authEl.value,
      apiKey,
      apiJsonMode: jsonModeEl.checked,
      extraNotes: notesInput.value.trim().slice(0, 600),
      updateCheckUrl: updateUrlInput.value.trim(),
    },
    () => {
      statusEl.textContent = "Saved.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 1600);
    },
  );
});

document.querySelector("#clear").addEventListener("click", () => {
  chrome.storage.local.set({ taste: { keeps: [], kills: [] } }, renderTaste);
});

const updateStatus = document.querySelector("#update-status");
const updateAction = document.querySelector("#update-action");
const CURRENT = chrome.runtime.getManifest().version;

function newer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}

async function checkUpdate() {
  updateStatus.textContent = "Checking…";
  updateAction.hidden = true;
  const stored = await chrome.storage.sync.get(["updateCheckUrl"]);
  const url = String(stored.updateCheckUrl || "https://raw.githubusercontent.com/thedevrajk/superx-copilot/main/version.json").trim();
  if (!url) {
    updateStatus.textContent = `v${CURRENT} · No update URL set`;
    updateAction.hidden = false;
    updateAction.innerHTML = `Keep the unpacked folder fixed. When a new zip is ready, unzip over it and click Reload on <a href="chrome://extensions" target="_blank">chrome://extensions</a>.`;
    return;
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    const remote = String(data.version || "");
    const download = String(data.url || "");
    if (remote && newer(remote, CURRENT) && download) {
      updateStatus.textContent = `Update available · v${remote}`;
      updateAction.hidden = false;
      updateAction.innerHTML = `<a href="${download}" target="_blank" style="color:#f2f2f3;font-weight:600;">Download v${remote}</a> · unzip over the same folder, then Reload on chrome://extensions`;
    } else {
      updateStatus.textContent = `v${CURRENT} · Up to date`;
    }
  } catch {
    updateStatus.textContent = `v${CURRENT} · Could not check`;
  }
}

document.querySelector("#check-update").addEventListener("click", checkUpdate);
checkUpdate();
