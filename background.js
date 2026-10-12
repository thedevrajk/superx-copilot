importScripts("reply-brain.js");

const brain = globalThis.SuperXBrain;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "GENERATE_REPLIES") {
    generate(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const text = error instanceof Error ? error.message : "API request failed.";
        sendResponse({ ok: false, error: text });
      });
    return true;
  }
  if (message.type === "OPEN_POST" && sender.tab?.id) {
    const tabId = sender.tab.id;
    const payload = message.payload || {};
    const pendingPost = { ...payload, at: Date.now() };
    const opened = chrome.sidePanel.open({ tabId });
    chrome.storage.session.set({ pendingPost }).catch(() => {});
    opened
      .then(() => {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "OPEN_POST", payload: pendingPost }).catch(() => {});
        }, 60);
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({
          ok: false,
          error: "Click the SuperX icon in the toolbar. This post is already loaded.",
        });
      });
    return true;
  }
});

async function generate(payload) {
  const stored = await chrome.storage.sync.get([
    "apiBaseUrl",
    "apiModel",
    "apiFormat",
    "apiAuth",
    "apiKey",
    "apiJsonMode",
    "extraNotes",
    "geminiApiKey",
  ]);

  const apiKey = String(stored.apiKey || stored.geminiApiKey || "").trim();
  if (!apiKey) throw new Error("Add an API key in Settings. No reply is written without one.");

  const baseUrl = String(stored.apiBaseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const model = String(stored.apiModel || "gemini-3.8-flash").trim();
  const format = stored.apiFormat === "openai" ? "openai" : "gemini";
  const auth = stored.apiAuth === "bearer" ? "bearer" : "query";
  const jsonMode = stored.apiJsonMode !== false;

  const text = String(payload?.text || "").trim();
  const author = String(payload?.author || "them");
  const formatIds = Array.isArray(payload?.formatIds) ? payload.formatIds : [];
  const read = brain.deconstruct(text);
  const ids = formatIds.length ? formatIds : brain.formatsFor(read.kind);
  const image = await maybeImage(payload?.imageUrls);

  const prompt = brain.buildPrompt({
    read,
    formatIds: ids,
    author,
    keeps: Array.isArray(payload?.keeps) ? payload.keeps : [],
    kills: Array.isArray(payload?.kills) ? payload.kills : [],
    extraNotes: String(stored.extraNotes || payload?.extraNotes || ""),
    imageAttached: Boolean(image),
  });

  const raw =
    format === "openai"
      ? await callOpenAI({ baseUrl, model, auth, apiKey, prompt, image, jsonMode, temperature: Number(payload?.temperature) || 0.7 })
      : await callGemini({ baseUrl, model, auth, apiKey, prompt, image, jsonMode, temperature: Number(payload?.temperature) || 0.7 });

  if (!raw.trim()) throw new Error("The model returned nothing.");

  const options = repliesFromModel(raw, ids);
  if (!options.length) throw new Error("The model returned no usable reply. Try again.");

  await trackUsage(raw.length + prompt.length);

  return {
    options,
    imageAttached: Boolean(image),
    model,
  };
}

function repliesFromModel(raw, formatIds) {
  const parsed = brain.parseModelJson(raw);
  const matched = [];
  for (const id of formatIds) {
    const format = brain.formatById(id);
    const hit = parsed.find((item) => brain.matchFormat(item.format)?.id === id);
    if (hit?.text) matched.push({ formatId: id, formatName: format.name, text: hit.text });
  }
  if (matched.length) return matched;
  return parsed
    .filter((item) => item.text)
    .slice(0, 3)
    .map((item) => ({
      formatId: brain.matchFormat(item.format)?.id || "reply",
      formatName: brain.matchFormat(item.format)?.name || item.format || "Reply",
      text: item.text,
    }));
}

async function callGemini({ baseUrl, model, auth, apiKey, prompt, image, jsonMode, temperature }) {
  const url = new URL(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`);
  if (auth === "query") url.searchParams.set("key", apiKey);

  const headers = { "Content-Type": "application/json" };
  if (auth === "bearer") headers.Authorization = `Bearer ${apiKey}`;

  const parts = [];
  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }
  parts.push({ text: prompt });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: 512,
        ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    const message = body?.error?.message || "Gemini-style request refused.";
    throw new Error(String(message).replace(apiKey, "…"));
  }
  return body?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function callOpenAI({ baseUrl, model, auth, apiKey, prompt, image, jsonMode, temperature }) {
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  const url = new URL(endpoint);
  if (auth === "query") url.searchParams.set("key", apiKey);

  const headers = { "Content-Type": "application/json" };
  if (auth === "bearer") headers.Authorization = `Bearer ${apiKey}`;

  const content = [{ type: "text", text: prompt }];
  if (image) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    });
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: 512,
      messages: [{ role: "user", content }],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    const message = body?.error?.message || body?.message || "OpenAI-style request refused.";
    throw new Error(String(message).replace(apiKey, "…"));
  }
  return body?.choices?.[0]?.message?.content || "";
}

async function trackUsage(approxTokens) {
  const day = new Date().toISOString().slice(0, 10);
  const stored = await chrome.storage.local.get(["usage"]);
  const usage = stored.usage || {};
  const today = usage[day] || { requests: 0, tokens: 0 };
  today.requests += 1;
  today.tokens += Math.round(approxTokens / 4);
  usage[day] = today;
  await chrome.storage.local.set({ usage });
}

async function maybeImage(urls) {
  const first = Array.isArray(urls) ? urls.find((url) => typeof url === "string" && url.startsWith("https://")) : "";
  if (!first) return null;
  try {
    const optimized = shrink(first);
    const response = await fetch(optimized);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size || blob.size > 1_500_000) return null;
    const data = await blobToBase64(blob);
    return {
      mimeType: blob.type || "image/jpeg",
      data,
    };
  } catch {
    return null;
  }
}

function shrink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("name")) parsed.searchParams.set("name", "medium");
    return parsed.toString();
  } catch {
    return url;
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
