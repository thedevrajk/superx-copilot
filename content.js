(() => {
  const ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';

  const observer = new MutationObserver(() => {
    clearTimeout(window.__superxDebounce);
    window.__superxDebounce = setTimeout(inject, 200);
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
        if (!article) return;
        chrome.runtime.sendMessage({
          type: "OPEN_POST",
          payload: extract(article),
        });
      });
      bar.append(button);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "INSERT_REPLY" || !message.text) return;
    const box = document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"]');
    if (box instanceof HTMLElement) {
      box.focus();
      document.execCommand("insertText", false, message.text);
    } else {
      navigator.clipboard.writeText(message.text);
    }
  });

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
})();
