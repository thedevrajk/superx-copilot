const brain = globalThis.SuperXBrain;
const REQ_LIMIT = 1000;
const TOK_LIMIT = 200000;

const sourceEl = document.querySelector("#source");
const chipEl = document.querySelector("#chip");
const reqLabel = document.querySelector("#req-label");
const tokLabel = document.querySelector("#tok-label");
const reqBar = document.querySelector("#req-bar");
const tokBar = document.querySelector("#tok-bar");
const customEl = document.querySelector("#custom");
const postEl = document.querySelector("#post");
const emptyEl = document.querySelector("#empty");
const errorEl = document.querySelector("#error");
const errorText = document.querySelector("#error-text");
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
  const data = usage?.[todayKey()] || { requests: 0, tokens: 0 };
  const reqPct = Math.min(100, (data.requests / REQ_LIMIT) * 100);
  const tokPct = Math.min(100, (data.tokens / TOK_LIMIT) * 100);
  reqLabel.textContent = String(data.requests);
  tokLabel.textContent = data.tokens >= 1000 ? `${Math.round(data.tokens / 1000)}k` : String(data.tokens);
  reqBar.querySelector("span").style.width = `${reqPct}%`;
  tokBar.querySelector("span").style.width = `${tokPct}%`;
  reqBar.className = "track" + (reqPct > 90 ? " bad" : reqPct > 70 ? " warn" : "");
  tokBar.className = "track" + (tokPct > 90 ? " bad" : tokPct > 70 ? " warn" : "");
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

function setCount(len) {
  countEl.textContent = len ? `${len} / 280` : "Empty";
  countEl.className = "count" + (len > 280 ? " bad" : len > 180 ? " warn" : "");
}

function paint() {
  const hasPost = Boolean(state);
  const failed = Boolean(state?.error);
  const ready = hasPost && !failed && state.options.length > 0;
  emptyEl.hidden = hasPost;
  errorEl.hidden = !failed;
  postEl.hidden = !hasPost || !state.text;
  scratchEl.hidden = !ready;
  countEl.hidden = !ready;
  actionsEl.hidden = !ready;
  if (!hasPost) {
    sourceEl.textContent = "No post yet";
    chipEl.textContent = "Idle";
    cardsEl.replaceChildren();
    return;
  }
  postEl.textContent = state.text;
  sourceEl.textContent = state.author || "Post";
  chipEl.textContent = state.loading ? "Writing" : state.model || (failed ? "Error" : "Ready");
  if (failed) errorText.textContent = state.error;
  cardsEl.replaceChildren();
  state.options.forEach((option, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card" + (index === state.active ? " active" : "");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${String(index + 1).padStart(2, "0")}  ${option.formatName}`;
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = option.text;
    card.append(label, body);
    card.addEventListener("click", () => {
      state.active = index;
      state.scratch = option.text;
      scratchEl.value = option.text;
      paint();
    });
    cardsEl.append(card);
  });
  if (ready && scratchEl.value !== state.scratch) scratchEl.value = state.scratch;
  if (ready) setCount(state.scratch.trim().length);
  rerollEl.disabled = state.loading;
  insertEl.disabled = state.loading || !state.scratch.trim();
}

function accept(payload) {
  const text = String(payload?.text || "");
  const imageUrls = Array.isArray(payload?.imageUrls) ? payload.imageUrls : [];
  if (!text && !imageUrls.length) {
    state = {
      author: payload?.author || "Post",
      text: "",
      imageUrls: [],
      read: null,
      formatIds: [],
      options: [],
      active: 0,
      scratch: "",
      loading: false,
      model: "",
      error: "This post has no text and no image to read.",
    };
    paint();
    return;
  }
  const read = brain.deconstruct(text || "Image post.");
  state = {
    author: payload?.author || "Post",
    text,
    imageUrls,
    read,
    formatIds: brain.formatsFor(read.kind),
    options: [],
    active: 0,
    scratch: "",
    loading: false,
    model: "",
    error: "",
    salt: 0,
  };
  generate();
}

async function generate() {
  if (!state || (state.error && !state.read)) return;
  state.loading = true;
  state.error = "";
  state.options = [];
  paint();
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get(["apiKey", "geminiApiKey", "extraNotes", "customPrompt"], resolve);
  });
  const apiKey = String(config.apiKey || config.geminiApiKey || "").trim();
  if (!apiKey) {
    state.loading = false;
    state.error = "Add an API key in Settings. No line is written without one.";
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
    if (!response?.ok) throw new Error(response?.error || "The request failed.");
    const options = Array.isArray(response.options) ? response.options.filter((item) => item?.text) : [];
    if (!options.length) throw new Error("The model returned no reply.");
    state.options = options;
    state.model = response.model || "API";
    state.active = 0;
    state.scratch = options[0].text;
    state.error = "";
    loadUsage();
  } catch (error) {
    state.options = [];
    state.scratch = "";
    state.error = error instanceof Error ? error.message : "The request failed.";
  }
  state.loading = false;
  paint();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "OPEN_POST") accept(message.payload || {});
});

chrome.storage.session.get(["pendingPost"], (stored) => {
  if (stored.pendingPost) accept(stored.pendingPost);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pendingPost?.newValue) accept(changes.pendingPost.newValue);
  if (area === "local" && changes.usage) paintUsage(changes.usage.newValue || {});
});

rerollEl.addEventListener("click", () => {
  if (!state?.read) return;
  state.salt += 1;
  generate();
});

insertEl.addEventListener("click", async () => {
  const text = state?.scratch?.trim();
  if (!text) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    state.error = "No X tab to insert into. Open the reply box, then Insert.";
    paint();
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "INSERT_REPLY", text }, () => {
    if (chrome.runtime.lastError) {
      navigator.clipboard.writeText(text);
      sourceEl.textContent = "Copied. The reply box was not open.";
    }
  });
});

scratchEl.addEventListener("input", () => {
  if (!state) return;
  state.scratch = scratchEl.value;
  setCount(state.scratch.trim().length);
  insertEl.disabled = !state.scratch.trim();
});

function openSettings(event) {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
}
document.querySelector("#settings-link").addEventListener("click", openSettings);
document.querySelector("#open-settings").addEventListener("click", openSettings);

loadUsage();
loadCustom();
paint();
