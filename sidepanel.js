const brain = globalThis.SuperXBrain;
const REQ_LIMIT = 1000;
const TOK_LIMIT = 200000;

const sourceEl = document.querySelector("#source");
const reqLabel = document.querySelector("#req-label");
const tokLabel = document.querySelector("#tok-label");
const reqBar = document.querySelector("#req-bar");
const tokBar = document.querySelector("#tok-bar");
const customEl = document.querySelector("#custom");
const emptyEl = document.querySelector("#empty");
const cardsEl = document.querySelector("#cards");
const scratchEl = document.querySelector("#scratch");
const countEl = document.querySelector("#count");
const actionsEl = document.querySelector("#actions");
const rerollEl = document.querySelector("#reroll");
const insertEl = document.querySelector("#insert");

let state = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function paintUsage(usage) {
  const day = todayKey();
  const data = usage?.[day] || { requests: 0, tokens: 0 };
  const reqPct = Math.min(100, (data.requests / REQ_LIMIT) * 100);
  const tokPct = Math.min(100, (data.tokens / TOK_LIMIT) * 100);
  reqLabel.textContent = `${data.requests} / ${REQ_LIMIT}`;
  tokLabel.textContent = `${Math.round(data.tokens / 1000)}k / 200k`;
  reqBar.querySelector("span").style.width = `${reqPct}%`;
  tokBar.querySelector("span").style.width = `${tokPct}%`;
  reqBar.className = "bar" + (reqPct > 90 ? " bad" : reqPct > 70 ? " warn" : "");
  tokBar.className = "bar" + (tokPct > 90 ? " bad" : tokPct > 70 ? " warn" : "");
}

function loadUsage() {
  chrome.storage.local.get(["usage"], (stored) => paintUsage(stored.usage || {}));
}

function loadCustom() {
  chrome.storage.sync.get(["customPrompt"], (stored) => {
    customEl.value = stored.customPrompt || "";
  });
}

customEl.addEventListener("input", () => {
  chrome.storage.sync.set({ customPrompt: customEl.value.trim().slice(0, 800) });
});

function paint() {
  if (!state) {
    emptyEl.hidden = false;
    scratchEl.hidden = true;
    countEl.hidden = true;
    actionsEl.hidden = true;
    cardsEl.replaceChildren();
    sourceEl.textContent = "Waiting for a post";
    return;
  }
  emptyEl.hidden = true;
  scratchEl.hidden = false;
  countEl.hidden = false;
  actionsEl.hidden = false;
  sourceEl.textContent = state.loading
    ? "Writing"
    : state.source === "api"
      ? state.model || "API"
      : "On device";
  cardsEl.replaceChildren();
  state.options.forEach((option, index) => {
    const card = document.createElement("div");
    card.className = "card" + (index === state.active ? " active" : "");
    card.innerHTML = `<div class="label">${index + 1} · ${option.formatName}</div><div class="body">${option.text}</div>`;
    card.addEventListener("click", () => {
      state.active = index;
      state.scratch = option.text;
      scratchEl.value = option.text;
      paint();
    });
    cardsEl.append(card);
  });
  if (scratchEl.value !== state.scratch) scratchEl.value = state.scratch;
  const len = state.scratch.trim().length;
  countEl.textContent = len ? `${len} characters` : "Empty";
  countEl.className = "count" + (len > 280 ? " bad" : len > 180 ? " warn" : "");
  rerollEl.disabled = state.loading;
  insertEl.disabled = state.loading || !state.scratch.trim();
}

async function generate() {
  if (!state) return;
  state.loading = true;
  paint();
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get(["apiKey", "geminiApiKey", "extraNotes", "customPrompt"], resolve);
  });
  const apiKey = String(config.apiKey || config.geminiApiKey || "").trim();
  if (!apiKey) {
    state.options = brain.localDrafts(state.read, state.formatIds, state.salt);
    state.source = "device";
    state.loading = false;
    state.scratch = state.options[0]?.text || "";
    paint();
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_REPLIES",
      payload: {
        text: state.text || "Image post.",
        author: state.author,
        imageUrls: state.imageUrls,
        formatIds: state.formatIds,
        extraNotes: [config.extraNotes, config.customPrompt].filter(Boolean).join("\n"),
        temperature: state.salt > 0 ? 0.9 : 0.7,
        salt: state.salt,
      },
    });
    if (!response?.ok) throw new Error(response?.error || "API failed.");
    state.options = response.options || [];
    state.source = "api";
    state.model = response.model || "";
    state.scratch = state.options[0]?.text || "";
    loadUsage();
  } catch (error) {
    state.options = brain.localDrafts(state.read, state.formatIds, state.salt);
    state.source = "device";
    state.scratch = state.options[0]?.text || "";
    sourceEl.textContent = error.message || "Failed";
  }
  state.loading = false;
  paint();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "OPEN_POST") return;
  const extracted = message.payload || {};
  const read = brain.deconstruct(extracted.text || "Image post.");
  state = {
    author: extracted.author || "them",
    text: extracted.text || "",
    imageUrls: extracted.imageUrls || [],
    read,
    formatIds: brain.formatsFor(read.kind),
    options: [],
    active: 0,
    scratch: "",
    loading: false,
    source: "device",
    model: "",
    salt: 0,
  };
  generate();
});

rerollEl.addEventListener("click", () => {
  if (!state) return;
  state.salt += 1;
  generate();
});

insertEl.addEventListener("click", async () => {
  const text = state?.scratch?.trim();
  if (!text) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "INSERT_REPLY", text });
  }
});

scratchEl.addEventListener("input", () => {
  if (!state) return;
  state.scratch = scratchEl.value;
  const len = state.scratch.trim().length;
  countEl.textContent = len ? `${len} characters` : "Empty";
  countEl.className = "count" + (len > 280 ? " bad" : len > 180 ? " warn" : "");
  insertEl.disabled = !state.scratch.trim();
});

document.querySelector("#settings-link").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadUsage();
loadCustom();
paint();
