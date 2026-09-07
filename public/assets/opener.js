import { decode, expandPayload } from "/assets/codec.js";

const els = {
  heading: document.getElementById("heading"),
  sub: document.getElementById("sub"),
  panel: document.getElementById("panel"),
  openAll: document.getElementById("openAll"),
  bar: document.getElementById("bar"),
  stepper: document.getElementById("stepper"),
  stepK: document.getElementById("stepK"),
  stepV: document.getElementById("stepV"),
  openNext: document.getElementById("openNext"),
  tip: document.getElementById("tip"),
  banner: document.getElementById("banner"),
  bannerText: document.getElementById("bannerText"),
  howLead: document.getElementById("howLead"),
  howSteps: document.getElementById("howSteps"),
  howOtherList: document.getElementById("howOtherList"),
  retry: document.getElementById("retry"),
  status: document.getElementById("status"),
  oneByOne: document.getElementById("oneByOne"),
  reset: document.getElementById("reset"),
  copyAll: document.getElementById("copyAll"),
  edit: document.getElementById("edit"),
  list: document.getElementById("list"),
  error: document.getElementById("error"),
  errorText: document.getElementById("errorText"),
};

let items = [];
const opened = new Set();
let stepping = false;
const rows = [];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const firstPending = () => items.findIndex((_, index) => !opened.has(index));

// Where each browser hides its "allow pop-ups and redirects" switch. The right
// one is shown first; the rest stay a click away, since sniffing is a guess.
const GUIDES = [
  {
    id: "chrome",
    name: "Chrome, Edge, Brave, Opera",
    match: (ua) => /chrome|crios|edg|opr/i.test(ua) && !/android/i.test(ua),
    steps: [
      "Click the blocked pop-up icon at the right-hand end of the address bar.",
      "Choose “Always allow pop-ups and redirects from this site”.",
      "Click Done, then press the button below.",
    ],
  },
  {
    id: "chrome-android",
    name: "Chrome on Android",
    match: (ua) => /android/i.test(ua) && /chrome|crios/i.test(ua),
    steps: [
      "Tap “Always show” on the pop-ups blocked bar at the bottom.",
      "Or: ⋮ menu → Settings → Site settings → Pop-ups and redirects → Allow.",
      "Then press the button below.",
    ],
  },
  {
    id: "firefox",
    name: "Firefox",
    match: (ua) => /firefox|fxios/i.test(ua),
    steps: [
      "Press Options (or Preferences) on the yellow bar at the top of the page.",
      "Choose “Allow pop-ups for this site”.",
      "Then press the button below.",
    ],
  },
  {
    id: "safari",
    name: "Safari on Mac",
    match: (ua) => /safari/i.test(ua) && !/chrome|crios|edg|opr|android/i.test(ua) && !/iphone|ipad/i.test(ua),
    steps: [
      "Safari menu → Settings → Websites → Pop-up Windows.",
      "Set this site to Allow.",
      "Then press the button below.",
    ],
  },
  {
    id: "safari-ios",
    name: "Safari on iPhone or iPad",
    match: (ua) => /iphone|ipad|ipod/i.test(ua),
    steps: [
      "Open the Settings app → Apps → Safari.",
      "Turn “Block Pop-ups” off.",
      "Come back here and press the button below.",
    ],
  },
];

const FALLBACK = {
  id: "other",
  name: "Most browsers",
  steps: [
    "Open your browser's site settings for this page — usually the icon at the left or right of the address bar.",
    "Allow pop-ups and redirects for this site.",
    "Then press the button below.",
  ],
};

function guides() {
  const ua = navigator.userAgent || "";
  const mine = GUIDES.find((guide) => guide.match(ua)) ?? FALLBACK;
  return { mine, others: [...GUIDES, FALLBACK].filter((guide) => guide.id !== mine.id) };
}

function renderGuide() {
  const { mine, others } = guides();
  els.howLead.textContent = `To open them all in one press, allow pop-ups for this site — in ${mine.name}:`;

  els.howSteps.replaceChildren();
  for (const step of mine.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    els.howSteps.append(li);
  }

  els.howOtherList.replaceChildren();
  for (const guide of others) {
    const term = document.createElement("dt");
    term.textContent = guide.name;
    const detail = document.createElement("dd");
    detail.textContent = guide.steps.join(" ");
    els.howOtherList.append(term, detail);
  }
}

/**
 * Opens one link in a new tab.
 * `noopener` is applied by clearing `opener` afterwards rather than through the
 * features string, because that form makes window.open() always return null and
 * we need its return value to tell a blocked popup from a real one.
 */
function openTab(url) {
  let tab = null;
  try {
    tab = window.open(url, "_blank");
  } catch {
    return false;
  }
  if (!tab) return false;
  try {
    tab.opener = null;
  } catch {
    /* cross-origin window: nothing to clear */
  }
  return true;
}

function markOpened(index) {
  opened.add(index);
  render();
}

function buildList() {
  els.list.replaceChildren();
  rows.length = 0;
  for (const [index, item] of items.entries()) {
    const li = document.createElement("li");

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = index + 1;

    const body = document.createElement("span");
    if (item.label) {
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.label;
      body.append(label);
    }
    const url = document.createElement("span");
    url.className = "url";
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = item.url;
    anchor.addEventListener("click", () => markOpened(index));
    url.append(anchor);
    body.append(url);

    const state = document.createElement("span");
    state.className = "state";

    li.append(num, body, state);
    els.list.append(li);
    rows.push({ li, state });
  }
}

function render() {
  const done = opened.size;
  const total = items.length;
  const pending = firstPending();

  els.bar.style.width = total ? `${(done / total) * 100}%` : "0%";
  els.status.innerHTML = `<b>${done}</b> of <b>${total}</b> opened`;

  for (const [index, row] of rows.entries()) {
    const isDone = opened.has(index);
    row.li.classList.toggle("done", isDone);
    row.li.classList.toggle("current", stepping && index === pending);
    row.state.textContent = isDone ? "opened" : stepping && index === pending ? "next" : "";
  }

  // A quiet heads-up before the first press; the banner takes over afterwards.
  els.tip.hidden = done > 0 || total < 2 || stepping || !els.banner.hidden;

  els.openAll.disabled = pending === -1;
  // While stepping, the one-at-a-time button is the main action.
  els.openAll.classList.toggle("primary", !stepping);
  els.openAll.textContent = pending === -1
    ? "Everything is open"
    : done
      ? `Open the remaining ${plural(total - done, "tab")}`
      : `Open all ${plural(total, "tab")}`;
  els.oneByOne.disabled = stepping || pending === -1;
  els.reset.disabled = done === 0;

  els.stepper.hidden = !stepping;
  if (stepping) {
    if (pending === -1) {
      els.stepK.textContent = "Done";
      els.stepV.textContent = `All ${plural(total, "link")} opened.`;
      els.openNext.disabled = true;
      els.openNext.textContent = "Nothing left to open";
    } else {
      const item = items[pending];
      els.stepK.textContent = `Next · ${pending + 1} of ${total}`;
      els.stepV.textContent = item.label ? `${item.label} — ${item.url}` : item.url;
      els.openNext.disabled = false;
      els.openNext.textContent = `Open link ${pending + 1} of ${total}`;
    }
  }
}

/** @param {boolean} withGuide show the "how to allow pop-ups" instructions. */
function showBanner(text, withGuide = true) {
  els.bannerText.textContent = text;
  els.banner.hidden = false;
  if (withGuide) renderGuide();
}

/** Opens everything still pending, stopping at the first refusal. */
function openRemaining() {
  els.banner.hidden = true;
  const before = opened.size;
  let blocked = false;
  for (const [index] of items.entries()) {
    if (opened.has(index)) continue;
    if (!openTab(items[index].url)) {
      blocked = true;
      break;
    }
    opened.add(index);
  }
  if (blocked) {
    stepping = true;
    const justOpened = opened.size - before;
    showBanner(
      `${justOpened ? `Your browser blocked the rest after ${plural(justOpened, "tab")}.` : "Your browser blocked the pop-ups."} Allow pop-ups for this site to open them all in one press — or use the one-at-a-time button further down, which browsers always allow.`,
    );
  }
  render();
}

els.openAll.addEventListener("click", openRemaining);
els.retry.addEventListener("click", openRemaining);

els.openNext.addEventListener("click", () => {
  const index = firstPending();
  if (index === -1) return;
  if (openTab(items[index].url)) {
    opened.add(index);
    els.banner.hidden = true;
  } else {
    showBanner("That one was blocked too.");
  }
  render();
});

els.oneByOne.addEventListener("click", () => {
  stepping = true;
  els.banner.hidden = true;
  render();
  els.openNext.focus();
});

els.reset.addEventListener("click", () => {
  opened.clear();
  els.banner.hidden = true;
  render();
});

let copyResetTimer;
els.copyAll.addEventListener("click", async () => {
  const text = items.map((item) => item.url).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    els.copyAll.textContent = "Copied";
  } catch {
    els.copyAll.textContent = "Copy failed";
  }
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => (els.copyAll.textContent = "Copy all links"), 1600);
});

function fail(message) {
  els.errorText.textContent = message;
  els.error.hidden = false;
  els.heading.textContent = "Nothing to open";
  els.sub.textContent = "";
}

async function load() {
  if (!location.hash || location.hash.length < 3) {
    fail("This link carries no batch. Build one first.");
    return;
  }
  let batch;
  try {
    batch = expandPayload(await decode(location.hash));
  } catch (error) {
    fail(`This batch could not be read — ${error.message}`);
    return;
  }
  items = batch.items;
  if (!items.length) {
    fail("This batch is empty.");
    return;
  }

  els.heading.textContent = batch.title || `${plural(items.length, "link")} ready`;
  els.sub.textContent = batch.title ? `${plural(items.length, "link")} ready to open.` : "";
  document.title = `${batch.title || plural(items.length, "link")} · Batch Link Opener`;
  els.edit.href = `/${location.hash}`;

  buildList();
  els.panel.hidden = false;
  render();
}

await load();
