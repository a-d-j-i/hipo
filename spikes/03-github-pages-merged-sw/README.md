# Spike 03 — GitHub Pages + merged Service Worker

**Goal:** validate that the framework can run from **GitHub Pages**, with no
server-side header configuration, by having the Service Worker itself inject the
COOP/COEP headers required for SQLite-WASM's fast OPFS mode. Builds on Spike 02
(SW + Worker + hand-rolled router).

## What's different from Spike 02

|                            | Spike 02                                    | Spike 03                                                      |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| COOP/COEP source           | Vite dev-server middleware (sqlocal plugin) | **Service Worker injects them on every same-origin response** |
| Works on plain static host | no                                          | yes                                                           |
| First-load reload          | not required                                | **required once** (SW must activate to inject headers)        |
| Vite `base` config         | default `/`                                 | configurable via `BASE_PATH` env var for `/<repo>/`           |
| GitHub Actions workflow    | none                                        | `.github/workflows/deploy.yml`                                |

The merged SW (`public/sw.js`) does two jobs in one artifact, as the framework's
`packages/sw` will:

1. **COI shim** — adds `Cross-Origin-Embedder-Policy: require-corp` +
   `Cross-Origin-Opener-Policy: same-origin` +
   `Cross-Origin-Resource-Policy: same-origin` to every same-origin response.
   ~10 LOC.
2. **`/api/*` routing** — same MessageChannel pattern as Spike 02. ~40 LOC.

Both can be feature-flagged in the eventual framework package.

## Run locally

```bash
cd spikes/03-github-pages-merged-sw
npm install
npm run dev
# open http://127.0.0.1:5176
```

Locally, sqlocal's Vite plugin still sets COOP/COEP — so on dev you see
`crossOriginIsolated: true` without the SW reload dance. That's fine; the real
test is the production build on Pages.

## Deploy to GitHub Pages — checklist

I (Claude) cannot push to your GitHub account or configure your repo through the
UI. The setup is:

### One-time setup (you do this)

1. **Create a new public GitHub repo** (e.g. `hipo-spike-03`). Public is
   required for the free GitHub Pages tier.
2. **Copy the spike directory into the new repo as the root**:
   ```bash
   # From the new repo's working tree:
   cp -r /home/work/user/hipo/spikes/03-github-pages-merged-sw/. .
   rm -rf .github/workflows/deploy.yml  # we'll re-add below
   ```
3. **Move the workflow up to repo root** (it's currently inside the spike at
   `.github/workflows/deploy.yml`; this becomes the new repo's
   `.github/workflows/deploy.yml` at root level):
   ```bash
   mkdir -p .github/workflows
   cp /home/work/user/hipo/spikes/03-github-pages-merged-sw/.github/workflows/deploy.yml .github/workflows/
   ```
   (If you copied the whole directory in step 2, the workflow is already in
   place — skip this.)
4. **Repo settings → Pages**: under "Build and deployment", set **Source =
   "GitHub Actions"** (not "Deploy from a branch").
5. **Repo settings → Actions → General → Workflow permissions**: set "Read and
   write permissions". This lets the workflow upload the Pages artifact.
6. **Initial commit + push to `main`**:
   ```bash
   git add .
   git commit -m "initial spike 03"
   git push -u origin main
   ```
7. Watch the **Actions** tab. The `Deploy to GitHub Pages` workflow should run
   automatically and end with a link to the live site (something like
   `https://<your-username>.github.io/<repo>/`).

### What to verify on the live site

Once the workflow completes and Pages serves your site, open it and check:

- [x] **Isolation banner**: on first visit, briefly shows
      `registering SW for COOP/COEP headers…` then
      `first-install reload — wait a moment…` then the page reloads.
- [x] After reload: banner is green, says
      `crossOriginIsolated: true (SW headers active)`.
- [x] **Topology status panel** shows: worker loaded, SW controlling, port
      wired, "Topology ready".
- [x] `GET /api/health` returns JSON with `{ ok: true, worker: true }`. DevTools
      Network tab shows the request as **(ServiceWorker)**.
- [x] `POST /api/items` with text → list shows the row.
- [x] **Reload page** → no second-install reload, row still there (persistent
      OPFS through SW).
- [ ] **Hard reload while offline** (DevTools → Network → "Offline" → reload) →
      page still boots, banner still green, GET /api/items still returns saved
      rows. This proves the SW serves the app shell from cache _and_ the data
      layer works without network. (Note: this spike does NOT yet implement
      explicit asset caching — the SW only injects headers + routes /api/\*.
      Offline-after- first-visit will work because the browser cached the assets
      naturally, but the framework's `packages/sw` should add deliberate cache
      strategies for guaranteed offline.)
- [ ] **Open in Chromium and Firefox** — the SW pattern works in both modern
      engines. If WebKit-based browsers behave oddly, note it.
- [ ] **DevTools → Application → Service Workers** shows `/sw.js` as "activated
      and is running".
- [ ] **DevTools → Application → Storage → Origin Private File System** shows
      `spike-03.sqlite3` after a POST.

### Common gotchas

- **"crossOriginIsolated stays false after reload"** — usually means the SW
  didn't take control. Check DevTools → Application → Service Workers; if it
  says "activating" forever, hard-refresh while bypassing cache (Ctrl+Shift+R /
  Cmd+Shift+R).
- **404 on `/sw.js`** — the workflow built with the wrong base path. Check the
  Actions log for the build step output; should be `BASE_PATH=/<repo-name>/`.
- **`/api/*` returns 503 "api port not yet wired"** — race between the SW
  intercepting and main thread wiring the MessageChannel. This shouldn't happen
  for buttons you click manually; if it does, reload again.

## Result — automatic checks

- ✅ `npm install` clean.
- ✅ `tsc --noEmit` clean.
- ✅ `npm run build` produces a `dist/` with all assets including `dist/sw.js`.
- ✅ Dev server serves correctly; SW + worker entry both reachable.

### Measured bundle (post-gzip, with the merged SW)

| Asset                | Spike 02 | Spike 03 | Delta                           |
| -------------------- | -------- | -------- | ------------------------------- |
| HTML                 | 1.13 KB  | 1.26 KB  | +0.13 KB                        |
| Main thread JS       | 1.54 KB  | 1.77 KB  | +0.23 KB (the reload handshake) |
| `/sw.js`             | ~2 KB    | ~3 KB    | +1 KB (COI header injection)    |
| Worker chunk (raw)   | 97 KB    | 97 KB    | 0                               |
| Drizzle vendor (raw) | 219 KB   | 219 KB   | 0                               |
| SQLite WASM          | 399 KB   | 399 KB   | 0                               |

**Cost of GitHub-Pages-readiness: ~1.5 KB.** Negligible. The merged SW pattern
is essentially free.

## What's worth keeping

- `public/sw.js` — the merged SW becomes the basis for `packages/sw/src/sw.ts`
  (with build flags `coi`, `apiRoute`, `cache`).
- The `ensureCrossOriginIsolated()` helper in `src/main.ts` — becomes
  `packages/sw/src/register-and-reload.ts`.
- `.github/workflows/deploy.yml` — becomes the framework's reference deploy
  workflow that consumers copy into their app repos.

## What still needs human verification

The live site test (above) — only you can do that. Report back whether:

- The reload UX feels acceptable or jarring
- All browsers behave (especially WebKit/Safari)
- Offline reload works
- Whether crossOriginIsolated stays true across page navigations
