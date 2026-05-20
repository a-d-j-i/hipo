# Spike 01 — SQLite-WASM + Drizzle + OPFS

**Goal:** verify the framework's data-layer foundation works end-to-end:
SQLite-WASM running in a dedicated Web Worker, persisting to OPFS, reached via
Drizzle ORM.

**Stack picked for this spike:**

- `sqlocal` 0.18.0 — wraps `@sqlite.org/sqlite-wasm`, runs it in a Worker,
  exposes a Drizzle driver. Includes a Vite plugin that configures the required
  COOP/COEP headers in dev.
- `drizzle-orm` 0.36 — same ORM hipo already uses.
- `vite` 6 — same bundler hipo already uses.

This is the fastest-path spike; if it works, we have a working baseline for the
framework's `packages/sqlite`. Alternatives (`@libsql/client-wasm` for the Turso
upgrade path, `wa-sqlite` for the "state of the art" VFS) are evaluated as
follow-ups.

## How to run

```bash
cd spikes/01-sqlite-opfs
npm install
npm run dev
# open http://127.0.0.1:5173
```

The Vite dev server sends `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin` automatically (via sqlocal's Vite
plugin). The page reports `crossOriginIsolated` so we can verify this with the
eye.

## What to look for

- **Environment panel** shows `crossOriginIsolated: true`.
- **Migration line** in the log:
  `migration ok (CREATE TABLE IF NOT EXISTS items)`.
- **Insert** a row → it appears in the rows panel.
- **Reload the page** → the row is still there (OPFS persistence).
- **Browser DevTools → Application → Storage → Origin Private File System** →
  `spike.sqlite3` is present and growing.

## Cross-browser matrix to test

| Browser                               | crossOriginIsolated | OPFS sync access handle | Notes                |
| ------------------------------------- | ------------------- | ----------------------- | -------------------- |
| Chromium (Linux)                      |                     |                         |                      |
| Firefox (Linux)                       |                     |                         |                      |
| WebKitGTK (Linux Tauri webview proxy) |                     |                         | deferred to Spike #3 |

Fill in the table as you test.

## Follow-up evaluations to schedule

1. **`@libsql/client-wasm`** with `drizzle-orm/libsql`: does it work in a
   browser Worker with OPFS persistence? If yes, switching to it would keep the
   Turso embedded-replica upgrade path open (see `docs/local-first-framework.md`
   "Promotion path").
2. **`wa-sqlite`** with `OPFSCoopSyncVFS`: the powersync.com 2026 article calls
   it the state-of-the-art for browser SQLite. More integration work;
   potentially better concurrency for large DBs.

## Result (Phase 0 Spike #1, 2026-05-17)

### What's confirmed automatically

- ✅ `npm install` succeeds (sqlocal 0.18.0 + drizzle-orm 0.36 + Vite 6).
- ✅ `tsc --noEmit` is clean — Drizzle + sqlocal types compose without `as any`
  cheats.
- ✅ Vite dev server starts on `:5173` and sends the required headers
  automatically (verified via `curl -I`):
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Opener-Policy: same-origin` No manual middleware needed —
    sqlocal's Vite plugin handles it.
- ✅ Production build (`npm run build`) emits all needed artifacts.

### Measured bundle sizes (post-gzip)

| Asset                           | Size (gzipped) | Notes                     |
| ------------------------------- | -------------- | ------------------------- |
| `index.html`                    | 1.00 KB        |                           |
| `index-*.js` (main)             | 28.28 KB       | app code + sqlocal driver |
| `index-*.js` (vendor)           | 67.20 KB       | drizzle-orm + deps        |
| `sqlite3-*.wasm`                | 399.15 KB      | from 859.73 KB raw        |
| `sqlite3-worker1-*.js`          | 217 KB raw     | worker bootstrap          |
| `sqlite3-opfs-async-proxy-*.js` | 11.64 KB raw   | proxy                     |
| `worker-*.js`                   | 19.59 KB raw   | sqlocal worker            |

**Critical-path cold-start payload (HTML + main JS + WASM):** ~495 KB gzipped.
On a 10 Mbps connection that's ~0.5 s download — well inside the < 5 s
cold-start budget.

vs Performance budget in `docs/local-first-framework.md`:

- Main thread JS < 400 KB ✓ (we're at 95 KB combined)
- SQLite-WASM < 600 KB ✓ (we're at 399 KB)
- Framework JS < 100 KB ✓ (28 KB for drizzle+sqlocal)

### What still needs human verification (in a browser)

These can't be checked without a real DOM/OPFS context — open the dev page and
verify each:

- [ ] `crossOriginIsolated === true` (shown in the Environment panel)
- [ ] Migration succeeds (log: "migration ok")
- [ ] Insert + Refresh work (log: "inserted: …", row appears)
- [ ] **Reload page → row is still there** (proves OPFS persistence)
- [ ] DevTools → Application → Storage → Origin Private File System →
      `spike.sqlite3` exists
- [ ] Spike works in Chromium, Firefox, and WebKit-flavoured browser (Epiphany /
      GNOME Web on Linux for the WebKitGTK proxy)
- [ ] Storage quota panel reports sensible numbers

### Decisions for the framework

Based on this spike, `packages/sqlite` will:

1. **Use `sqlocal` over the raw `@sqlite.org/sqlite-wasm` direct route.** It
   saves us writing the Worker glue, exposes Drizzle natively, and ships a Vite
   plugin that handles the COOP/COEP setup that's needed anyway. Trade-off:
   0.18.x is pre-1.0, so we pin and read release notes. MIT.
2. **Re-evaluate `@libsql/client-wasm` for the Turso upgrade path** in a sibling
   spike (01b). The Turso embedded-replica story is a real architectural option
   per [[project-hipo-deployment-directions]]. If `@libsql/client-wasm` works
   with OPFS in a Worker, switching substrates later is doable but non-trivial;
   better to know now.
3. **`wa-sqlite` + `OPFSCoopSyncVFS` is in the "consider later" bucket.** Worth
   revisiting only if sqlocal's concurrency model becomes a bottleneck with
   hipo-sized DBs.
