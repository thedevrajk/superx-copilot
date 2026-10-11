(() => {
  const brain = globalThis.SuperXBrain;
  const ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';

  let host = null;
  let shadow = null;
  let anchor = null;
  let state = null;
  let debounceTimer = null;
  let requestToken = 0;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(inject, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  inject();

  function inject() {
    document.querySelectorAll('article [role="group"]').forEach((bar) => {
      if (!(bar instanceof HTMLElement)) return;
      if (bar.querySelector(":scope > .superx-draft")) return;
      if (!bar.querySelector('[data-testid="reply"]')) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "superx-draft";
      button.setAttribute("aria-label", "Draft a reply");
      button.title = "Draft a reply";
      button.innerHTML = ICON;
      button.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:34px",
        "height:34px",
        "margin:0",
        "padding:0",
        "border:0",
        "border-radius:999px",
        "background:transparent",
        "color:#71767b",
        "cursor:pointer",
      ].join(";");
      button.addEventListener("mouseenter", () => {
        button.style.background = "rgba(255,255,255,0.08)";
        button.style.color = "#e7e9ea";
      });
      button.addEventListener("mouseleave", () => {
        button.style.background = "transparent";
        button.style.color = "#71767b";
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const article = bar.closest("article");
        if (article) void open(article, button);
      });
      bar.append(button);
    });
  }

  async function open(article, button) {
    const extracted = extract(article);
    const config = await loadConfig();
    const read = brain.deconstruct(extracted.text || "Image post.");
    if (!extracted.text && extracted.imageUrls.length) {
      read.summary = "Image only. A key lets the model name what is in it. On device there is nothing specific to add.";
    }
    if (!extracted.text && !extracted.imageUrls.length) {
      read.summary = "Nothing to read on this post.";
    }
    const formatIds =
      !extracted.text && extracted.imageUrls.length
        ? ["specific-delta", "hierarchy", "dry-bit"]
        : brain.formatsFor(read.kind);

    anchor = button;
    state = {
      author: extracted.author,
      text: extracted.text,
      imageUrls: extracted.imageUrls,
      read,
      formatIds,
      options: [],
      active: 0,
      scratch: "",
      edited: false,
      loading: false,
      warning: "",
      source: config.apiKey ? "api" : "device",
      salt: 0,
      showFormats: false,
      keeps: config.keeps,
      kills: config.kills,
      extraNotes: config.extraNotes,
      apiKey: config.apiKey,
      model: config.model || "",
      empty: !extracted.text && !extracted.imageUrls.length,
    };
    ensure();
    paint();
    if (!state.empty) void generate();
  }

  function ensure() {
    if (host) return;
    host = document.createElement("div");
    host.id = "superx-copilot-host";
    host.style.cssText =
      "position:fixed;z-index:2147483646;width:min(400px,calc(100vw - 16px));max-height:min(560px,calc(100vh - 16px));";
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = template();
    document.documentElement.append(host);
    bind();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
  }

  function close() {
    requestToken += 1;
    host?.remove();
    host = null;
    shadow = null;
    anchor = null;
    state = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  }

  function bind() {
    shadow.getElementById("close").addEventListener("click", close);
    shadow.getElementById("formats-toggle").addEventListener("click", () => {
      state.showFormats = !state.showFormats;
      paint();
    });
    shadow.getElementById("reroll").addEventListener("click", () => {
      if (state.formatIds.length < 3 && !state.empty) {
        state.formatIds =
          !state.text && state.imageUrls.length
            ? ["specific-delta", "hierarchy", "dry-bit"]
            : brain.formatsFor(state.read.kind);
      }
      state.salt += 1;
      void generate();
    });
    shadow.getElementById("insert").addEventListener("click", insert);
    shadow.getElementById("scratch").addEventListener("input", (event) => {
      state.scratch = event.target.value;
      state.edited = true;
      paintCount();
    });
    shadow.getElementById("cards").addEventListener("click", (event) => {
      const drop = event.target.closest("[data-drop]");
      const pick = event.target.closest("[data-pick]");
      if (drop) {
        dropOption(Number(drop.dataset.drop));
        return;
      }
      if (pick) selectOption(Number(pick.dataset.pick));
    });
    shadow.getElementById("formats").addEventListener("click", (event) => {
      const button = event.target.closest("[data-format]");
      if (!button) return;
      chooseFormat(button.dataset.format);
    });
  }

  function onPointerDown(event) {
    if (!host) return;
    if (event.target === host) return;
    if (event.target instanceof Element && event.target.closest(".superx-draft")) return;
    close();
  }

  function onKeyDown(event) {
    if (!state) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    const path = event.composedPath();
    const typing = path.some((node) => node instanceof HTMLTextAreaElement);
    if (typing) return;
    if (event.key === "1" || event.key === "2" || event.key === "3") {
      selectOption(Number(event.key) - 1);
    }
  }

  function selectOption(index) {
    const option = state.options[index];
    if (!option) return;
    state.active = index;
    state.scratch = option.text;
    state.edited = false;
    state.showFormats = false;
    paint();
  }

  function chooseFormat(id) {
    const index = Math.min(state.active, Math.max(state.formatIds.length - 1, 0));
    if (state.formatIds.includes(id)) {
      selectOption(state.formatIds.indexOf(id));
      return;
    }
    state.formatIds = brain.replaceFormat(state.formatIds, index, id);
    state.showFormats = false;
    void generate();
  }

  function dropOption(index) {
    const option = state.options[index];
    if (!option) return;
    remember("kills", option);
    state.options = state.options.filter((_, item) => item !== index);
    state.formatIds = state.formatIds.filter((_, item) => item !== index);
    if (!state.options.length) {
      state.scratch = "";
      state.edited = false;
      state.active = 0;
      paint();
      return;
    }
    const next = Math.min(index, state.options.length - 1);
    if (!state.edited || state.scratch.trim() === option.text.trim()) {
      state.active = next;
      state.scratch = state.options[next].text;
      state.edited = false;
    } else {
      state.active = next;
    }
    paint();
  }

  async function generate() {
    const token = ++requestToken;
    state.loading = true;
    state.warning = "";
    paint();
    if (state.empty) {
      state.loading = false;
      paint();
      return;
    }
    if (!state.apiKey) {
      if (token !== requestToken) return;
      state.options = brain.localDrafts(state.read, state.formatIds, state.salt);
      state.source = "device";
      state.loading = false;
      if (!state.edited) {
        state.active = 0;
        state.scratch = state.options[0]?.text || "";
      }
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
          keeps: state.keeps.map((item) => item.text),
          kills: state.kills.map((item) => item.text),
          extraNotes: state.extraNotes,
          temperature: state.salt > 0 ? 0.9 : 0.7,
          salt: state.salt,
        },
      });
      if (token !== requestToken) return;
      if (!response?.ok) throw new Error(response?.error || "API failed.");
      state.options = response.options || [];
      state.source = "api";
      state.model = response.model || "";
    } catch (error) {
      if (token !== requestToken) return;
      state.options = brain.localDrafts(state.read, state.formatIds, state.salt);
      state.source = "device";
      state.warning = `${error instanceof Error ? error.message : "API failed."} Showing on-device lines.`;
    }
    state.loading = false;
    if (!state.edited) {
      state.active = 0;
      state.scratch = state.options[0]?.text || "";
    }
    paint();
  }

  function insert() {
    const text = state.scratch.trim();
    if (!text) return;
    const formatName = state.options[state.active]?.formatName || "Reply";
    remember("keeps", { text, formatName });
    const box = document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"]');
    if (box instanceof HTMLElement) {
      box.focus();
      const inserted = document.execCommand("insertText", false, text);
      if (!inserted) {
        box.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: text,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      close();
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        state.warning = "Reply box is closed. Copied. Open reply and paste. You still press Reply.";
        paint();
      },
      () => {
        state.warning = "Reply box is closed, and the copy failed.";
        paint();
      },
    );
  }

  function remember(bucket, item) {
    const entry = { text: item.text, formatName: item.formatName, at: Date.now() };
    const list = bucket === "keeps" ? state.keeps : state.kills;
    const next = [entry, ...list].slice(0, 20);
    if (bucket === "keeps") state.keeps = next;
    else state.kills = next;
    chrome.storage.local.get(["taste"], (stored) => {
      const taste = stored.taste || { keeps: [], kills: [] };
      taste[bucket] = next;
      chrome.storage.local.set({ taste });
    });
  }

  function paint() {
    if (!shadow || !state) return;
    shadow.getElementById("handle").textContent = `Reply to ${state.author}`;
    shadow.getElementById("source").textContent = state.loading
      ? "Writing"
      : state.source === "api"
        ? state.model || "API"
        : "On device";
    shadow.getElementById("read").textContent = state.read.summary;
    const warning = shadow.getElementById("warning");
    warning.hidden = !state.warning;
    warning.textContent = state.warning;
    const scratch = shadow.getElementById("scratch");
    if (scratch.value !== state.scratch) scratch.value = state.scratch;
    paintCount();
    shadow.getElementById("reroll").disabled = state.loading || state.empty;
    shadow.getElementById("insert").disabled = state.loading || !state.scratch.trim();
    shadow.getElementById("formats-toggle").textContent = state.showFormats
      ? "Hide formats"
      : "Use a different reply format";
    renderCards();
    renderFormats();
    requestAnimationFrame(place);
  }

  function paintCount() {
    if (!shadow || !state) return;
    const count = state.scratch.trim().length;
    const node = shadow.getElementById("count");
    if (!count) {
      node.textContent = "Empty";
      node.dataset.tone = "warn";
    } else if (count > 280) {
      node.textContent = `${count} · too long`;
      node.dataset.tone = "bad";
    } else if (count > 180) {
      node.textContent = `${count} · long for a reply`;
      node.dataset.tone = "warn";
    } else {
      node.textContent = `${count} · fine for a reply`;
      node.dataset.tone = "ok";
    }
    shadow.getElementById("insert").disabled = state.loading || !state.scratch.trim();
  }

  function renderCards() {
    const root = shadow.getElementById("cards");
    root.replaceChildren();
    if (state.loading && !state.options.length) {
      for (let index = 0; index < 3; index += 1) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton";
        root.append(skeleton);
      }
      return;
    }
    if (!state.options.length && !state.loading) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = state.empty ? "Nothing to draft." : "All three dropped. Reroll for a fresh set.";
      root.append(empty);
      return;
    }
    state.options.forEach((option, index) => {
      const card = document.createElement("div");
      card.className = "card" + (index === state.active ? " active" : "");
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "pick";
      pick.dataset.pick = String(index);
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = `${index + 1} · ${option.formatName}`;
      const body = document.createElement("span");
      body.className = "body";
      body.textContent = option.text;
      pick.append(label, body);
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "drop";
      drop.dataset.drop = String(index);
      drop.textContent = "Drop";
      card.append(pick, drop);
      root.append(card);
    });
  }

  function renderFormats() {
    const root = shadow.getElementById("formats");
    root.hidden = !state.showFormats;
    root.replaceChildren();
    if (!state.showFormats) return;
    for (const format of brain.FORMATS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "format";
      button.dataset.format = format.id;
      const name = document.createElement("span");
      name.className = "format-name";
      name.textContent = format.name;
      const when = document.createElement("span");
      when.className = "format-when";
      when.textContent = format.when;
      const mark = document.createElement("span");
      mark.className = "format-mark";
      mark.textContent = state.formatIds.includes(format.id)
        ? "In use"
        : format.fits.includes(state.read.kind)
          ? "Fits"
          : "";
      const text = document.createElement("span");
      text.append(name, when);
      button.append(text, mark);
      root.append(button);
    }
  }

  function place() {
    if (!host || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = host.offsetWidth || 400;
    const height = host.offsetHeight || 420;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    let left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    host.style.top = `${Math.max(8, top)}px`;
    host.style.left = `${left}px`;
  }

  function extract(article) {
    const blocks = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
      .map((node) => node.innerText.trim())
      .filter(Boolean);
    const text = blocks.length > 1 ? `${blocks[0]}\n\nQuoted: ${blocks[1]}` : blocks[0] || "";
    const name = article.querySelector('[data-testid="User-Name"]')?.innerText || "";
    const author = name.match(/@\w+/)?.[0] || "them";
    const imageUrls = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img'))
      .map((img) => img.currentSrc || img.src)
      .filter((src) => typeof src === "string" && src.includes("twimg.com"));
    return { text, author, imageUrls };
  }

  function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "apiModel", "extraNotes", "geminiApiKey"],
        (sync) => {
          chrome.storage.local.get(["taste"], (local) => {
            const taste = local.taste || {};
            resolve({
              apiKey: String(sync.apiKey || sync.geminiApiKey || "").trim(),
              model: String(sync.apiModel || ""),
              extraNotes: String(sync.extraNotes || ""),
              keeps: Array.isArray(taste.keeps) ? taste.keeps : [],
              kills: Array.isArray(taste.kills) ? taste.kills : [],
            });
          });
        },
      );
    });
  }

  function template() {
    return `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          max-height: min(560px, calc(100vh - 16px));
          overflow: auto;
          background: #141416;
          color: #f2f2f3;
          border: 1px solid #2c2c31;
          border-radius: 16px;
          padding: 8px;
          box-shadow: 0 16px 40px rgba(0,0,0,0.45);
          font: 400 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .head, .countline, .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .head { padding: 8px 8px 0; }
        h2 { margin: 0; font-size: 14px; font-weight: 600; }
        .meta, .hint, .label, .format-when, .format-mark { color: #71717a; font-size: 12px; }
        .close, .link, .drop, .reroll, .insert, .pick, .format { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; }
        .close { min-width: 44px; min-height: 36px; color: #a1a1aa; }
        .read { margin: 12px 8px 0; padding: 10px 12px; border-radius: 8px; background: #1c1c1f; color: #a1a1aa; font-size: 14px; line-height: 1.45; }
        #warning { margin: 8px 8px 0; color: #d6a24e; font-size: 12px; line-height: 1.45; }
        #cards { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .card { display: flex; gap: 8px; align-items: flex-start; border: 1px solid #2c2c31; background: #0c0c0d; border-radius: 8px; padding: 12px; }
        .card.active { border-color: color-mix(in srgb, #f2f2f3 40%, transparent); }
        .pick { flex: 1; min-width: 0; text-align: left; padding: 0; }
        .body { display: block; margin-top: 4px; font-size: 14px; line-height: 1.45; }
        .drop { color: #71717a; font-size: 12px; padding: 0; }
        .drop:hover { color: #e5484d; }
        .skeleton { height: 72px; border-radius: 8px; background: #1c1c1f; }
        .empty { margin: 8px; color: #a1a1aa; font-size: 14px; }
        .link { min-height: 44px; padding: 0 8px; color: #a1a1aa; font-size: 12px; }
        .format { width: 100%; min-height: 44px; display: flex; justify-content: space-between; gap: 12px; text-align: left; padding: 6px 8px; border-radius: 8px; }
        .format:hover { background: #1c1c1f; }
        .format-name { display: block; font-size: 14px; }
        .format-when { display: block; }
        textarea {
          width: 100%;
          height: 96px;
          margin-top: 4px;
          resize: none;
          border-radius: 8px;
          border: 1px solid #2c2c31;
          background: #0c0c0d;
          color: #f2f2f3;
          padding: 12px;
          font: inherit;
          line-height: 1.45;
        }
        textarea:focus { outline: 2px solid color-mix(in srgb, #f2f2f3 40%, transparent); outline-offset: 1px; }
        .countline { padding: 4px 8px 0; }
        #count { font-size: 12px; font-variant-numeric: tabular-nums; color: #71717a; }
        #count[data-tone="warn"] { color: #d6a24e; }
        #count[data-tone="bad"] { color: #e5484d; }
        .actions { margin-top: 8px; }
        .reroll, .insert { min-height: 44px; border-radius: 8px; }
        .reroll { border: 1px solid #2c2c31; padding: 0 16px; }
        .insert { flex: 1; background: #f2f2f3; color: #141416; font-weight: 600; }
        button:disabled { opacity: 0.4; cursor: default; }
        .foot { margin: 8px 8px 4px; color: #71717a; font-size: 12px; }
      </style>
      <div class="panel" role="dialog" aria-label="Reply drafts">
        <div class="head">
          <div>
            <h2 id="handle">Reply</h2>
            <div class="meta" id="source"></div>
          </div>
          <button class="close" id="close" type="button">Close</button>
        </div>
        <p class="read" id="read"></p>
        <p id="warning" hidden></p>
        <div id="cards"></div>
        <button class="link" id="formats-toggle" type="button">Use a different reply format</button>
        <div id="formats" hidden></div>
        <textarea id="scratch" placeholder="Edit the line before it goes in."></textarea>
        <div class="countline">
          <span id="count"></span>
          <span class="hint">1–3 select</span>
        </div>
        <div class="actions">
          <button class="reroll" id="reroll" type="button">Reroll</button>
          <button class="insert" id="insert" type="button">Insert reply</button>
        </div>
        <p class="foot">You still press Reply. This never posts.</p>
      </div>
    `;
  }
})();
