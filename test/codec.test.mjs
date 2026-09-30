import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseLines,
  commonPrefix,
  buildPayload,
  expandPayload,
  encode,
  encodeList,
  formatOf,
  decode,
} from "../public/assets/codec.js";

const MR = (n) => `https://gitlab.com/acme/web/-/merge_requests/${n}`;

test("takes the link out of a line and keeps the rest as its label", () => {
  const { items } = parseLines(`:rocket: ${MR(1421)}`);
  assert.deepEqual(items, [{ url: MR(1421), label: ":rocket:" }]);
});

test("keeps the trailing colon of an emoji code but drops a sentence colon", () => {
  const { items } = parseLines(`Ticket: ${MR(1)}\n:bug: ${MR(2)}`);
  assert.deepEqual(items.map((item) => item.label), ["Ticket", ":bug:"]);
});

test("leaves sentence punctuation and wrapping brackets out of the link", () => {
  const { items } = parseLines(`see (${MR(1500)}).`);
  assert.deepEqual(items, [{ url: MR(1500), label: "see" }]);
});

test("keeps parentheses that belong to the link itself", () => {
  const { items } = parseLines("https://en.wikipedia.org/wiki/Turing_(disambiguation)");
  assert.equal(items[0].url, "https://en.wikipedia.org/wiki/Turing_(disambiguation)");
});

test("counts link-less lines and duplicates instead of failing on them", () => {
  const { items, skipped, duplicates } = parseLines(
    [`a ${MR(1)}`, "just a note", "", `again ${MR(1)}`, `b ${MR(2)}`].join("\n"),
  );
  assert.equal(items.length, 2);
  assert.equal(skipped, 1);
  assert.equal(duplicates, 1);
});

test("keeps duplicates when asked to", () => {
  const { items, duplicates } = parseLines(`${MR(1)}\n${MR(1)}`, { dedupe: false });
  assert.equal(items.length, 2);
  assert.equal(duplicates, 0);
});

test("takes only the first link on a line", () => {
  const { items } = parseLines(`${MR(1)} and ${MR(2)}`);
  assert.deepEqual(items.map((item) => item.url), [MR(1)]);
});

test("shares the common prefix, cut back to a path boundary", () => {
  assert.equal(commonPrefix([MR(1421), MR(1422)]), "https://gitlab.com/acme/web/-/merge_requests/");
  assert.equal(commonPrefix([MR(1)]), "", "a single link has nothing to share");
  assert.equal(commonPrefix(["https://a.example/x", "https://b.example/y"]), "", "too short to be worth it");
});

test("payload stores the prefix once and only the tails", () => {
  const payload = buildPayload({
    title: "Release 24.9",
    items: [
      { url: MR(1500), label: "see" },
      { url: MR(1501), label: "" },
    ],
  });
  assert.deepEqual(payload, {
    v: 1,
    t: "Release 24.9",
    p: "https://gitlab.com/acme/web/-/merge_requests/",
    i: [["1500", "see"], "1501"],
  });
});

test("payload leaves out an empty title and an unhelpful prefix", () => {
  const payload = buildPayload({ items: [{ url: "https://a.example/x", label: "" }] });
  assert.deepEqual(payload, { v: 1, i: ["https://a.example/x"] });
});

test("a batch survives the round trip through a URL fragment", async () => {
  const items = [
    { url: MR(1421), label: ":rocket: подія" },
    { url: "https://example.com/a?b=c&d=e#frag", label: "" },
  ];
  const token = await encode(buildPayload({ title: "Реліз 24.9", items }));
  assert.match(token, /^(v1|j1)\./);
  const back = expandPayload(await decode(token));
  assert.equal(back.title, "Реліз 24.9");
  assert.deepEqual(back.items, items);
});

test("compression keeps a large batch short enough to share", async () => {
  const items = Array.from({ length: 60 }, (_, index) => ({ url: MR(1400 + index), label: `MR ${index}` }));
  const token = await encode(buildPayload({ items }));
  assert.ok(token.length < 900, `60 links encoded to ${token.length} characters`);
  assert.equal(expandPayload(await decode(token)).items.length, 60);
});

test("the uncompressed form is readable too", async () => {
  const payload = buildPayload({ items: [{ url: MR(7), label: "x" }] });
  const plain = `j1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  assert.deepEqual(expandPayload(await decode(plain)).items, [{ url: MR(7), label: "x" }]);
});

test("only http(s) links survive being read back", () => {
  const { items } = expandPayload({
    v: 1,
    i: ["javascript:alert(1)", "data:text/html,x", "https://ok.example/x", 42, [7]],
  });
  assert.deepEqual(items, [{ url: "https://ok.example/x", label: "" }]);
});

test("a hostile prefix cannot smuggle in another scheme", () => {
  assert.deepEqual(expandPayload({ v: 1, p: "javascript:", i: ["alert(1)"] }).items, []);
});

test("broken links explain themselves instead of throwing something opaque", async () => {
  await assert.rejects(decode("#nonsense"), /does not carry a batch/);
  await assert.rejects(decode("#v9.abcd"), /unknown batch format/);
  await assert.rejects(decode("#v1.zzzzzz"), /damaged or was cut short/);
});

// --- plain-list fragments: #b1.<base64(text)> and #u1.<encodeURIComponent(text)> ---

const LIST_ITEMS = [
  { url: MR(1421), label: ":memo: Zażółć gęślą jaźń 🚀" },
  { url: "https://example.com/a?b=c&d=e#frag", label: "" },
  { url: "https://pl.wikipedia.org/wiki/Łódź_(miasto)", label: "see (this)!" },
];

for (const format of ["b1", "u1"]) {
  test(`${format} survives the round trip, labels and non-ASCII included`, async () => {
    const token = encodeList({ title: "Wydanie 24.9 🎉", items: LIST_ITEMS }, format);
    assert.ok(token.startsWith(`${format}.`));
    assert.match(token, /^[\w.%~-]+$/, "nothing a chat app would cut the link at");
    assert.equal(formatOf(`#${token}`), format);
    const back = expandPayload(await decode(`#${token}`));
    assert.equal(back.title, "Wydanie 24.9 🎉");
    assert.deepEqual(back.items, LIST_ITEMS);
  });

  test(`${format} without a title has none`, async () => {
    const back = expandPayload(await decode(encodeList({ items: LIST_ITEMS }, format)));
    assert.equal(back.title, "");
    assert.deepEqual(back.items, LIST_ITEMS);
  });
}

const LIST_TEXT = `# Łódź release ✅\nMR one: ${MR(1)}\njust a note\n${MR(2)} → żółw 🐢\nagain ${MR(1)}\n`;
const LIST_EXPECTED = {
  title: "Łódź release ✅",
  items: [
    { url: MR(1), label: "MR one" },
    { url: MR(2), label: "→ żółw 🐢" },
  ],
};

test("b1 reads what `base64` prints: standard alphabet, padded", async () => {
  const token = `b1.${Buffer.from(LIST_TEXT).toString("base64")}`;
  assert.deepEqual(expandPayload(await decode(token)), LIST_EXPECTED);
});

test("b1 reads both alphabets, with or without padding", async () => {
  // "?>" and "~~" put `/`, `+` and padding into the standard form.
  const text = `https://a.example/?>>?~~~ label\nhttps://b.example/xy`;
  const standard = Buffer.from(text).toString("base64");
  const urlSafe = Buffer.from(text).toString("base64url");
  assert.match(standard, /[+/]/);
  assert.match(standard, /=$/);
  assert.match(urlSafe, /[-_]/);
  const expected = expandPayload(await decode(`b1.${standard}`));
  assert.equal(expected.items.length, 2);
  assert.equal(expected.items[1].url, "https://b.example/xy");
  for (const body of [standard.replace(/=+$/, ""), urlSafe, `${urlSafe}=`, standard.replace(/=/g, "%3D")]) {
    assert.deepEqual(expandPayload(await decode(`b1.${body}`)), expected);
  }
});

test("b1 that is not base64 explains itself", async () => {
  await assert.rejects(decode("#b1.a"), /damaged or was cut short/);
  await assert.rejects(decode("#b1.@@@@"), /damaged or was cut short/);
});

test("u1 reads what encodeURIComponent and Python's quote() print", async () => {
  assert.deepEqual(expandPayload(await decode(`u1.${encodeURIComponent(LIST_TEXT)}`)), LIST_EXPECTED);
});

test("u1 tolerates what browsers leave unencoded in a fragment", async () => {
  const token = `u1.MR one: ${MR(1)}%0A${MR(2)}?a=b&c=d#top żółw`;
  assert.deepEqual(expandPayload(await decode(token)).items, [
    { url: MR(1), label: "MR one" },
    { url: `${MR(2)}?a=b&c=d#top`, label: "żółw" },
  ]);
});

test("u1 with malformed % sequences does not throw", async () => {
  for (const body of ["%", "%zz", "100%", "%E0%A4%A", "%FF%FE", `${encodeURIComponent(MR(1))}%`]) {
    await assert.doesNotReject(decode(`u1.${body}`), body);
  }
  const back = expandPayload(await decode(`u1.50%25 off%0A100% ${encodeURIComponent(MR(1))}%0A%E0%A4%A ${MR(2)}`));
  assert.deepEqual(back.items, [
    { url: MR(1), label: "100%" },
    { url: MR(2), label: "%E0%A4%A" },
  ]);
  assert.deepEqual(expandPayload(await decode("u1.%")).items, []);
});

test("only a first line starting with `# ` is the title", async () => {
  const read = async (text) => expandPayload(await decode(`u1.${encodeURIComponent(text)}`));
  assert.equal((await read(`# Release\n${MR(1)}`)).title, "Release");
  assert.equal((await read(`\n\n# Release\n${MR(1)}`)).title, "Release", "leading blank lines do not count");
  assert.equal((await read(`#Release\n${MR(1)}`)).title, "", "needs the space");
  const late = await read(`${MR(1)}\n# not a title ${MR(2)}`);
  assert.equal(late.title, "");
  assert.deepEqual(late.items.map((item) => item.label), ["", "not a title"]);
});

test("list fragments drop anything that is not http(s)", async () => {
  const text = ["javascript:alert(1)", "ftp://files.example/x", "data:text/html,x", "file:///etc/passwd", `ok ${MR(1)}`].join("\n");
  for (const token of [`u1.${encodeURIComponent(text)}`, `b1.${Buffer.from(text).toString("base64")}`]) {
    assert.deepEqual(expandPayload(await decode(token)).items, [{ url: MR(1), label: "ok" }]);
  }
});

test("formatOf names the known formats only", () => {
  assert.equal(formatOf("#v1.abc"), "v1");
  assert.equal(formatOf("u1.abc"), "u1");
  assert.equal(formatOf("#x9.abc"), "");
  assert.equal(formatOf("#nonsense"), "");
});
