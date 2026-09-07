// The site ships a strict Content-Security-Policy in public/_headers, with no
// 'unsafe-inline'. Anything inline in the HTML — a script body, a style
// attribute, an onclick handler — is silently dead in the browser, and a static
// file server does not apply _headers, so it looks fine locally. These tests
// keep the pages and the policy honest about each other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const pages = readdirSync(PUBLIC).filter((name) => name.endsWith(".html"));
const read = (name) => readFileSync(join(PUBLIC, name), "utf8");

const policy = Object.fromEntries(
  read("_headers")
    .split("\n")
    .find((line) => line.trim().startsWith("Content-Security-Policy:"))
    .split(":")
    .slice(1)
    .join(":")
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, ...values]) => [name, values]),
);

test("there are pages to check", () => {
  assert.ok(pages.length >= 3, `found ${pages.length} HTML files`);
});

test("the policy stays strict", () => {
  assert.deepEqual(policy["script-src"], ["'self'"]);
  assert.deepEqual(policy["style-src"], ["'self'"]);
  assert.deepEqual(policy["default-src"], ["'none'"]);
});

for (const page of pages) {
  test(`${page} has no inline script`, () => {
    const inline = [...read(page).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attributes, body]) => !/\bsrc=/i.test(attributes) && body.trim());
    assert.equal(inline.length, 0, "script-src 'self' blocks inline scripts; move them to /assets");
  });

  test(`${page} has no style attribute or inline <style>`, () => {
    assert.equal(/\sstyle\s*=\s*"/i.test(read(page)), false, "style-src 'self' blocks style attributes");
    assert.equal(/<style[\s>]/i.test(read(page)), false, "style-src 'self' blocks inline <style>");
  });

  test(`${page} has no inline event handler`, () => {
    const handlers = [...read(page).matchAll(/\son[a-z]+\s*=\s*"/gi)].map((match) => match[0].trim());
    assert.deepEqual(handlers, [], "inline handlers need 'unsafe-hashes'; use addEventListener");
  });

  test(`${page} loads nothing from another origin`, () => {
    const remote = [...read(page).matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/gi)].map((match) => match[1]);
    assert.deepEqual(remote, [], "default-src 'none' allows same-origin resources only");
  });

  test(`${page} only points at files that exist`, () => {
    for (const [, path] of read(page).matchAll(/(?:src|href)\s*=\s*"(\/[^"#?]+)"/g)) {
      assert.ok(existsSync(join(PUBLIC, path)), `${page} references a missing ${path}`);
    }
  });
}
