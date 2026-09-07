// Shared link parsing + URL payload codec.
//
// A batch lives entirely in the URL fragment, so nothing is ever sent to a
// server: `#v1.<base64url(deflate-raw(json))>`, falling back to `#j1.<base64url(json)>`
// when the browser has no CompressionStream.

const V_DEFLATE = "v1";
const V_PLAIN = "j1";

const URL_RE = /https?:\/\/[^\s<>"'`\\]+/i;
const EMOJI_CODE_END = /:[a-z0-9_+-]+:$/i;

/** Trim punctuation that usually belongs to the sentence, not to the link. */
function cleanUrl(raw) {
  let url = raw.replace(/[.,;:!?'"»]+$/, "");
  while (/[)\]]$/.test(url)) {
    const open = (url.match(/[([]/g) || []).length;
    const close = (url.match(/[)\]]/g) || []).length;
    if (close > open) url = url.slice(0, -1);
    else break;
  }
  return url;
}

/** Whatever is left on the line once the link is removed becomes the label. */
function cleanLabel(raw) {
  let label = raw.replace(/\s+/g, " ").trim();
  let previous;
  do {
    previous = label;
    label = label.replace(/^[\s\-–—|•*>#()[\]]+/, "").replace(/[\s\-–—|•*>#()[\]]+$/, "");
    if (label.endsWith(":") && !EMOJI_CODE_END.test(label)) label = label.slice(0, -1);
    label = label.trim();
  } while (label !== previous);
  return label;
}

/**
 * Pull the first link out of every line.
 * @returns {{items: {url: string, label: string}[], skipped: number, duplicates: number}}
 */
export function parseLines(text, { dedupe = true } = {}) {
  const items = [];
  const seen = new Set();
  let skipped = 0;
  let duplicates = 0;

  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(URL_RE);
    if (!match) {
      skipped++;
      continue;
    }
    const url = cleanUrl(match[0]);
    if (dedupe && seen.has(url)) {
      duplicates++;
      continue;
    }
    seen.add(url);
    items.push({ url, label: cleanLabel(line.slice(0, match.index) + " " + line.slice(match.index + match[0].length)) });
  }
  return { items, skipped, duplicates };
}

/** Longest shared prefix of all links, cut back to a path boundary. */
export function commonPrefix(urls) {
  if (urls.length < 2) return "";
  let prefix = urls[0];
  for (const url of urls.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < url.length && prefix[i] === url[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  const cut = prefix.lastIndexOf("/");
  prefix = cut > 0 ? prefix.slice(0, cut + 1) : "";
  return prefix.length >= 12 ? prefix : "";
}

/** Compact wire shape: shared prefix once, then only what differs per link. */
export function buildPayload({ title = "", items = [] }) {
  const prefix = commonPrefix(items.map((item) => item.url));
  return {
    v: 1,
    ...(title.trim() ? { t: title.trim() } : {}),
    ...(prefix ? { p: prefix } : {}),
    i: items.map((item) => {
      const rest = prefix ? item.url.slice(prefix.length) : item.url;
      return item.label ? [rest, item.label] : rest;
    }),
  };
}

/** Wire shape back to usable links, dropping anything that is not http(s). */
export function expandPayload(payload) {
  const prefix = typeof payload?.p === "string" ? payload.p : "";
  const raw = Array.isArray(payload?.i) ? payload.i : [];
  const items = [];
  for (const entry of raw) {
    const [rest, label] = Array.isArray(entry) ? entry : [entry, ""];
    if (typeof rest !== "string") continue;
    const url = prefix + rest;
    if (!/^https?:\/\//i.test(url)) continue;
    items.push({ url, label: typeof label === "string" ? label : "" });
  }
  return { title: typeof payload?.t === "string" ? payload.t : "", items };
}

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/** @returns {Promise<string>} the fragment token, without the leading `#`. */
export async function encode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") {
    try {
      return `${V_DEFLATE}.${toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")))}`;
    } catch {
      /* fall through to the uncompressed form */
    }
  }
  return `${V_PLAIN}.${toBase64Url(bytes)}`;
}

/** @param {string} token a fragment with or without its leading `#`. */
export async function decode(token) {
  const clean = String(token).replace(/^#/, "");
  const dot = clean.indexOf(".");
  if (dot < 1) throw new Error("this link does not carry a batch.");
  const version = clean.slice(0, dot);
  if (version !== V_PLAIN && version !== V_DEFLATE) {
    throw new Error(`unknown batch format "${version.slice(0, 8)}".`);
  }
  if (version === V_DEFLATE && typeof DecompressionStream !== "function") {
    throw new Error("this browser cannot read compressed batches.");
  }

  let payload;
  try {
    const bytes = fromBase64Url(clean.slice(dot + 1));
    const raw = version === V_PLAIN ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"));
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("the link looks damaged or was cut short somewhere along the way.");
  }
  return payload;
}
