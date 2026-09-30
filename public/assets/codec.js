// Shared link parsing + URL payload codec.
//
// A batch lives entirely in the URL fragment, so nothing is ever sent to a
// server: `#v1.<base64url(deflate-raw(json))>`, falling back to `#j1.<base64url(json)>`
// when the browser has no CompressionStream.
//
// Two more forms carry the list as plain text, one link per line, so other
// tools can build a link without deflate or JSON: `#b1.<base64(text)>` and
// `#u1.<encodeURIComponent(text)>`.

const V_DEFLATE = "v1";
const V_PLAIN = "j1";
const V_BASE64 = "b1";
const V_URI = "u1";
const VERSIONS = [V_DEFLATE, V_PLAIN, V_BASE64, V_URI];

const TITLE_MARK = "# ";

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

/** Plain-text form of a batch: an optional `# title` line, then one link per line. */
export function toListText({ title = "", items = [] }) {
  const lines = items.map((item) => (item.label ? `${item.url} ${item.label}` : item.url));
  if (title.trim()) lines.unshift(TITLE_MARK + title.trim());
  return lines.join("\n");
}

/** Reads the plain-text form with the editor's own line parser, into the wire shape. */
export function fromListText(text) {
  const lines = String(text).split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim());
  let title = "";
  if (first !== -1 && lines[first].startsWith(TITLE_MARK)) {
    title = lines[first].slice(TITLE_MARK.length).trim();
    lines.splice(0, first + 1);
  }
  const { items } = parseLines(lines.join("\n"));
  return {
    v: 1,
    ...(title ? { t: title } : {}),
    i: items.map((item) => (item.label ? [item.url, item.label] : item.url)),
  };
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

/**
 * decodeURIComponent that never throws: a `%` that does not start a valid
 * escape, or escapes that are not UTF-8, are left as they are, and everything
 * around them is still decoded.
 */
function decodeUriLoose(text) {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // Salvage the run one character at a time: a UTF-8 character is one to
      // four escapes, three characters each.
      let out = "";
      for (let i = 0; i < run.length; ) {
        let size = 12;
        for (; size > 0; size -= 3) {
          try {
            out += decodeURIComponent(run.slice(i, i + size));
            break;
          } catch {
            /* try a shorter sequence */
          }
        }
        if (!size) out += run.slice(i, i + (size = 3));
        i += size;
      }
      return out;
    }
  });
}

/** encodeURIComponent, plus the few characters chat apps like to cut a link at. */
function encodeUri(text) {
  const safe = typeof text.toWellFormed === "function" ? text.toWellFormed() : text;
  return encodeURIComponent(safe).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Standard or URL-safe alphabet, padded or not, even if something escaped the `=`. */
function fromBase64Any(text) {
  return fromBase64Url(decodeUriLoose(text).replace(/\s+/g, "").replace(/=+$/, ""));
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A batch as one of the plain-list fragments.
 * @param {"b1" | "u1"} format
 * @returns {string} the fragment token, without the leading `#`.
 */
export function encodeList(batch, format) {
  const text = toListText(batch);
  if (format === V_URI) return `${V_URI}.${encodeUri(text)}`;
  return `${V_BASE64}.${toBase64Url(new TextEncoder().encode(text))}`;
}

/** @returns {string} the format tag of a fragment, or "" when it has none we know. */
export function formatOf(token) {
  const version = String(token).replace(/^#/, "").split(".")[0];
  return VERSIONS.includes(version) ? version : "";
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
  if (!VERSIONS.includes(version)) {
    throw new Error(`unknown batch format "${version.slice(0, 8)}".`);
  }
  if (version === V_DEFLATE && typeof DecompressionStream !== "function") {
    throw new Error("this browser cannot read compressed batches.");
  }

  const body = clean.slice(dot + 1);
  if (version === V_URI) return fromListText(decodeUriLoose(body));

  let payload;
  try {
    if (version === V_BASE64) return fromListText(new TextDecoder().decode(fromBase64Any(body)));
    const bytes = fromBase64Url(body);
    const raw = version === V_PLAIN ? bytes : await pipe(bytes, new DecompressionStream("deflate-raw"));
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("the link looks damaged or was cut short somewhere along the way.");
  }
  return payload;
}
