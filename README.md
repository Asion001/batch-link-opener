# Batch Link Opener

Turn a list of links into **one link** that opens all of them.

Paste a list — merge requests, tickets, dashboards — get a URL back, share it. Whoever opens it
gets a page with one button that opens the whole batch in new tabs. If the browser blocks the
pop-ups, the page falls back to a one-at-a-time button with a counter, so a few clicks still get
everything open.

## How it works

- **Every line that contains a link counts.** The link is picked out of the line; whatever else is
  on the line (`:flag-gr:`, a ticket name, an arrow) becomes its label. Lines without a link are
  ignored, duplicates are skipped.
- **The batch travels inside the URL fragment**, after the `#`. Fragments are never sent to a
  server, so the list stays between the people who have the link — there is no database, no
  redirect, no logging, and no back end at all.
- **The fragment is compressed.** The shared prefix of the links is stored once and only the
  differing tails are kept, then the whole thing is deflated and base64url-encoded. Sixty GitLab
  merge request links fit in roughly 460 characters.
- **Editing round-trips.** Opening a batch link on the home page loads it back into the editor.

### Fragment format

```
https://<host>/open#v1.<base64url(deflate-raw(json))>
```

`v1` is the compressed form; `j1` is the same JSON without deflate, used when a browser has no
`CompressionStream`. The JSON is:

```json
{
  "v": 1,
  "t": "Release 24.9",
  "p": "https://gitlab.com/acme/web/-/merge_requests/",
  "i": [["1500", "see"], ["1501", ":flag-gr:"], "1503"]
}
```

`t` (title) and `p` (shared prefix) are optional; an item is either `"tail"` or `["tail", "label"]`.
Anything that does not expand to an `http(s)` URL is dropped when the batch is read.

## Pop-up handling

Pressing **Open all** calls `window.open` once per link inside the click handler. Browsers allow
this for a while and then start refusing; the page notices the refusal (a `null` window), stops,
and switches to step mode showing `Open link 3 of 12`, a progress bar, the next link, and
**Reset to first**. Each press is its own user gesture, which every browser allows, so the batch
always gets through. Every link is also a plain anchor in the list below.

## Run it locally

```sh
npm install
npm run dev      # wrangler dev
```

Or serve `public/` with any static file server — there is no build step.

## Deploy to Cloudflare

```sh
npm run deploy   # wrangler deploy
```

`wrangler.jsonc` configures [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
with `directory: ./public` and no Worker script, because nothing needs to run server-side. The same
`public/` directory also deploys as-is to Cloudflare Pages (`wrangler pages deploy public`), where
`public/_headers` supplies the security headers.

## Layout

```
public/
  index.html          editor: list in, shareable link out
  open.html           opener: open all, or one at a time
  404.html
  _headers            security headers + asset caching
  assets/codec.js     link parsing and fragment encode/decode
  assets/style.css
wrangler.jsonc
```
