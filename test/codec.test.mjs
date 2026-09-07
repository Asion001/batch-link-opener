import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseLines,
  commonPrefix,
  buildPayload,
  expandPayload,
  encode,
  decode,
} from "../public/assets/codec.js";

const MR = (n) => `https://gitlab.com/acme/web/-/merge_requests/${n}`;

test("takes the link out of a line and keeps the rest as its label", () => {
  const { items } = parseLines(`:flag-gr: ${MR(1421)}`);
  assert.deepEqual(items, [{ url: MR(1421), label: ":flag-gr:" }]);
});

test("keeps the trailing colon of an emoji code but drops a sentence colon", () => {
  const { items } = parseLines(`Ticket: ${MR(1)}\n:flag-ua: ${MR(2)}`);
  assert.deepEqual(items.map((item) => item.label), ["Ticket", ":flag-ua:"]);
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
    { url: MR(1421), label: ":flag-gr: подія" },
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
