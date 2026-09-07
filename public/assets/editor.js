import { parseLines, buildPayload, encode, decode, expandPayload } from "/assets/codec.js";

const els = {
  input: document.getElementById("input"),
  title: document.getElementById("title"),
  dedupe: document.getElementById("dedupe"),
  status: document.getElementById("status"),
  preview: document.getElementById("preview"),
  out: document.getElementById("out"),
  link: document.getElementById("link"),
  copy: document.getElementById("copy"),
  open: document.getElementById("open"),
  hint: document.getElementById("hint"),
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function renderPreview(items) {
  els.preview.replaceChildren();
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
    url.textContent = item.url;
    body.append(url);
    li.append(num, body, document.createElement("span"));
    els.preview.append(li);
  }
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const { items, skipped, duplicates } = parseLines(els.input.value, { dedupe: els.dedupe.checked });

  const notes = [];
  if (duplicates) notes.push(`${plural(duplicates, "duplicate")} skipped`);
  if (skipped) notes.push(`${plural(skipped, "line")} without a link ignored`);
  els.status.innerHTML = items.length
    ? `<b>${items.length}</b> link${items.length === 1 ? "" : "s"} found${notes.length ? " · " + notes.join(" · ") : ""}`
    : "Nothing to open yet.";

  renderPreview(items);

  if (!items.length) {
    els.out.hidden = true;
    return;
  }

  const fragment = await encode(buildPayload({ title: els.title.value, items }));
  if (token !== renderToken) return;

  const url = `${location.origin}/open#${fragment}`;
  els.link.value = url;
  els.open.href = `/open#${fragment}`;
  els.hint.textContent = `${url.length} characters long${url.length > 6000 ? " — long enough that some chat apps may cut it; consider splitting the batch." : "."}`;
  els.out.hidden = false;
}

let copyResetTimer;
els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.link.value);
  } catch {
    els.link.select();
    document.execCommand("copy");
  }
  els.copy.textContent = "Copied";
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => (els.copy.textContent = "Copy link"), 1600);
});

for (const el of [els.input, els.title]) el.addEventListener("input", render);
els.dedupe.addEventListener("change", render);

// A batch link dropped on the editor loads back into the textarea, so an
// existing batch can be edited and re-shared.
async function loadFromHash() {
  if (!location.hash || location.hash.length < 3) return false;
  try {
    const { title, items } = expandPayload(await decode(location.hash));
    els.title.value = title;
    els.input.value = items.map((item) => (item.label ? `${item.label} ${item.url}` : item.url)).join("\n");
    return true;
  } catch {
    return false;
  }
}

await loadFromHash();
await render();
