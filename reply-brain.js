"use strict";
var SuperXBrain = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/reply-brain.ts
  var reply_brain_exports = {};
  __export(reply_brain_exports, {
    FORMATS: () => FORMATS,
    REPLY_MODEL: () => REPLY_MODEL,
    buildPrompt: () => buildPrompt,
    deconstruct: () => deconstruct,
    draftsFromModel: () => draftsFromModel,
    formatById: () => formatById,
    formatsFor: () => formatsFor,
    localDrafts: () => localDrafts,
    localOne: () => localOne,
    matchFormat: () => matchFormat,
    parseModelJson: () => parseModelJson,
    replaceFormat: () => replaceFormat,
    sanitizeReply: () => sanitizeReply
  });
  var FORMATS = [
    {
      id: "specific-delta",
      name: "Specific delta",
      when: "A chart or a number is doing the talking.",
      structure: "Name the figure that matters, then the implication they skipped.",
      not: "Do not recap the chart.",
      fits: ["metric", "code"]
    },
    {
      id: "scar",
      name: "Scar, then nuance",
      when: "A launch, a win, or a build log.",
      structure: "One scar from shipping, then the half their post left out.",
      not: "Do not congratulate them.",
      fits: ["metric", "ui", "code", "claim", "question", "bit"]
    },
    {
      id: "premise",
      name: "Premise, not conclusion",
      when: "A strong claim.",
      structure: "Leave the conclusion. Name the assumption it stands on.",
      not: "Do not write a quote-tweet essay.",
      fits: ["claim", "metric", "bit"]
    },
    {
      id: "constraint",
      name: "Constraint question",
      when: "Advice, or a question missing a limit.",
      structure: "Ask the constraint that makes the advice true or false.",
      not: "Do not say it depends and stop there.",
      fits: ["question", "claim", "ui"]
    },
    {
      id: "failure-mode",
      name: "Failure mode",
      when: "Code, agents, or a stack choice.",
      structure: "Name how this breaks. Skip the stack compliment.",
      not: "Do not write a tutorial.",
      fits: ["code", "question"]
    },
    {
      id: "hierarchy",
      name: "Hierarchy note",
      when: "A screen or a flow.",
      structure: "One call on order, spacing, or the primary action, and what it does to the user.",
      not: "Do not say the UI looks clean.",
      fits: ["ui"]
    },
    {
      id: "dry-bit",
      name: "Dry bit",
      when: "A joke or a pose.",
      structure: "One dry line. Do not explain the joke.",
      not: "Do not caption it.",
      fits: ["bit"]
    }
  ];
  var KIND_LABEL = {
    metric: "Metric",
    ui: "Interface",
    code: "Build log",
    claim: "Claim",
    question: "Question",
    bit: "Bit"
  };
  var BY_KIND = {
    metric: ["specific-delta", "scar", "premise"],
    ui: ["hierarchy", "constraint", "scar"],
    code: ["failure-mode", "specific-delta", "scar"],
    claim: ["premise", "constraint", "scar"],
    question: ["constraint", "failure-mode", "scar"],
    bit: ["dry-bit", "premise", "scar"]
  };
  var SAFE = {
    "specific-delta": "Name the number under the headline. The headline is already written.",
    scar: "The useful half is the part they left out.",
    premise: "Leave the conclusion. Name the assumption under it.",
    constraint: "Ask for the constraint that makes this false.",
    "failure-mode": "Name how it breaks, not which tool they used.",
    hierarchy: "Say which element should win the screen, and why it does not.",
    "dry-bit": "Not going to explain it."
  };
  function formatById(id) {
    const found = FORMATS.find((format) => format.id === id);
    if (!found) throw new Error(`Unknown format ${id}`);
    return found;
  }
  function formatsFor(kind) {
    return BY_KIND[kind].slice();
  }
  function replaceFormat(current, index, next) {
    if (current[index] === next) return current;
    if (current.includes(next)) {
      const copy2 = current.slice();
      const other = copy2.indexOf(next);
      copy2[other] = copy2[index];
      copy2[index] = next;
      return copy2;
    }
    const copy = current.slice();
    copy[index] = next;
    return copy;
  }
  function unique(values) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const value of values) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }
  function firstSentence(text) {
    const match = text.match(/^.*?[.!?](?=\s|$)/);
    const sentence = (match?.[0] ?? text).replace(/[.!?]+$/, "").trim();
    return sentence || text.trim();
  }
  function classify(raw) {
    const text = raw.toLowerCase();
    if (/(\$|\bmrr\b|\barr\b|\bchurn\b|\brevenue\b)/.test(text) && /\d/.test(text)) return "metric";
    if (/\b(onboarding|spacing|hierarchy|button|layout|screen|pixel|pricing)\b/.test(text)) return "ui";
    if (/\b(error|stack|api|function|loop|terminal|deploy|agent|bug|timeout|regex|tool call)\b/.test(text)) {
      return "code";
    }
    if (/\?\s*$/.test(raw.trim()) || /\b(what|how|which|anyone)\b.+\?/.test(text)) return "question";
    if (/\b(me explaining|pov:|nobody:|this is fine)\b/.test(text)) return "bit";
    return "claim";
  }
  function situationOf(raw, kind) {
    const text = raw.toLowerCase();
    if (/(\bmrr\b|\bchurn\b)/.test(text) && /\$\d/.test(text)) return "mrr-mix";
    if (/(onboarding|pricing)/.test(text) && /step/.test(text)) return "pricing-step";
    if (kind === "bit") return "rewrite-bit";
    if (/landing page/.test(text)) return "no-landing";
    if (/loop/.test(text) && /(agent|tool call)/.test(text)) return "agent-loop";
    if (/auth/.test(text) && /table/.test(text)) return "auth-table";
    return "generic";
  }
  function summarize(read) {
    if (read.situation === "mrr-mix" && read.plan && read.numbers.some((n) => n.includes("%"))) {
      const churn = read.numbers.find((n) => n.includes("%"));
      return `Metric. ${churn} on the ${read.plan} plan matters more than the headline figure.`;
    }
    if (read.situation === "pricing-step") {
      return "Interface. The price shows up before the product has done anything.";
    }
    if (read.situation === "no-landing") {
      return "Claim. Distribution is being asked to replace an offer.";
    }
    if (read.situation === "agent-loop") {
      return "Build log. A step cap is a budget. The failure is a repeated call inside it.";
    }
    if (read.situation === "auth-table") {
      return "Question. They want to skip a users table. The constraint is who owns the failure.";
    }
    if (read.situation === "rewrite-bit") {
      return "A bit. Do not explain it. The delay is the point.";
    }
    if (read.kind === "metric") return "Metric. Reply to the number under the headline, not the headline.";
    if (read.kind === "ui") return "Interface. Talk about order or the primary action, not whether it looks clean.";
    if (read.kind === "code") return "Build log. Name how it breaks. Do not compliment the stack.";
    if (read.kind === "question") return "Question. A useful reply names the constraint they left out.";
    if (read.kind === "bit") return "A bit. Do not explain the joke.";
    return "Claim. Reply to the assumption, not the slogan.";
  }
  function deconstruct(text) {
    const raw = text.replace(/\s+/g, " ").trim();
    const kind = classify(raw);
    const numbers = unique(raw.match(/\$\d+(?:\.\d+)?k?|\d+(?:\.\d+)?%/gi) ?? []);
    const planMatch = raw.match(/\$\d{1,3}(?![\d.]|\s*k)/i);
    const plan = planMatch?.[0] ?? null;
    const stripped = raw.replace(/\$\d+(?:\.\d+)?k?/gi, " ").replace(/\d+(?:\.\d+)?%/g, " ");
    const cap = kind === "code" ? stripped.match(/\b\d{1,2}\b/)?.[0] ?? null : null;
    const headline = firstSentence(raw);
    const base = {
      kind,
      kindLabel: KIND_LABEL[kind],
      situation: situationOf(raw, kind),
      headline,
      numbers,
      plan,
      cap,
      doNotRepeat: unique([headline, ...numbers]).slice(0, 4),
      raw
    };
    return { ...base, summary: summarize(base) };
  }
  function moneyOf(read) {
    return read.numbers.find((n) => /k/i.test(n)) ?? read.numbers.find((n) => n.startsWith("$")) ?? null;
  }
  function percentOf(read) {
    return read.numbers.find((n) => n.includes("%")) ?? null;
  }
  var SPECIFIC = {
    "mrr-mix": {
      "specific-delta": (read) => {
        const churn = percentOf(read) ?? "the churn";
        const money = moneyOf(read) ?? "the top line";
        const plan = read.plan ?? "the cheap plan";
        return [
          `${churn} on the ${plan} plan is the post. ${money} is the screenshot.`,
          `If the leak is the ${plan} plan, posting ${money} does not fix the mix.`,
          `Split ${churn} by plan before calling ${money} a milestone.`
        ];
      },
      scar: (read) => {
        const money = moneyOf(read) ?? "the top line";
        const plan = read.plan ?? "the cheap plan";
        return [
          `I would post ${money} too. I would hide ${plan} until someone asked.`,
          `The scar is not missing ${money}. It is noticing ${plan} a month late.`,
          `The top line is easy to ship. The plan mix is the half I usually cut.`
        ];
      },
      premise: (read) => {
        const money = moneyOf(read) ?? "a top line";
        return [
          `${money} is a mix, not a verdict. One cheap plan can fake a healthy chart.`,
          `Growth here assumes the leak is normal. It might be the product.`,
          `A chart is evidence of who paid. It is not evidence they will stay.`
        ];
      }
    },
    "pricing-step": {
      hierarchy: () => [
        "Pricing on step 2 asks for trust before the product has done anything.",
        "Three steps is not the issue. The price arrives before a felt result.",
        "Move the cost to after they have seen it work. Right now the order is pay, then understand."
      ],
      constraint: () => [
        "Does step 2 still work if the visitor has not felt the product yet?",
        "Who is this flow for, someone comparing price or someone already convinced?",
        "If the only decision on step 2 is price, the earlier step did not earn it."
      ],
      scar: () => [
        "I have shipped the short flow that asks for money before the first win. People stall.",
        "Fewer steps felt faster in the file. On the live product it just reached the price sooner.",
        "The scar is a clean three-step flow that loses them at the number."
      ]
    },
    "no-landing": {
      premise: () => [
        "You can skip the page. You cannot skip the offer the page was supposed to make.",
        "A screenshot is evidence. It is not a promise. The channel still needs the promise.",
        "Posting daily works after the offer is sharp. It does not create the offer."
      ],
      constraint: () => [
        "This is true for whom, someone with a sharp offer or someone still looking for one?",
        "If the screenshot is the whole pitch, what does a stranger do after they see it?",
        "Daily posts replace a page only if the post itself can close. Can it?"
      ],
      scar: () => [
        "I tried to let the chart do the selling. It brought nods, not buyers.",
        "Skipping the page was easy. Explaining the offer in public was the actual work.",
        "The screenshot got replies. The offer, once I wrote it down, got the payments."
      ]
    },
    "agent-loop": {
      "failure-mode": (read) => {
        const cap = read.cap ?? "a few";
        return [
          `A cap of ${cap} stops the bill. It does not stop ${cap} copies of the same bad call.`,
          "The stop condition has to live outside the model that is looping.",
          "Max steps is a budget. Repeating one tool call will spend the whole budget."
        ];
      },
      "specific-delta": (read) => {
        const cap = read.cap ?? "the cap";
        return [
          `${cap} steps is a spend limit, not a correctness check.`,
          `The useful number is not ${cap}. It is how many of those steps were the same call.`,
          "A written stop the model also enforces is still the model. Something else has to count."
        ];
      },
      scar: () => [
        "I capped a loop and called it fixed. The trace was the same call, four times.",
        "The bill dropped. The task still failed. I had limited the wrong thing.",
        "A stop condition I wrote in the prompt was the first thing the loop ignored."
      ]
    },
    "auth-table": {
      constraint: () => [
        "Who gets paged when a session leaks, you or the vendor?",
        "You still own the logout bug. The users table is the smaller decision.",
        "Are you avoiding the table, or avoiding a password reset at 1am?"
      ],
      "failure-mode": () => [
        "The break is a session you cannot revoke because the vendor is the only one who can see it.",
        "It fails when you need to ban one account and the vendor gives you a ticket form.",
        "Skipping the table is fine until you need a user the vendor has not modeled."
      ],
      scar: () => [
        "I skipped the table, then needed one column the vendor does not have.",
        "The setup was an afternoon. The lockout email was the real project.",
        "Not owning users felt light until the first 'I cannot log in' that I could not see."
      ]
    },
    "rewrite-bit": {
      "dry-bit": () => [
        "The rewrite is the delay. Ship the offer you already have.",
        "One more pass is not a strategy. It is a way to stay unpublished.",
        "Ship the page you are explaining. The explanation is the avoidance."
      ],
      premise: () => [
        "Another rewrite assumes the words are the blocker. Usually the offer is.",
        "The page is not unfinished. The decision under it is.",
        "Polish is the premise. Distribution of a weak offer is the actual risk."
      ],
      scar: () => [
        "I have rewritten a page to avoid deciding what it sells.",
        "The last rewrite felt serious. It did not change who the page was for.",
        "I know this one. The file gets cleaner and the launch date moves."
      ]
    }
  };
  var GENERIC = {
    "specific-delta": (read) => {
      const [first, second] = read.numbers;
      if (first && second) {
        return [
          `${first} is the headline. ${second} is the part a reply can add.`,
          `Between ${first} and ${second}, only one of them changes a decision.`,
          `Do not restate ${first}. Say what ${second} does to the story.`
        ];
      }
      if (first) {
        return [
          `${first} is doing more work than the sentence around it. Say what it changes.`,
          `The reply is not ${first}. It is the limit hiding under that number.`,
          `${first} without a cohort is a mood. Name who it applies to.`
        ];
      }
      return [
        "There is a specific under this sentence. Name it, do not nod.",
        "Pick one concrete noun in this post and say what it changes.",
        "A vague reply here is a second copy of the post. Add the missing detail."
      ];
    },
    scar: (read) => [
      "The flattering half is the sentence they wrote. The reply is the half they skipped.",
      `I know this version of "${clip(read.headline, 48)}". It reads well because the hard part got cut.`,
      "The post is the win. The useful reply is the cost that did not fit."
    ],
    premise: (read) => [
      `This only holds if the cause is really "${clip(read.headline, 56)}", not a side effect.`,
      "Leave the conclusion alone. The premise is the part that is undefended.",
      "Restating this would be a second post. Answer the assumption instead."
    ],
    constraint: () => [
      "What limit makes this false? Time, money, or a user you will not support?",
      "It is true under a constraint they did not name. Ask for that.",
      "If the budget is small and the timeline is this week, does the advice survive?"
    ],
    "failure-mode": (read) => {
      const cap = read.cap;
      if (cap) {
        return [
          `A limit of ${cap} caps the cost. It does not stop a repeated mistake inside the limit.`,
          "The happy path is the post. The break is the same step running twice with no outside stop.",
          "Name the break, not the tool. The announcement is not the failure mode."
        ];
      }
      return [
        "The happy path is the post. The break is the same step running twice with no outside stop.",
        "Name the break, not the tool. Tools rarely fail the way the announcement implies.",
        "This breaks when the retry is identical to the attempt. Something else has to notice."
      ];
    },
    hierarchy: (read) => {
      if (/primary button/i.test(read.raw)) {
        return [
          "One primary button only works if the next step does not introduce a second decision.",
          "The button is not the hierarchy. The order of decisions is.",
          "If a later step asks for money or a new choice, the button was not primary."
        ];
      }
      return [
        "The primary action is competing with everything else. That is hierarchy, not polish.",
        "If the eye does not land on one action, spacing will not save the screen.",
        "Say which element should win, and what the user does if it does not."
      ];
    },
    "dry-bit": () => [
      "Not going to explain it.",
      "Yeah. And then it still does not ship.",
      "I have written the long version of this. It was worse."
    ]
  };
  function clip(value, max) {
    if (value.length <= max) return value;
    const cut = value.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return (space > 24 ? cut.slice(0, space) : cut).trim();
  }
  function linesFor(read, id) {
    const bank = SPECIFIC[read.situation]?.[id]?.(read) ?? GENERIC[id](read);
    return bank.filter((line) => line.trim().length > 0);
  }
  function sanitizeReply(text) {
    let next = text.replace(/\s+/g, " ").trim();
    next = next.replace(/[—–]/g, ",");
    next = next.replace(/!+/g, ".");
    next = next.replace(/#\w+/g, "");
    next = next.replace(/https?:\/\/\S+/g, "");
    next = next.replace(
      /^(great point|totally agree|spot on|love this|so true|100%|couldn'?t agree more|this is fire|game changer)[,.\s:-]*/i,
      ""
    );
    next = next.replace(
      /\b(game-changer|delve|unlock|supercharge|leverage|seamless|tapestry|vibe coding|buckle up)\b/gi,
      ""
    );
    next = next.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/\.{2,}/g, ".").trim();
    return next;
  }
  function localOne(read, id, salt) {
    const format = formatById(id);
    const bank = linesFor(read, id);
    const picked = bank[Math.abs(salt) % bank.length] ?? SAFE[id];
    const text = sanitizeReply(picked) || SAFE[id];
    return { formatId: id, formatName: format.name, text };
  }
  function localDrafts(read, ids, salt) {
    return ids.map((id) => localOne(read, id, salt));
  }
  function matchFormat(name) {
    const normalized = name.trim().toLowerCase();
    return FORMATS.find(
      (format) => format.id === normalized || format.name.toLowerCase() === normalized || normalized.includes(format.name.toLowerCase())
    );
  }
  function parseModelJson(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return [];
      try {
        data = JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    if (!data || typeof data !== "object") return [];
    const options = data.options;
    if (!Array.isArray(options)) return [];
    const parsed = [];
    for (const item of options) {
      if (!item || typeof item !== "object") continue;
      const format = String(item.format ?? "");
      const text = sanitizeReply(String(item.text ?? ""));
      if (!format || !text) continue;
      parsed.push({ format, text });
    }
    return parsed;
  }
  function draftsFromModel(raw, formatIds, read, salt) {
    const parsed = parseModelJson(raw);
    return formatIds.map((id, index) => {
      const format = formatById(id);
      const hit = parsed.find((item) => matchFormat(item.format)?.id === id);
      if (hit?.text) return { formatId: id, formatName: format.name, text: hit.text };
      return localOne(read, id, salt + index + 11);
    });
  }
  function buildPrompt(input) {
    const formats = input.formatIds.map((id) => formatById(id));
    const lines = [
      "You write replies on X. A reply is not a post.",
      "A post sells a structure: hook, story, lesson, ask.",
      "A reply adds one detail the source skipped. It does not restate the source and it does not borrow a post structure.",
      "",
      "LOCKED RAILS",
      "- 1 or 2 sentences. Prefer under 180 characters. Never over 260.",
      "- Do not paraphrase. Do not quote the post back.",
      "- Never open with agreement, praise, or filler.",
      "- No exclamation marks, hashtags, links, or em dashes.",
      "- Banned words: vibe coding, game-changer, delve, unlock, supercharge, leverage, seamless, tapestry, buckle up.",
      "- No emoji.",
      "- Voice: a blunt peer who designs and ships software. Specific. Not a coach."
    ];
    const notes = input.extraNotes.trim();
    if (notes) {
      lines.push("", "EXTRA VOICE NOTES (do not override the locked rails)", notes.slice(0, 600));
    }
    lines.push(
      "",
      "SOURCE READ (trust this)",
      `- kind: ${input.read.kindLabel}`,
      `- read: ${input.read.summary}`,
      `- do not repeat: ${input.read.doNotRepeat.join(" | ") || "(none)"}`
    );
    if (input.imageAttached) {
      lines.push(
        "- An image is attached. Name a specific thing in the image.",
        "- Chart: the ugly number, not the headline.",
        "- UI: hierarchy, spacing, or the primary action.",
        "- Code: the failure.",
        "- Meme: one dry reaction. Do not explain the joke."
      );
    }
    lines.push("", `Post by ${input.author}:`, input.read.raw, "", "WRITE ONE REPLY PER FORMAT. Do not blend them.");
    for (const format of formats) {
      lines.push(`- ${format.name}: ${format.structure} ${format.not}`);
    }
    const keeps = input.keeps.map((item) => item.trim()).filter(Boolean).slice(-2);
    const kills = input.kills.map((item) => item.trim()).filter(Boolean).slice(-3);
    if (keeps.length) {
      lines.push("", "CLOSER IN LENGTH AND BITE. Do not copy:");
      for (const keep of keeps) lines.push(`- ${keep}`);
    }
    if (kills.length) {
      lines.push("", "DO NOT WRITE LIKE:");
      for (const kill of kills) lines.push(`- ${kill}`);
    }
    lines.push("", 'Return JSON only: {"options":[{"format":"<format name>","text":"<reply>"}]}');
    return lines.join("\n");
  }
  var REPLY_MODEL = "gemini-3.8-flash";
  return __toCommonJS(reply_brain_exports);
})();
globalThis.SuperXBrain = SuperXBrain;
