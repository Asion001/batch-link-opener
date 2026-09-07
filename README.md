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
npm test         # unit tests for the parser and the fragment codec
```

Or serve `public/` with any static file server — there is no build step.

## Deploy

Deployment is automatic. **The only thing to set up is one repository secret:**

| Secret | Required | What it is |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | yes | A Cloudflare API token created from the **Edit Cloudflare Workers** template (Workers Scripts: Edit + Account Settings: Read). |
| `CLOUDFLARE_ACCOUNT_ID` | no | Only needed if the token can see more than one Cloudflare account; otherwise Wrangler picks the single account the token belongs to. |

Add it under **Settings → Secrets and variables → Actions → New repository secret**.

`.github/workflows/ci.yml` then does the rest:

- **every push and pull request** runs the unit tests and `wrangler deploy --dry-run`, which
  type-checks the Cloudflare config and the asset directory without needing any credentials — so
  pull requests, forks included, are fully checked without the secret;
- **pushes to the default branch** deploy with `wrangler deploy` and put the resulting
  `*.workers.dev` URL in the job summary.

To deploy by hand instead: `npm run deploy`.

### Content-Security-Policy

`public/_headers` sends `default-src 'none'` with `script-src 'self'` and `style-src 'self'` — no
`unsafe-inline`. So the pages keep **all** JavaScript and CSS in `public/assets/`: an inline
`<script>` body, a `style="…"` attribute or an `onclick=` handler would be blocked in the browser
while still looking fine behind a plain static file server, which does not apply `_headers` at all.
`test/csp.test.mjs` fails the build on any of those, and `npm run dev` (Wrangler) serves the real
headers, so check there rather than with a bare file server.

`wrangler.jsonc` configures [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
with `directory: ./public` and no Worker script, because nothing needs to run server-side. The same
`public/` directory also deploys as-is to Cloudflare Pages (`wrangler pages deploy public`), where
`public/_headers` supplies the security headers.

### Custom domain

Add a route to `wrangler.jsonc` once the DNS zone is on Cloudflare:

```jsonc
"routes": [{ "pattern": "links.example.com", "custom_domain": true }]
```

## Layout

```
public/
  index.html          editor: list in, shareable link out
  open.html           opener: open all, or one at a time
  404.html
  _headers            security headers + asset caching
  assets/codec.js     link parsing and fragment encode/decode
  assets/editor.js    the editor page's script
  assets/opener.js    the opener page's script
  assets/style.css
test/codec.test.mjs   parser and codec tests (node --test, no dependencies)
test/csp.test.mjs     keeps the pages loadable under their own CSP
.github/workflows/ci.yml
wrangler.jsonc
```
