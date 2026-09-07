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
  banner: document.getElementById("banner"),
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

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.hidden = false;
}

els.openAll.addEventListener("click", () => {
  els.banner.hidden = true;
  let blockedAt = -1;
  for (const [index] of items.entries()) {
    if (opened.has(index)) continue;
    if (!openTab(items[index].url)) {
      blockedAt = index;
      break;
    }
    opened.add(index);
  }
  if (blockedAt !== -1) {
    stepping = true;
    showBanner(
      opened.size
        ? `Your browser blocked the rest after ${plural(opened.size, "tab")}. Keep pressing the button below to open them one at a time — each press counts as your own click, which browsers always allow.`
        : "Your browser blocked the pop-ups. Use the button below to open them one at a time — each press counts as your own click, which browsers always allow.",
    );
  }
  render();
});

els.openNext.addEventListener("click", () => {
  const index = firstPending();
  if (index === -1) return;
  if (openTab(items[index].url)) {
    opened.add(index);
    els.banner.hidden = true;
  } else {
    showBanner("That tab was blocked too. Allow pop-ups for this site, or use the link in the list below.");
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
