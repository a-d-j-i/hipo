# Local-first framework — implementation plan

**Status:** draft, 2026-05-17 (revised same day) **Scope:** this document tracks
the plan to evolve hipo's stack into a reusable local-first TypeScript app
framework, with hipo as the first consumer.

## Vision

Build a framework for many small TypeScript apps that:

1. Runs **entirely in a browser**, offline-first, no server required.
2. Ships a free demo on **GitHub Pages** as the standard onboarding ramp.
3. Installs as a **Tauri desktop app** for users who want native UX.
4. Has a built-in **end-to-end encrypted backup** story (local filesystem,
   GitHub, optional vault server) so users can recover from "cleared browser
   data" or move between machines.

hipo is the **proving ground** — its mortgage-loan domain stays as-is, but
everything below the domain layer (data, backend, auth, backup, bootstrap,
deployment) becomes generic framework code consumable by other apps.

The framework ships as **composable packages**, not a monolith. Each app picks
the pieces it needs. The repo stays a monorepo (Option B) until a second
consumer materialises; npm publishing is deferred to when each package
stabilises.

## Non-goals (v1)

- Multi-device real-time sync. v1 sync = manual backup + restore.
- Mobile (iOS/Android) Tauri builds. Mobile = responsive web on Pages.
- Server-rendered or hydration-heavy frameworks. SPA only.
- An opinionated UI library at the framework level. Antd is hipo's choice;
  another consumer could use a different one.
- Multi-bundler support. **Vite is the supported bundler.** Other bundlers may
  work via the same source files, but we don't author plugins for them.

## Hard constraints

- **GitHub Pages must work** out of the box via the bundled `packages/sw`
  service worker (COOP/COEP injection + `/api/*` routing in one artifact;
  `coi-serviceworker` was the prior-art inspiration for the headers part).
  Non-negotiable.
- **MIT/Apache deps only.** No LGPL exposure.
- **One TS bundle, multiple shapes.** No drift between browser and Tauri data
  layers / backend logic.
- **Cross-compile Linux→Windows** for the Tauri shape (already wired in hipo via
  `cargo-xwin`).
- **No hipo references in any `packages/*`.** Ever. Enforced by review or by
  ESLint `no-restricted-imports`.

## Target architecture — composable packages

```
packages/
  sqlite/         data layer: SQLite-WASM (browser) + libsql (deno)
                  Drizzle init, migrations runner. App-agnostic.
  server/         Minimal router (~50 LOC, Web Standard Request/Response,
                  no Hono dependency — see Spike #2) + Ctx shape +
                  AppError + fetch-shim for in-page mode. Substrate.
                  App-agnostic.
  sw/             owns the entire service worker: COOP/COEP injection
                  + /api/* routing to the Worker + optional cache
                  strategies. Single SW per scope, so these can't live
                  in separate packages. Feature flags: `coi`,
                  `apiRoute`, `cache`. `coi-serviceworker` is credited
                  as prior art in source comments; not a runtime dep.
                  Mandatory for GitHub Pages. App-agnostic.

  auth/           default user/session/role model + Argon2id
                  (browser: hash-wasm, deno: @node-rs/argon2).
                  Owns its own migrations. Swappable.
  audit/          audit_log table + writeAudit() helper.
                  Owns its own migrations. Swappable.

  backup/         encrypt/decrypt (Argon2id + AES-GCM) + compression +
                  BackupTarget interface + BackupFormat interface
                  (type-only — concrete formats ship from substrate
                  packages, so backup is engine-agnostic).
  backup-local/   <a download>, FS Access API, Tauri plugin-fs.
  backup-github/  Contents API + PAT auth.
  backup-vault/   POST client for the optional vault server.

  i18n/           react-i18next setup + locale switcher; each package
                  contributes its own catalog under a namespace.
  tauri-shell/    Rust template + capabilities + updater.
                  Scaffolded into consumer apps (Rust can't live in
                  node_modules; this is a directory copy, not an
                  npm install).

templates/
  minimal/        the simplest possible consumer: composes sqlite +
                  server + sw + auth. Boots, login, "hello {user}".
                  Proves the contracts without hipo's complexity.

apps/
  hipo/           the rich proving-ground consumer. Domain modules
                  (parties/loans/payments/payouts) + antd pages +
                  Tauri config + i18n catalogs. Consumes the packages
                  it wants.

  backend/        (TBD — see Phase 9: slim to a vault, or delete.)
```

### Why composable

- **Each package's surface is its own contract**, not part of a big "framework
  contract." `packages/audit` documents only how to plug in audit;
  `packages/backup` only its target interface. Smaller, more reviewable, easier
  to evolve independently.
- **Swappable parts.** An app wants a different role model? Skip
  `packages/auth`, write its own. The sqlite + server + sw substrate doesn't
  care.
- **Templates, not codegen.** `templates/minimal/` is a directory you copy. No
  CLI gymnastics to maintain in v1.
- **The day you start a second consumer**, `cp -r templates/minimal apps/newapp`
  and start adding domain modules.

### Resolution mechanism (Option B, monorepo)

Same pattern hipo's `packages/shared` uses today:

- Frontend (Vite + npm workspaces): symlink at `node_modules/<name>`.
- Backend (Deno): import map entry in `deno.json`.

**Source-only TS** as long as we're not publishing. No `tsc --emit` step
required yet. The day a package gets published to npm, _that_ package gets a
build step; the others can stay source-only until they follow.

## Phase 0 — Derisk (1–2 days, throwaway code)

Four spikes. If any fails, the plan changes.

1. **SQLite-WASM + Drizzle + Vite + OPFS end-to-end, in a Worker.** Tiny Vite
   project: open OPFS DB _inside a dedicated Worker_ (sync access handles
   require it), run a migration, insert + read across postMessage. Test on:
   - Chromium (Linux + Windows)
   - Firefox
   - WebKitGTK 2.42+ (Linux Tauri webview)

   **Resolved 2026-05-17 — pick `sqlocal` 0.18.0 + vanilla SQLite-WASM via
   `@sqlite.org/sqlite-wasm`.** Measured bundle: 399 KB gzipped for the WASM,
   495 KB critical-path payload, comfortably inside the Performance budget.
   Sqlocal's Vite plugin handles COOP/COEP + Worker bootstrap automatically. See
   `spikes/01-sqlite-opfs/` for the build artifacts and
   `spikes/01b-libsql-wasm/` for the rejected alternative.

   `@libsql/client-wasm` was evaluated as the "preserve Turso path" option but
   rejected: its WASM bundle is **1.76 MB gzipped — 4.4× the size** of vanilla
   SQLite-WASM (libsql ships a SQLite fork with replication code that's
   irrelevant for an embedded app). Cost paid on every cold start, every user,
   forever, for an option we don't plan to exercise.

2. **Router in-Worker + SW routing.** Build a hand-rolled router in the Worker;
   register a service worker that intercepts `/api/*` and proxies to the worker
   via MessageChannel; verify `GET /api/health` round-trips end-to-end from main
   thread `fetch()`. **Resolved 2026-05-17: hand-rolled 53-LOC router is
   sufficient; Hono is overkill.** See `spikes/02-sw-worker-routing/`.
3. **GitHub Pages + `packages/sw` (single merged SW).** Deploy a "hello WASM"
   page to a real GitHub Pages site with the merged SW (COOP/COEP injection +
   `/api/*` routing in one artifact) registered; confirm
   `crossOriginIsolated === true` after the activation reload; confirm the
   reload UX is acceptable. Reimplement the COI part (~70 LOC) rather than
   importing `coi-serviceworker` so we own the fetch-event ordering when routing
   and header-injection share the same handler.
4. **Measurement baseline.** With the test page from #1–3, record: bundle size
   after gzip, WASM cold-start time, first-backup time on a 5 MB DB (export →
   gzip → encrypt → upload-mock → verify). These numbers anchor the Performance
   budget section below.

**Deliverable:** a short writeup appended to this doc with the chosen adapter,
known browser-support gaps, confirmed-or-not for SW headers on Pages, and the
measurement baseline.

## Phase 0 — Outcomes (closed 2026-05-17)

All four spikes resolved. Architecture validated; several plan assumptions
tightened with measured numbers.

| Spike                                      | Verdict                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 — SQLite-WASM + Drizzle + OPFS + Worker | **sqlocal 0.18 + `@sqlite.org/sqlite-wasm`** picked. 399 KB gzipped WASM, 495 KB critical path. `spikes/01-sqlite-opfs/`.                                                                         |
| #1b — `@libsql/client-wasm` evaluation     | **Rejected**: 1.76 MB WASM, 4.4× the vanilla payload, for a Turso path explicitly out of scope. `spikes/01b-libsql-wasm/`.                                                                        |
| #2 — SW + Worker + routing                 | **Hono dropped**, replaced with 53-LOC hand-rolled router. Architectural code-split via Vite worker handling pushed main-thread bundle to 1.5 KB gzipped. `spikes/02-sw-worker-routing/`.         |
| #3 — GitHub Pages + merged SW              | **Live on Pages**, persistence confirmed across hard reload (Ctrl-F5), works in Chromium + Firefox. ~1.5 KB overhead for COOP/COEP injection. `spikes/03-github-pages-merged-sw/`.                |
| #4 — Performance baseline                  | **Numbers within budget by 3–30×.** Cold-start (CPU portion) 68 ms; warm-start 26 ms; 5 MB backup pipeline 327 ms; compression ratio 73%. KDF dominates backup (56%). `spikes/04-perf-baseline/`. |

### Architectural decisions confirmed by measurement

1. **sqlocal + vanilla SQLite-WASM** as substrate. Vite plugin handles COOP/COEP
   automatically; Drizzle integrates via `sqlite-proxy`.
2. **Hand-rolled router** replaces Hono in `packages/server`. 50-LOC substrate,
   isomorphic Web Standard `Request`/`Response` in/out.
3. **Dedicated Worker + Service Worker + MessageChannel** topology works.
   Spec-required for fast OPFS; round-trip overhead ~2 ms.
4. **Merged SW** (COI + `/api/*` routing + cache hooks) ships as `packages/sw`.
   ~70 LOC total.
5. **GitHub Pages is a first-class deploy target.** One-time activation reload
   acceptable; subsequent visits boot crossOriginIsolated immediately.
6. **Backup pipeline KDF cost is the bottleneck** at our Argon2id parameters
   (m=64MiB, t=3, p=1) → 182 ms on 5 MB DB. Implies the framework should **cache
   the derived key per session** so re- backups skip the KDF cost.

### Things to revisit later (not blocking Phase 1)

- Re-measure cold-start on production build + throttled network.
- Cross-browser perf parity on WebKit (Epiphany / GNOME Web).
- Confirm 73% compression ratio holds for real hipo audit-log data (likely
  better — JSON has more redundancy than random ASCII).
- Phase 7's verify-after-upload roughly doubles total backup time; budget should
  account for the ~650 ms doubled total.

## Phase 1 — Carve package boundaries

Goal: move existing code into the right package. **No user-visible change.**
Hipo keeps shipping as-is.

For each new package, create
`packages/<name>/{package.json, deno.json (if needed), src/index.ts, README.md}`.
Add npm workspace entries; add Deno import-map entries.

Moves:

(Source paths use today's names — `apps/hipo` was called `apps/backend` until
the Phase-9 rename. Phase 1 actually saw paths like `apps/backend/src/db/...`;
the destinations still hold.)

- `apps/hipo/src/db/{schema,migrations}.ts` → `packages/sqlite/src/`
- `apps/hipo/src/db/client.ts` (libsql factory) →
  `packages/sqlite/src/client.deno.ts` (placeholder `client.browser.ts` added
  for Phase 2)
- `apps/hipo/src/server.ts` setup + middleware chain + `error_handler.ts` +
  `errors.ts` → `packages/server/src/`. During this move, replace Hono with
  `packages/server/src/router.ts` (the 53-LOC hand-rolled router from Spike #2).
  Route handlers keep the same `(ctx) => Response` shape; `app.fetch(req)`
  isomorphism is preserved without the Hono dependency.
- `apps/hipo/src/auth/{operations,passwords,middleware,types}.ts`
  - their `_test.ts` → `packages/auth/src/`
- `apps/hipo/src/audit/{operations,write}.ts` + tests → `packages/audit/src/`
- `apps/hipo/src/{parties,loans,payments,payouts}/` →
  `apps/hipo/src/domain/<area>/` (these are app code, not framework)
- `apps/desktop/` (née; now `apps/hipo/tauri/`) → `packages/tauri-shell/` (the
  generic shell) + `apps/hipo/tauri/` (name/icon/identifier overrides)

`Ctx` stays `{ db, user }`. Lives in `packages/server`. `Db` is a Drizzle type
both backends will satisfy. `User` re-exports from `packages/auth`.

Schema split: `packages/auth/src/schema.ts` defines `users` + `sessions`;
`packages/audit/src/schema.ts` defines `audit_log`; `apps/hipo/src/db/schema.ts`
defines parties/loans/etc. and imports the framework tables for foreign keys.
Drizzle handles separate schema files natively.

**Deliverable:** `npm run test:backend` still green, hipo Tauri build still
works, no functional change. Package READMEs document each public surface even
if minimal.

## Phase 2 — Browser data layer

- `packages/sqlite/src/client.browser.ts`: SQLite-WASM + OPFS, runs the same
  migrations array, returns a Drizzle instance.
- `packages/auth/src/passwords.browser.ts`: `hash-wasm` Argon2id.
- Vite resolves `client.ts` / `passwords.ts` via conditional imports (`define`
  flag or `import.meta.env.MODE`).

**Deliverable:** a Vite test page constructs a real `Ctx` in the browser and
calls a `do_*` op against OPFS.

## Phase 3 — In-page router via Worker + Service Worker

**Topology — load-bearing.** SQLite-WASM's fast OPFS mode requires a dedicated
Web Worker (`FileSystemSyncAccessHandle` is only exposed there, not in the main
thread or service workers — browser spec). The router runs in the same Worker as
the DB so route handlers can call Drizzle without round-tripping. A service
worker intercepts `/api/*` fetches from the main thread and proxies them to the
Worker via MessageChannel.

```
Main thread (UI)            Service Worker            Dedicated Worker
─────────────────           ─────────────────         ───────────────────
React + httpRequest()  ──►  intercept /api/*   ──►   router.fetch(req)
                                                       Drizzle
                                                       SQLite-WASM + OPFS
       ◄──── Response ──────────  ◄──────  postMessage(response)
```

`httpRequest` doesn't know any of this exists — it just calls `fetch`. The
Worker boundary is hidden from app code.

**Implementation:**

- `packages/server/src/worker.ts`: Worker entry. Loads the app's router
  instance, listens for postMessage'd `Request`-likes via a MessageChannel port,
  calls `app.fetch`, posts back a `Response`-like.
- The Service Worker (single artifact, built by `packages/sw`) carries both the
  `/api/*` routing logic (proxy to the Worker via postMessage) and the COOP/COEP
  header injection. Built once, registered once. `packages/server` provides a
  `createApiRouter(workerEndpoint)` helper that `packages/sw` calls from its
  `fetch` event when `apiRoute` is enabled — that keeps routing logic close to
  the server package while the SW package stays the single owner of the SW
  artifact.
- `apps/hipo/frontend/src/in-page-backend.ts`: boots the worker, registers the
  SW. Gate behind `VITE_INPAGE_BACKEND=1`, parallel to existing
  `VITE_USE_MOCKS`. Safety valve for the rest of the migration.
- Cookie sessions replaced with an in-memory token map (also lives in
  `packages/auth` as an alternate session strategy). Existing `X-Hipo-Token`
  header path reused.

**Deliverable:** `npm run dev:inpage` runs the app with **no Deno running**. All
hipo pages work. All Deno-shape tests still pass.

## Milestone — `templates/minimal/` ships green

Concurrent with Phase 2/3, build `templates/minimal/`. It boots, lets you log
in, shows "hello {user}", takes a backup, restores from one. Nothing more. **It
is the build-gate for the framework.** Any change to a `packages/*` that breaks
`templates/minimal` is wrong by construction.

From here on, both `apps/hipo` and `templates/minimal` must boot at every phase
boundary.

## Phase 4 — Backup primitives (`packages/backup`)

### Pipeline (export, in order)

```
exportDb()        VACUUM INTO → Uint8Array (consistent snapshot)
   ↓
compress()        CompressionStream("gzip") → smaller Uint8Array
   ↓
encrypt()         AES-GCM(key, iv) → { salt, iv, format, ct }
   ↓
upload()          to chosen BackupTarget
```

Restore reverses the chain. **Order matters** — encrypted ciphertext is
high-entropy and won't compress, so compress _before_ encrypting.

### Primitives

- `deriveKey(passphrase, salt) → CryptoKey` — `hash-wasm` Argon2id, imported to
  AES-GCM.
- `compress(plain) → Uint8Array` — `CompressionStream("gzip")`. Native in
  Chromium, Firefox 113+, Safari 16.4+, WebKitGTK 2.42+. Streams, so memory cost
  stays low even for large DBs.
- `decompress(bytes) → Uint8Array` — `DecompressionStream("gzip")`.
- `encryptBlob(bytes, key) → { envelope_version, salt, iv, format, ct }` —
  AES-GCM, fresh `iv` per call. `envelope_version` is the version of the
  envelope shape itself (starts at `1`); `format` tags the _contents_
  (`"binary-gzip"` for v1) so future formats can coexist. See "Versioning
  policy" below for evolution rules.
- `decryptBlob({ envelope_version, salt, iv, format, ct }, key)` — rejects
  unknown `envelope_version`, dispatches by `format`.

### Format abstraction (engine-agnostic)

`packages/backup` defines only the interface — no engine-specific code. Concrete
formats live in the substrate package they describe. This keeps
encryption/compression/target plumbing usable by _any_ future substrate (PGLite,
Dexie, CRDT-based, etc.), not just SQLite.

```ts
// packages/backup/src/format.ts — type only, engine-agnostic
interface BackupFormat {
  name: string; // "binary-gzip" | "sql-dump" | ...
  encode(): Promise<Uint8Array>; // engine-specific impl supplies bytes
  decode(bytes: Uint8Array): Promise<void>;
}
```

Substrate-specific implementations (shipped by `packages/sqlite`):

- `BinaryFormat` (v1, default): `VACUUM INTO` → raw DB bytes. Fast restore,
  exact fidelity, opaque.
- `SqlDumpFormat` (v1.5, deferred): enumerate `sqlite_schema` for schema,
  `SELECT * FROM ...` per table to emit `CREATE` + `INSERT` statements. Slower
  restore but human-readable, partially-restorable, more durable for long-term
  archival. ~80 LOC on top of raw queries.

A hypothetical future `packages/dexie` or `packages/pglite` would ship its own
`BackupFormat` implementations and reuse the same encryption/compression/target
machinery.

The `name` field in the encrypted envelope lets a single `BackupTarget` hold
blobs of different formats over time and a restore flow dispatches to the right
decoder.

### Other operations

- `exportDb(db, format) → Uint8Array` — calls the format's `encode`.
- `importDb(bytes, format, db)` — calls the format's `decode`, then re-runs
  forward migrations (so a v5 backup → v8 app applies v6→v8 after the restore).

### Tests

- Round-trip: encode → compress → encrypt → decrypt → decompress → decode →
  equal bytes.
- Cross-schema-version restore: v5 backup into v8 app.
- Wrong passphrase: GCM auth tag fails cleanly.
- Truncated ciphertext: GCM auth tag fails cleanly.

## Phase 5 — Backup targets (`packages/backup-{local,github,vault}`)

- `backup-local`: `<a download>` + `<input type="file">` baseline; File System
  Access API for persistent folder (Chromium); Tauri `plugin-dialog` +
  `plugin-fs` for native (autodetected).
- `backup-github`: Contents API, fine-grained PAT, single rolling `backup.bin`
  file. Not LFS.
- `backup-vault`: HTTP client for the optional vault server (Phase 9).

App opts in via dependency. `templates/minimal` depends on `backup-local` only;
hipo can add `backup-github` later.

## Phase 6 — Bootstrap & restore flow

**Status: closed 2026-05-25.** Bootstrap landed in `43affa7`; the
GitHub/fs-access "configure at bootstrap" extension was considered and
declined — those targets stay in Settings → Storage where the user
already has a logged-in session + the secrets-vault to encrypt PATs.
The bootstrap UI only needs to give the user a way to seed durable
state on a fresh device, and the download-target's "save a file now"
ceremony does that without dragging a PAT-entry form into a pre-setup
page. The dashboard banner + Settings panel cover ongoing target
configuration.

Lives in `packages/server` (the bootstrap UI is a small framework concern, even
though it renders React). Or in a new `packages/bootstrap` if it grows too much.

`main.tsx` reorders:

1. Register the merged SW (from `packages/sw`). If activation forces a reload,
   it happens before any further code runs.
2. Detect OPFS state.
3. If empty → route to `/bootstrap`:
   - **New install** — prompt for passphrase, optionally download an initial
     backup as a sanity check, proceed to app's setup flow.
   - **Restore from backup** — pick file → enter passphrase → decrypt → write
     to OPFS → reload → boot normally.

Passphrase: in-memory per session only. Re-entered once per session.

## Phase 7 — Backup cadence + integrity + system status

In `packages/backup`:

- Auto-backup on a timer (default daily) and after large mutations.
- After every upload: immediately re-fetch, decrypt, confirm round-trip. Red
  banner if it fails.
- Nudge if no backup in >7 days.

### `/api/system/status` — framework-provided endpoint

A single endpoint the UI can call to render "where is my data, how safe is it,
what can lose it." Structured facts only — UI handles i18n.

```ts
interface SystemStatus {
  status_schema_version: 1; // bump on structural changes; additive fields don't bump
  framework_version: string; // semver of @framework/server
  shape: "browser" | "tauri" | "pwa" | "server" | "server-replica";
  shape_details: {
    browser?: { name: string; version: string };
    tauri?: { os: "windows" | "linux" | "macos"; app_data_dir: string };
    pwa?: { installed: boolean };
    server?: { url: string };
  };
  storage: {
    backend: "opfs" | "libsql-local" | "libsql-remote";
    estimated_usage_bytes?: number; // navigator.storage.estimate()
    estimated_quota_bytes?: number;
  };
  backups: {
    targets: {
      id: string; // "github" | "local-download" | "fs-access" | "tauri-fs" | "vault"
      configured: boolean;
      last_backup_at?: number; // unix seconds
      last_verify_at?: number;
      last_verify_ok?: boolean;
    }[];
    next_scheduled_at?: number;
  };
  risk_flags: {
    no_backup_configured?: boolean;
    no_recent_backup?: boolean; // > 7 days
    last_verify_failed?: boolean;
    near_storage_quota?: boolean;
    cleared_by_browser_data_clear?: boolean; // true on browser/PWA, false on Tauri/server
    survives_device_loss_via_backup?: boolean; // configured + recent target exists
  };
}
```

### Why this shape

- **Facts, not strings.** UI catalogs translate `risk_flags` into localised
  messages. The framework supplies the truth; the consumer decides the words.
  Stays UI-library-agnostic.
- **One round trip.** UI renders the whole panel from one call.
- **`shape_details.tauri.app_data_dir` exposes Mechanism B's path** to power
  users directly — no need to look up OS conventions.
- **Risk flags drive the UI's tone.** Green if
  `survives_device_loss_via_backup`, yellow if `no_recent_backup`, red if
  `no_backup_configured || last_verify_failed`.

### Where it lives

- Route + types in `packages/server`. Substrate; all consumers get it.
- Each `BackupTarget` implements `getStatus(): Promise<TargetStatus>` (target
  ID, last backup/verify timestamps). The endpoint aggregates.
- Shape detection lives in `packages/server`: in-page router inspects
  `globalThis.__TAURI__` / `navigator.userAgent` / display-mode matchMedia to
  set `shape`; deployed router hard-codes `shape: "server"`.

### Reference UI

`templates/minimal/` renders the status panel using minimum-viable UI
primitives. Consumers replace with their own styling (antd Card in hipo,
Tailwind elsewhere). The minimal version is the contract test: if the framework
changes the SystemStatus shape, minimal must keep rendering.

### Backwards-compatible UI hook (optional)

`packages/frontend-core/src/useSystemStatus.ts` — typed React hook wrapping the
fetch. Refreshes after every backup attempt. Suspense- free; returns
`{ status, loading, error, refresh }`.

## Phase 8 — Tauri trim + `packages/tauri-shell` extraction

Once Phase 3 has been default for a release and is stable:

- Remove sidecar spawn, `externalBin`, `HIPO_AUTH_TOKEN` env wiring,
  `HIPO_READY` parsing.
- `apps/hipo/tauri/` (née `apps/desktop/`) Rust shell + `tauri.conf.json`
  template moves into `packages/tauri-shell/`.
- `apps/hipo/tauri/` becomes a thin layer that overrides name/icon/ identifier
  and pulls in the shell template.
- Framework-level Tauri capabilities: `dialog:default`,
  `fs:allow-write-text-file`, `fs:allow-read-text-file` (scoped),
  `updater:default`.
- `deno compile` step deleted from `build:desktop:*` scripts.

Expected bundle drop: hipo's sidecar alone is 387 MB (see
[[project-hipo-build-gotchas]]); eliminating it leaves the Tauri install at
roughly Rust shell + React + WASM, in the low tens of MB.

**Release-time verification checklist** (add to release runbook):

- `cargo tauri build` produces installer; install on a clean VM, app boots,
  login + a sample mutation work.
- Auto-updater check from Settings round-trips against the dummy release feed.
- **Mechanism B portability spot-check**: install on machine A, create some
  data, copy the dataDir to machine B (same OS), launch — verify data is present
  and the app is functional. Catches accidental introduction of per-install
  device-fingerprinting into OPFS contents (which would silently break Mechanism
  B without breaking anything else). Do this for both Linux and Windows builds.
- Encrypted backup round-trip on a real install (create → backup → restore on a
  fresh install → verify).

### Phase 8A outcome (2026-05-18)

Tauri trim shipped for **Windows only**. The in-page-backend topology needs
`FileSystemSyncAccessHandle` for SQLite-WASM's OPFS pool VFS, and webkit2gtk
2.50.6 (Debian 12) doesn't implement it — the API is missing from the binary,
not gated. We confirmed the gap with a `createSyncAccessHandle()` probe inside a
real webkit2gtk Worker. WebKit's general FS Access surface (`navigator.storage`,
`FileSystemFileHandle`, async writable streams) is gated off but present; we
enable it for dev iteration via direct C-FFI to
`webkit_settings_set_feature_enabled()` plus `JSC_useSharedArrayBuffer=1` (both
in `packages/tauri-shell`'s Linux-only path), but the sync handle is the
load-bearing piece sqlocal needs and can't be recovered.

**Decision:** ship Tauri for Windows only; Linux users go to the Pages-hosted
in-page build (Chromium/Firefox have full OPFS). The framework's in-page
topology stays uniform across all _shipped_ surfaces — no `target_os` branching
in `packages/tauri-shell`'s runtime topology. If webkit2gtk ever adds the sync
handle, the existing feature-flag enablement is already in place — the only gate
left to remove is the Linux-Tauri-not-shipped policy itself. See
`memory/project-webkit2gtk-opfs.md` for the full investigation.

**Reopened by Phase 12.** "Sunsetted" was the right call given the information
available 2026-05-18, but the architectural answer turned out simpler than the
OPFS gap implies: stop using SQLite-WASM on the Tauri shape entirely. Phase 12
routes Drizzle's queries to a native-SQLite Rust backend via
`drizzle-orm/sqlite-proxy` — webkit2gtk's missing API stops mattering because
the in-page SQLite engine isn't part of the Tauri shape. Phase 8A's scaffolding
(JSC SAB env var, C-FFI feature flags, COI in the merged SW) stays useful for
non-SQL storage paths.

**Phase 8B — DROPPED 2026-05-25.** The original idea (drop
`build:desktop:linux` + `ubuntu-22.04` from the matrix) was a fallback for
the world where Linux Tauri stayed sunset. Phase 12 reopened that decision:
Linux Tauri is back via rusqlite + Drizzle proxy, validated end-to-end on
WebKitGTK 2.50.6, and the CI matrix's ubuntu-22.04 leg is intentional.
Nothing to clean up.

## Phase 9 — Decide what `apps/hipo` (née `apps/backend`) becomes

Three coherent endings:

- **Slim to a vault, _keep server-ready_.** Strip hipo-specific routes, leave
  the auth + blob-storage routes for the backup vault. Crucially, keep the
  router + Drizzle + libsql server infrastructure intact and reusable so any
  consumer can promote to a shared-DB deployment (see "Promotion path" below).
  Move the vault piece into `packages/backup-vault-server` (sibling to
  `packages/backup-vault` the client). The remainder becomes a
  `packages/server-deploy` (or similar) holding deploy templates + libsql server
  config that any app can opt into when it wants the shared-DB shape.
- **Delete it.** Fully commit to local-first. Lose the "standalone HTTP server"
  deployment shape and make the promotion path expensive.
- **Keep it for hipo only** as a transitional fallback while the in-page shape
  matures. Delete after a release.

**Recommend the first option.** A vault is small (~50 LOC); the server-deploy
template even smaller; together they preserve the multi-user upgrade path
described in the Promotion section below at near-zero ongoing cost. Deleting
closes a door we shouldn't close.

## Phase 10 — Publishing (deferred)

Per Option B, defer until a second consumer materialises or until a specific
package wants to be installed outside the monorepo.

When publishing is wanted, per-package:

1. Add `tsc --emit` build producing `dist/` (ESM + types).
2. Add `exports` map in `package.json`.
3. Switch source from `.ts` extension imports to `.js` (or extensionless +
   bundler resolution).
4. Publish under a chosen scope. MIT.
5. Update consumer (hipo or other) to depend on the npm version, keeping the
   workspace symlink path as a dev override (`workspaces` + `overrides` in root
   package.json).

The packages most likely to want publishing first: `packages/sw`,
`packages/sqlite`, `packages/backup`. The ones most likely to evolve = `auth`,
`audit`, `i18n` — defer those longest.

## Phase 11 — Hosting, headers, docs

**Status: landed 2026-05-19.** Deliverables 1–6 shipped; deliverable 7
(Phase 8B cleanup) is moot now — Linux Tauri came back via Phase 12, the
CI matrix's ubuntu-22.04 leg is intentional, and `build:desktop:linux` is
load-bearing. See `memory/project-status.md` for the commit hash +
verification details.

The framework's primary demo deploy. Required by
[[feedback-github-pages-mandatory]] and load-bearing for Linux users
post-Phase-8A — the documented Linux path is "open the Pages build in Chromium /
Firefox" and that URL didn't exist before this phase.

### Deliverables

1. **GitHub Pages workflow** (`.github/workflows/pages.yml`):
   - Triggers on `v*` tag pushes + manual dispatch (changed from
     push-to-`main` in commit `20a6899`, 2026-05-25 — same `v*` tag drives
     `release.yml`, so Pages + installers ship in lockstep).
   - Runs `npm run build:frontend:inpage` against the chosen demo consumer
     (`templates/minimal` first, hipo later if wanted).
   - Deploys via `actions/deploy-pages@v4` to
     `https://<owner>.github.io/<repo>/`.
   - Pre-deploy step asserts the merged SW lands at the right path and
     `index.html` registers it.
   - **One-time env setup**: repo Settings → Environments → `github-pages`
     → "Deployment branches and tags" must permit `v*` tag pattern (default
     is branch-only, which rejects the first tag deploy with `Tag "v0.1.X"
     is not allowed to deploy to github-pages due to environment protection
     rules`).
2. **Post-deploy smoke** — a Playwright job hits the deployed URL, confirms the
   SW forces the COI reload, `crossOriginIsolated` resolves to `true`, and the
   bootstrap → setup → take-a-backup round-trip succeeds. Runs on a
   Chromium-only matrix in v1 (the templates/minimal local harness already
   covers Firefox + WebKit surface-area).
3. **`packages/sw` extraction** — promote `apps/hipo/frontend/public/sw.js` into
   a real package per Phase 1's original structure. Required so future consumers
   don't copy-paste the COI + `/api/*`-routing SW. Vite plugin or static-copy
   hook handles build-time placement.
4. **Release index page** — `apps/hipo/frontend/public/releases.html` (or served
   by Pages) lists: current Pages demo URL, latest Tauri installer per OS (links
   to GitHub Releases), updater feed URL, signing-key fingerprint. Small static
   HTML; updated by the same release workflow that publishes installers.
5. **ESLint `no-restricted-imports`** — enforce "no `apps/*` imports inside
   `packages/*`" per Phase 1 principle #1. Convention only today; one ESLint
   rule closes the loophole.
6. **Documentation refresh** — root README links the Pages URL at the top;
   `packages/tauri-shell/README` declares the Linux path (Pages today, native
   via Phase 12 later); CLAUDE.md gets a pointer to the demo URL.
7. ~~**Phase 8B cleanup**~~ — dropped 2026-05-25. Phase 12 brought Linux Tauri
   back, so `build:desktop:linux` + `ubuntu-22.04` in the matrix are
   load-bearing, not deferred cleanup.

### Why now

Pages is the documented Linux escape hatch after Phase 8A. Until the URL exists,
Linux is undocumented. Bootstrap (Phase 6) and the backup pipeline (Phases 4–7)
had to land first — a Pages site with an empty stub would have looked broken on
first contact.

### Versioning

The Pages deploy is the rolling "latest main" build. Tauri installers on GitHub
Releases are tagged versions. They diverge; the release index page exposes the
divergence explicitly ("Pages: commit `<sha>` of `<date>` — Installers:
v0.3.1").

## Phase 12 — Linux Tauri via native SQLite + Drizzle proxy

Reopens Phase 8A's decision. Instead of polyfilling the missing OPFS sync API in
the webview, **stop using SQLite-WASM on the Tauri shape entirely**: route
Drizzle's queries to a native-SQLite Rust backend via
`drizzle-orm/sqlite-proxy`. The webkit2gtk gap stops mattering because the
in-page SQLite engine isn't part of the Tauri shape.

### Topology (Tauri only — Pages unchanged)

```
Frontend Worker
  └─ Drizzle (sqlite-proxy driver)   ← thin adapter
       │
       │  invoke("db.exec" | "db.query" | "db.txn.*")
       ▼
Tauri Rust process
  └─ rusqlite   →   <app_data_dir>/hipo.db   (real SQLite file)
```

Pages / browser shape stays sqlocal + SQLite-WASM + OPFS. Server shape stays
libsql + Drizzle. The framework's `Ctx { db, user }`, `do_*` ops, and migration
runner are unchanged across all three — Drizzle's proxy driver is the
isomorphism point.

### Approach pick: rusqlite vs `tauri-plugin-sql`

- **rusqlite (hand-rolled commands)** — `db_exec(sql, params)`,
  `db_query(sql, params) → rows`, `db_txn_begin() → handle`,
  `db_txn_exec(handle, …)`, `db_txn_commit(handle)`, `db_txn_rollback(handle)`.
  ~150 LOC Rust, full control over pragmas, WAL settings, prepared-statement
  caching. Apache/MIT.
- **`@tauri-apps/plugin-sql`** — official, MIT/Apache, less code, opinionated
  API. The Drizzle proxy still has to adapt to its `execute()/select()` surface.

Decide during the Phase 12 spike. Default: rusqlite for control.

### Code surface (rough)

| Piece                                                          | LOC  | Where                                       |
| -------------------------------------------------------------- | ---- | ------------------------------------------- |
| Rust SQL commands (exec / query / txn lifecycle)               | ~150 | `packages/tauri-shell/src/sql.rs`           |
| Drizzle proxy driver                                           | ~30  | `packages/sqlite/src/client-tauri.ts`       |
| Connection factory: detect shape, return proxy or sqlocal      | ~20  | `packages/sqlite/src/openDb.ts`             |
| Capability allow-list                                          | ~10  | `apps/hipo/tauri/capabilities/default.json` |
| Vite build condition: omit SQLite-WASM from Tauri inpage build | ~5   | `apps/hipo/frontend/vite.config.ts`         |
| Tests (parity smoke + transaction lifetime)                    | ~150 | new                                         |

**~365 LOC total**, about half the OPFS-polyfill alternative. No `target_os` cfg
in the Rust shell — Rust SQL commands compile on all platforms; the Drizzle
proxy is runtime-selected based on shape detection.

### Pre-commit spikes

1. **SQL parity.** Pin SQLite-WASM version (whatever sqlocal ships today) and
   match rusqlite's `bundled` SQLite to within a patch version. Run every
   existing hipo + framework migration against both engines plus a
   representative SELECT set; diff results byte-for-byte where possible.
2. **IPC throughput.** Time `BEGIN; INSERT × 10k; COMMIT;` and a 1000-row SELECT
   via the proxy. Budget: ≤ 3× the in-process SQLite-WASM number. If worse,
   batch via "execute many" commands.
3. **Transaction lifetime over IPC.** Verify rusqlite (or tauri-plugin-sql)
   supports holding a transaction across multiple IPC calls (open txn handle,
   several statements, commit). Drizzle's proxy mode expects this. If
   unsupported, fall back to "submit the whole txn body in one call" pattern.

### Risks

- **Engine drift.** SQLite-WASM is built with specific compile-time options
  (FTS5, JSON1, RTREE). rusqlite's bundled build may differ. Mitigation: pin
  both; parity smoke per release.
- **Connection ownership.** Multi-window Tauri (not on the roadmap) would need
  explicit per-window or per-app connection pooling.
- **Build complexity.** rusqlite's `bundled` feature adds C compilation to the
  Tauri build. Already true for other native Rust crates in the shell; not a new
  burden.
- **Cross-compile.** Linux→Windows via `cargo-xwin` (already wired) must include
  rusqlite's bundled SQLite. Verify in the Phase 12 spike — falling back to
  `tauri-plugin-sql` is the easy out.

### What stays from Phase 8A

- The `JSC_useSharedArrayBuffer=1` env var and
  `webkit_settings_set_feature_enabled()` C-FFI block stay — they enable async
  `navigator.storage` / `FileSystemFileHandle` / Cache API for non-SQL paths.
- COI in the merged SW remains required.
- Tauri 2 shell topology is unchanged; Phase 12 only adds new IPC commands.

### Bundle impact

- **Tauri:** drops SQLite-WASM (~600 KB gz). Net Tauri installer shrinks
  proportionally.
- **Pages:** no change (still SQLite-WASM in the Worker).
- **Server shape:** no change (still libsql in Deno).

### Triggers (when to actually start)

- A Linux user reports the Pages-only workflow as friction (terminal launchers,
  system-tray integration, `.desktop` entries — things Pages can't deliver).
- A second consumer needs Linux Tauri.
- Windows installer bundle weight becomes a complaint (in which case extend
  Phase 12 to Windows Tauri too — see below).

### Optional extension: native SQLite on Windows Tauri too

Same proxy on Windows. Drops SQLite-WASM from every Tauri build, unifies the
Tauri data path. Pages remains SQLite-WASM. Defer until Linux works end-to-end —
clean follow-on, not a prerequisite.

### Decision on Phase 8A

Moves from **"Linux Tauri sunsetted"** to **"Linux Tauri restored via Phase
12 (native SQLite through the Drizzle proxy)."** Phase 8B is consequently
dropped (2026-05-25) — CI matrix's ubuntu-22.04 leg and the
`build:desktop:linux` script are load-bearing now.

### Rejected alternative: OPFS polyfill via SAB + Tauri-IPC bridge

A previous Phase 12 draft proposed polyfilling `FileSystemSyncAccessHandle` via
a `SharedArrayBuffer + Atomics.wait` bridge to Tauri-Rust file I/O. That would
have kept SQL-engine parity at the cost of ~700 LOC of clever browser-API
reimplementation, per-syscall IPC round-trips (vs per-query), and a hard barrier
to SQLite WAL mode. Rejected 2026-05-19 in favour of the Drizzle proxy approach
— same engine-divergence outcome at the backup-format / migration layer (none),
but substantially less novel code and a smaller Tauri bundle. The polyfill
approach remains viable if engine parity ever becomes a hard requirement and the
LOC cost is acceptable.

## Phase 13 — Single-tab guarantee for the hosted shape

OPFS sync access handles are exclusive per origin. Without coordination, opening
a second tab of the hosted app makes sqlocal's `opfs-sahpool` VFS fail to
acquire the handle; the second tab silently falls back to in-memory and diverges
from the first. The plan's Phase-3 "Risks" entry deferred a BroadcastChannel
"only-one-writer" mitigation; user direction 2026-05-19 promoted this to a real
phase, initially designed around a SharedWorker for full multi-tab. A subsequent
review (same session, post-Slice 0 questioning) collapsed it further to
**modal-only** — second tab gets refused, no SharedWorker.

### Design — modal-only (LANDED 2026-05-20)

Every tab boots its own dedicated Worker (unchanged from Phase 3). Before
spawning the Worker, the main thread probes a named Web Lock:

```ts
navigator.locks.request("hipo-db", { mode: "exclusive", ifAvailable: true }, ...)
```

- **Lock acquired** → hold for the page lifetime (browser releases on unload);
  proceed with the normal boot path.
- **Lock unavailable** → another tab owns it. Render `MultiTabBlock` ("Already
  open in another tab"); poll `navigator.locks.query()` every ~1 s; on release,
  `location.reload()` so the bootstrap path runs cleanly from the top.

No SharedWorker, no `onconnect`, no SW-side multi-port routing, no per-clientId
mapping. The DB-owning Worker stays per-tab, exactly as today.

### Why not SharedWorker

The earlier design (SharedWorker per origin + per-tab MessagePort routing
through the SW) gives "full multi-tab" — both tabs hit the same DB through one
shared engine. That capability isn't worth the code on a 1-10 person admin tool:
users almost never have two tabs of the same admin app open simultaneously, and
the Tauri shape is single-window anyway. The modal-only design collapses the
cross-browser path to one (iOS Safari + WebKitGTK + everything-else all take the
same route), drops ~130 LOC of SharedWorker plumbing and per-clientId SW
routing, and removes a permanent class of "what happens when the SharedWorker
dies under memory pressure" edge cases.

### Tradeoff (explicitly accepted)

Users cannot have two tabs of the app open simultaneously. The second tab's
modal is the entire interaction — no read-only mode, no "comparing data
side-by-side". For the hipo use case this is fine; if a future consumer
genuinely needs multi-tab, the SharedWorker variant remains documented below as
a rejected alternative.

### Supported-browser matrix

| Browser                           | Path                                             |
| --------------------------------- | ------------------------------------------------ |
| Chromium / Edge / Brave           | Web Locks → modal in second tab                  |
| Firefox                           | Web Locks → modal in second tab                  |
| Safari (desktop ≥ 15)             | Web Locks → modal in second tab                  |
| Safari iOS                        | Web Locks → modal in second tab                  |
| WebKitGTK ≥ 2.42 (Pages on Linux) | Web Locks supported — verify in pre-commit spike |

### Code surface (actual, post-landing)

| Piece                                                              | LOC  | Where                                                  |
| ------------------------------------------------------------------ | ---- | ------------------------------------------------------ |
| Web Lock helpers (`tryAcquireLock`, `observeLockReleased`)         | ~70  | `packages/server/src/tab-lock.ts`                      |
| Boot-path probe + render gate                                      | ~15  | `apps/hipo/frontend/src/main.tsx`                      |
| "Already open elsewhere" page (antd)                               | ~55  | `apps/hipo/frontend/src/MultiTabBlock.tsx`             |
| Same for minimal template (plain CSS)                              | ~30  | `templates/minimal/src/MultiTabBlock.tsx` + `main.tsx` |
| Vitest cases (6 — acquire, ifAvailable false, release, observe x3) | ~120 | `apps/hipo/frontend/src/tab-lock.test.ts`              |
| Playwright multi-context spike                                     | ~140 | `spikes/06-multi-tab/multi-tab.mjs`                    |

**~430 LOC including tests + spike.**

### Tauri shape

Phase 12 puts SQLite in the Rust process. Multi-tab is moot on Tauri: a Tauri
app is one window by default, and the lock probe always succeeds (the API exists
in webkit2gtk; cost is one async call at boot). No conditional needed.

### Server shape

Shape 2 / Shape 3 are inherently multi-tab: each tab is just a session against
the shared DB. The Phase 13 work is hosted-shape-specific; nothing changes
server-side.

### Pre-commit spike

`spikes/06-multi-tab/multi-tab.mjs` runs in CI / locally against `dev:inpage`.
Verifies:

1. Tab A boots → acquires the lock → renders bootstrap UI.
2. Tab B opens → sees lock held → renders `MultiTabBlock` with the i18n'd
   "already open" copy.
3. Tab A closes → Tab B's polling notices within ~1 s and auto-reloads.
4. Tab B's reload acquires the lock cleanly and renders the bootstrap UI.

**Deferred (requires Pages deploy):** WebKitGTK Pages path — confirm
`navigator.locks` works as expected on the Pages-served bundle running inside
the Linux Tauri build's webkit2gtk.

### Risks

- **Lock-release polling.** No event API for "released" in standard Web Locks;
  polling `navigator.locks.query()` is cheap but inelegant. 1-second cadence is
  imperceptible for the "I closed the other tab" UX.
- **Web Locks API absence.** If a future browser ships without Web Locks
  support, `tryAcquireLock`'s try/catch falls through and the second tab boots
  normally → silent OPFS divergence again. Browser-version probe at boot is a
  future hardening; the current matrix (all evergreen modern browsers + iOS
  Safari 16+) covers it.
- **Race window during reload.** Between "Tab A unloads" and "Tab B's
  `location.reload()` finishes acquiring the lock," there's a sub-second window
  where a third tab opened in that gap could grab the lock first. Acceptable
  edge.

### Triggers

User stated 2026-05-19 (refined 2026-05-20): required for the hosted shape.
Sequenced after Phase 11 so the Playwright multi-context test runs against the
real deployed URL — but the modal-only design lets the spike run against
`dev:inpage` locally, so it's not gated on Pages deploy.

### Supersedes

The "Multi-tab with same OPFS" risk in the **Risks** section below (originally
tagged "Add in Phase 3 once the Worker topology lands"; the topology did land
but the mitigation didn't — Phase 13 closes that loop with a Web-Lock + modal
design lighter than the originally-sketched BroadcastChannel approach and the
intermediate SharedWorker proposal).

### Rejected alternative: SharedWorker for full multi-tab

Considered and rejected 2026-05-20. One SharedWorker per origin owns the OPFS
handle; per-tab MessagePort routes `/api/*` from each tab's SW through the
SharedWorker. Pros: users can have N tabs open simultaneously, all sharing
state. Cons: ~130 LOC more (`packages/server/src/shared-worker.ts` +
`packages/sw/src/sw.js` multi-port routing + per-clientId SW map), three
distinct browser paths to verify (Chromium-style SharedWorker + iOS-style modal
fallback + WebKitGTK uncertainty), and SharedWorker-termination edge cases under
memory pressure that require reconnect + request-replay logic. The tradeoff
isn't worth the gain for the hipo use case. Preserved here so a future multi-tab
requirement (e.g. a consumer where side-by-side editing matters) has a starting
design instead of a from-scratch one.

## Promotion path: local-first → shared server

The framework's default deployment is single-user-per-device, OPFS-backed. But
many apps eventually want shared state across users. Because of the
architectural choices the framework makes (isomorphic router via `app.fetch`,
platform-agnostic `do_*(ctx, args)` ops, Drizzle abstraction, pluggable auth),
**promoting to a shared-DB deployment is configuration, not rewrite.** Document
the promotion path explicitly so consumers know it's a supported transition.

### Three deployment shapes as a progression

```
   single-user, local                       multi-user, shared
   ┌──────────────┐    ┌──────────────┐    ┌────────────────┐
   │ Browser /    │ →  │ Same app +   │ →  │ Same app + DB  │
   │ Tauri / PWA  │    │ Same router  │    │ per org        │
   │ OPFS DB      │    │ + shared DB  │    │ (multi-tenant) │
   └──────────────┘    └──────────────┘    └────────────────┘
   Shape 1             Shape 2              Shape 3
```

|                 | Shape 1: local                  | Shape 2: shared server                       | Shape 3: SaaS                       |
| --------------- | ------------------------------- | -------------------------------------------- | ----------------------------------- |
| DB lives        | OPFS / dataDir per device       | One server, one libsql file                  | Server, one libsql file _per org_   |
| Auth            | passphrase + in-memory token    | cookie sessions (already in `packages/auth`) | same + signup + org-scoped sessions |
| Backup          | client-side encrypted blobs     | Litestream → S3 + optional client export     | per-org Litestream + per-org export |
| Multi-user      | no — each device has its own DB | yes, real-time-ish (poll or SSE)             | yes, isolated per org               |
| Offline         | yes                             | no                                           | rarely                              |
| Ongoing cost    | $0                              | ~$5/mo VM + ~$0.50/mo backup storage         | scales with orgs                    |
| Effort to reach | n/a (start here)                | day or two from Shape 1                      | week or two from Shape 2            |

### Concrete migration recipe: Shape 1 → Shape 2

1. Provision a host (Fly.io / Deno Deploy / Render). $5/mo VM is fine for ≤100
   users.
2. Build `apps/hipo` (kept alive via Phase 9 option 1) from the same source.
   Same router routes, same `do_*` ops, same migrations.
3. Set `VITE_BACKEND_URL` to the deployed URL.
4. Turn off the in-page Worker + SW routing (`VITE_INPAGE_BACKEND=0`).
5. Re-enable cookie sessions in `packages/auth` (already a supported strategy —
   was just disabled for in-page-only mode).
6. Wire Litestream (or equivalent) for server-side incremental backups.
7. **Consolidate existing user data**: each user exports their OPFS backup;
   admin imports/merges them. This is a discrete migration moment, not a
   continuous flow. Document and rehearse it.

Frontend / `do_*` / Drizzle / migrations / audit log / route handlers — zero
changes.

### Concrete migration recipe: Shape 2 → Shape 3

Per `[[project-hipo-deployment-directions]]`'s pre-existing plan: **one libsql
file per org**, filesystem-isolated. Subdomain (or path) routes to the right DB.
Filesystem isolation makes "can't accidentally leak data between orgs" a
property of the system rather than a query discipline. The do\_\* layer doesn't
change — it still operates on a single `Ctx.db`; the routing layer picks which
DB that is per request.

### When _not_ to promote

- **Genuinely single-user apps** (personal trackers, notes for one person). Stay
  on Shape 1. Encrypted backups give cross-device continuity without the cost of
  running a server.
- **Apps where "shared" means real-time multi-user collaboration**
  (collaborative editors, kanban with simultaneous moves). Shapes 1/2/3 give
  shared state, not real-time conflict resolution. Future paths: ElectricSQL
  (sync layer over SQLite), cr-sqlite (CRDT extension), Y.js / Loro (CRDT
  document stores). All are weeks of work, not days. Out of scope for v1.

### What the framework owes consumers around this

- **A documented, rehearsed migration recipe** (the recipe above lives in this
  doc; should also appear in `packages/server-deploy/README`).
- **The router app stays runnable as a real server** even though most consumers
  will run it in-page. This is a non-negotiable framework property — protected
  by Phase 9 keeping the server-ready code alive.
- **`packages/auth` keeps cookie sessions as a strategy** alongside in-memory
  tokens. Re-enabling is a config switch.
- **Schema and migrations are identical across shapes.** A Shape 1 install can
  be migrated to a Shape 2 deployment without schema surgery — only data
  consolidation.
- **Backup format compatibility.** A Shape 1 encrypted backup can be imported on
  a Shape 2 server (`importDb` works against either DB). This is what makes the
  user-data consolidation step in the migration recipe possible.
- **System-status endpoint.** `/api/system/status` returns the same shape across
  all deployment targets; the `shape` field tells the consumer which deployment
  is active. UIs can present a consistent "where is my data" panel without
  per-shape branching.

## Data portability — moving an install between machines

Two parallel mechanisms, both legitimate. Document both; recommend the first for
end-users.

### Mechanism A: framework-managed encrypted backup (primary, all shapes)

- Goes through `packages/backup` + a `BackupTarget`.
- Passphrase-encrypted, cross-platform, durable across webview / Tauri version
  changes.
- Works for browser shape, PWA-install shape, and Tauri shape.
- Requires the user to remember the passphrase. Required reading: "Things to
  nail down" in Phase 6.

### Mechanism B: OS-level Tauri dataDir copy (power-user, Tauri only)

Tauri's webview stores OPFS (and IndexedDB, cookies, localStorage) in a known
per-app directory on disk. Copy it between Tauri installs of the same app on the
same OS and the new install boots with the old data. Effectively a "portable
Tauri install."

| OS      | Path                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| Linux   | `~/.local/share/<bundle-identifier>/` (WebKitGTK storage subdir)                   |
| Windows | `%LOCALAPPDATA%\<bundle-identifier>\` (WebView2 storage subdir)                    |
| macOS   | `~/Library/Application Support/<bundle-identifier>/` (not currently a hipo target) |

Caveats — bake into the docs for power users:

- **Same OS + same webview only.** WebView2 layout ≠ WebKitGTK layout. A Windows
  export can't be raw-copied to Linux. (Mechanism A is what bridges that.)
- **Plaintext on disk.** Anyone with file-system access can read it.
- **Brittle to Tauri / webview version changes.** Layouts can shift.
- **Carries auxiliary state** (cookies, localStorage). Usually fine; sometimes
  carries stale session state you'd rather not transport.

This mechanism is documented capability, not framework-built feature. The
framework owes nothing here except _not breaking it inadvertently_ (don't add
per-install device fingerprinting to OPFS contents, etc.) and verifying it still
works each release (see Phase 8 checklist).

### Does not apply: plain browser shape

The browser owns its OPFS storage location and doesn't expose it as a copyable
file. Mechanism A is the only path for the browser shape.

## Versioning policy

Multiple things have versions in this framework and they evolve at different
rates. Codifying the rules up front prevents the "v2 broke my v1 backup" class
of bug.

### 1. Encrypted backup envelope — explicit `envelope_version` + `format`

The envelope is the framework's most durable artifact — backups made today may
be restored years from now after many framework upgrades. Two fields control
evolution:

- **`envelope_version`** (starts at `1`): the shape of the envelope itself.
  Bumped only when the structure changes (adding/removing required fields,
  changing crypto primitives). Decoders reject unknown values rather than
  guessing.
- **`format`** (string, e.g. `"binary-gzip"`): the encoding of the inner bytes.
  New formats coexist by getting new names. Decoders dispatch by `format`;
  unknown formats fail clearly with "this backup needs a framework feature this
  version doesn't have."

**Restore policy:**

- _Within a major framework version:_ every backup ever made must remain
  restorable. Period. New `format` values are additive.
- _Across major framework versions:_ if `envelope_version` changes, ship a
  one-time migrator. Old envelopes are read-only-compatible for at least one
  major version.
- **Never break a published backup.** The framework's job is to protect data the
  user trusted it with. Backups outlast features.

### 2. Status endpoint — `status_schema_version` + additive evolution

- **Additive fields don't bump the schema version.** New `risk_flags`, new
  `target.id` values, new `shape` strings — UIs are required to ignore unknown
  values gracefully. The `status_schema_version` stays the same.
- **Structural changes bump.** Renaming a field, changing a type, removing a
  field. The endpoint returns _both_ old and new shapes for one minor version,
  then drops the old shape.
- **UIs should code defensively.** Treat any unknown `risk_flags` key as a
  "yellow flag" (not "no problem") so a future framework warning isn't silently
  lost on an old UI.

### 3. Migrations — IDs are forever

Lexicographic migration ID format (`YYYYMMDDHHMMSS_<pkg>_<slug>`) is
load-bearing. **Never reformat it.** A user restoring a backup from two years
ago must find that their old migration IDs still parse and sort correctly
relative to new ones.

If a migration ever has a bug, **do not edit it.** Ship a forward- fixing
migration with a later ID that corrects the state. Editing an applied migration
breaks every existing install.

### 4. Per-package versions

Pre-1.0 (the framework's current state):

- All packages in the monorepo share a single repo-wide version.
- Breaking changes allowed at any minor bump.
- Document each breaking change in the package's CHANGELOG.
- `templates/minimal` and `apps/hipo` must both still boot after every change —
  that's the contract test.

Post-1.0 (when individual packages start publishing per Phase 10):

- Each published package follows SemVer independently.
- Cross-package dependencies use caret ranges (`^x.y.z`) within a major.
- Breaking changes require a major bump _and_ a documented migration path _and_
  at least one minor version with both old + new behaviour before old is
  removed.

### 5. Database schema version (separate from framework version)

The `migrations` table records every applied migration ID. A backup records its
migration state implicitly (it's a snapshot of the table). On restore:

- App opens the restored DB, reads `migrations`.
- Compares against the package-merged migration list (sorted lex).
- Applies any not-yet-recorded forward migrations.
- App boots normally.

This is what makes "backup made on framework v1.2 restored on framework v1.5"
work: the restored DB is from migration set ≤ v1.2; v1.3–1.5 migrations are
applied on first open after restore.

**Schema downgrade is not supported.** A backup made on v1.5 cannot be opened on
v1.2. Document this in the restore UI: "this backup was made on a newer version;
please upgrade before restoring."

### 6. Tauri / webview compatibility

- The Tauri shell version, webview version (WebView2 / WebKitGTK), and framework
  JS version are independent. The auto-updater handles shell + JS; the webview
  is at the mercy of the OS.
- **Document a minimum webview version** in the README per OS. Test the bottom
  of the matrix on each release.
- **Mechanism B (dataDir copy) compatibility:** same Tauri shell version + same
  webview version family across the two installs. Cross-version copy is
  undefined — falls back to Mechanism A.
- The release runbook (Phase 8) must spot-check both mechanisms on a clean
  install of the _previous_ shell version, not just the current one.

### 7. What to bump when

| Change                                      | Bumps                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| Add a new `risk_flag` field                 | nothing (additive)                                    |
| Add a new `BackupTarget` package            | that package only                                     |
| New `BackupFormat` (e.g. `"sql-dump-zstd"`) | `packages/backup`'s format registry; not the envelope |
| Change AES-GCM IV length                    | `envelope_version`                                    |
| Rename a status field                       | `status_schema_version`                               |
| Edit an applied migration                   | **don't.** Ship a forward-fix instead.                |
| Break package A's API consumed by package B | both packages' minor (pre-1.0) or major (post-1.0)    |

## Migration discipline (apply throughout)

- Every phase leaves the app working. No big-bang rewrite.
- `VITE_INPAGE_BACKEND` flag is the safety valve through phases 2–7.
- `templates/minimal/` boots at every phase boundary (after the milestone).
- Skip lint/format during big slices (per [[feedback-no-lint-during-initial]]);
  batch at slice end.
- Don't add Sentry/telemetry/state libraries (per [[feedback-minimal-deps]]).
- Each phase: type-check + run tests + manual smoke before moving on.

## Principles

1. **No hipo-specific code anywhere in `packages/*`.** Enforced by review or
   ESLint `no-restricted-imports`.
2. **Each package owns its own migrations.** See decision below.
3. **`templates/minimal/` ships green at all times** (after its milestone). It
   is the framework's build-gate.
4. **Package boundaries don't change casually.** Once `templates/minimal` and
   `apps/hipo` both consume a package's surface, changing it is a real breaking
   change even pre-1.0.
5. **Vite is the supported bundler.** No other-bundler plugins.

## Decisions

### Migration ordering across packages: **lexicographic IDs**

Each migration is named `YYYYMMDDHHMMSS_<package>_<slug>`, e.g.
`20260517_120000_auth_users_table`. The runner loads migration entries from
every package, sorts lexicographically, applies any not yet recorded.

Why lex IDs over numeric ranges per package:

- No need to negotiate ranges between packages.
- Order is self-evident from the filename.
- Adding a migration anywhere is a local change.
- The existing `migrations` table just stores the full string ID.

Each package exports `migrations: { id: string; sql: string }[]`. The app's
bootstrap merges arrays from all packages it depends on + its own, sorts, runs.

## Open questions

1. **WASM adapter pick.** ~~Resolved in Phase 0 spike~~. **Resolved 2026-05-17:
   sqlocal + `@sqlite.org/sqlite-wasm`.** Per Spike 1b, libsql-wasm is 4.4× the
   bundle size for an option (Turso) we explicitly don't care about.
2. **Schema-version skew on restore.** A backup made at app v5 opening in app v8
   should apply forward migrations on first open. The existing `migrations`
   table approach handles this; needs a test in Phase 4.
3. **Passphrase change UX.** Re-encrypt next backup only (recommend) vs
   re-encrypt all historical. v1 = next-only.
4. **Where the bootstrap/restore UI lives.** Currently planned in
   `packages/server`; may want its own `packages/bootstrap` if it grows. Decide
   in Phase 6.
5. **`packages/i18n` scope.** Just react-i18next config + a namespace
   convention, or also locale-switcher UI components? Decide when building the
   first one.
6. **Default backup format.** Plan is binary in v1, SQL dump as a v1.5
   alternative. If real usage suggests users prefer the inspectability of dumps
   over the speed of binary, revisit. The `BackupFormat` abstraction means
   switching defaults later is per-app, not per-framework.
7. **Streaming pipeline threshold.** At what DB size do we switch from in-memory
   buffer to a streamed export→compress→encrypt→ upload pipeline? Measure in
   Phase 0; pick a number after.

## Testing strategy

Three layers, each with a clear scope. The framework's quality bar is defined by
what each layer asserts.

### Layer 1 — Unit / per-package tests

- **Deno tests** (`packages/*/src/**/*_test.ts`): test `do_*` operations against
  an in-memory libsql DB. Same pattern as today's hipo backend tests (57 tests
  across auth/parties/loans/payments/payouts/audit, plus `splitPayment`
  algorithm tests). Fast, deterministic, no browser. These prove the business
  logic regardless of runtime.
- **Vitest** for any React-rendering helpers shipped by the framework (e.g.
  `useSystemStatus` hook).
- Each `BackupTarget` package has its own unit tests with mocked network/FS
  where applicable.

### Layer 2 — Integration / browser E2E (Playwright)

**`templates/minimal/` is the anchor.** Playwright drives a real browser running
the entire local-first stack: OPFS, SW, Web Worker, SQLite-WASM, cross-origin
isolation, encrypted backups, the works.

Test surface (per browser):

| Flow                                               | What it proves                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Bootstrap → new install → login → smoke mutation   | SW activation, Worker init, OPFS write, router dispatch           |
| Mutation → auto-backup → verify → re-fetch state   | backup pipeline (export, compress, encrypt, target write, verify) |
| Wipe OPFS → restore from saved backup → re-login   | restore flow, schema-version forward migration                    |
| Multi-tab open → second tab MultiTabBlock          | the `hipo-db` Web Lock + observeLockReleased polling              |
| Cross-version restore (load v5 backup into v8 app) | migration forward path                                            |
| Wrong passphrase / truncated ciphertext            | AES-GCM auth-tag failure handling                                 |
| `/api/system/status` returns correct `shape`       | environment detection                                             |
| Backup target swap (local → GitHub → vault)        | target interface, format envelope compat                          |

Browser matrix in CI: **Chromium + Firefox + WebKit**, all running the same
templates/minimal build. The WebKit run especially matters because it's the
closest stand-in for the Linux Tauri WebKitGTK webview.

Playwright handles the SW-activation reload natively: spike a small
`installAndWaitForSW(page)` helper that registers, waits for `activated` state,
and reloads once. Fresh `BrowserContext` per test gives clean OPFS state
automatically.

CI cost: a full templates/minimal Playwright run is plausibly 30 seconds to 2
minutes per browser. Cheap.

### Layer 3 — Tauri E2E (deferred per CLAUDE.md)

Not wired in v1. Plan for `tauri-driver` + WebdriverIO later, scoped to
Tauri-specific paths only: native dialogs, `plugin-fs`, the auto-updater. The
shared TS bundle's behaviour is already covered by Layer 2; Tauri tests just
verify the Rust-side wrappers.

### What each layer doesn't cover

- **Layer 1** can't catch SW / Worker / OPFS bugs.
- **Layer 2** can't catch Tauri-native bugs.
- **Layer 3** (when wired) can't catch issues with the underlying TS code —
  that's Layer 1 + 2.

### Discipline

- Every new `BackupTarget` ships with both unit tests (Layer 1) and a Playwright
  scenario (Layer 2). Verify-after-upload is non-optional.
- Every new `risk_flags` value gets a Layer 2 scenario that surfaces it and
  confirms the UI renders something reasonable.
- The Phase 8 Tauri release runbook adds spot-checks for what Layer 3 would
  automate.

## Performance budget

Targets + **measured anchors from Phase 0 Spike #4** (2026-05-17, Chromium /
Linux / headless / `vite dev`, 5 MB synthetic DB with random text). Re-measure
on real network + production build before shipping.

| Metric                                               | Target        | Measured                                                       | Margin |
| ---------------------------------------------------- | ------------- | -------------------------------------------------------------- | ------ |
| Cold-start to interactive (first visit, 10 Mbps)     | < 5 s         | ~400 ms est. (WASM download dominant)                          | 12×    |
| Cold-start CPU portion (no network)                  | < 2 s         | **68 ms**                                                      | 30×    |
| Warm-start to interactive (cached)                   | < 500 ms      | **26 ms**                                                      | 19×    |
| Login flow (argon2 verify)                           | < 500 ms      | ~190 ms (KDF)                                                  | 2.5×   |
| Worker boot time                                     | < 200 ms      | **24–66 ms**                                                   | 3–8×   |
| Steady-state query (typical)                         | < 10 ms       | ~1–2 ms (round-trip)                                           | 5×     |
| First /api/\* round-trip (SW→Worker→router)          | low overhead  | **2 ms**                                                       | n/a    |
| Backup of 10 MB DB (export → encrypt → verify)       | < 2 s         | ~650 ms (extrapolated from 5 MB → 327 ms)                      | 3×     |
| Restore of 10 MB DB (decrypt → import → reload)      | < 3 s         | n/a (decrypt+gunzip portion ~50 ms; reload + reopen dominates) | TBD    |
| Compressed size ratio (binary-gzip, mixed data)      | 50–80% of raw | **73%**                                                        | inside |
| Compressed size ratio (binary-gzip, repetitive data) | 50–80% of raw | 99% (artificially high, identical rows)                        | inside |

### Bundle weight (post-gzip targets)

| Asset                                                 | Target   | Loaded                                                    |
| ----------------------------------------------------- | -------- | --------------------------------------------------------- |
| Main thread JS (React + antd + httpRequest + routing) | < 400 KB | always                                                    |
| SQLite-WASM                                           | < 600 KB | lazy, after login                                         |
| argon2 WASM                                           | < 200 KB | lazy, login flow only                                     |
| Drizzle + router + framework JS                       | < 100 KB | in Worker (Spike #2 measured ~97 KB raw / ~30 KB gzipped) |
| `packages/sw` (merged SW)                             | < 10 KB  | SW                                                        |

### Mitigation toolbox (apply if a target slips)

- **Code-split SQLite-WASM behind the login screen.** The login form renders
  before WASM downloads.
- **Lazy-load argon2** — only login flow needs it. Steady-state session checks
  are token comparisons.
- **Aggressive SW caching** with versioned filenames. Warm-start becomes
  near-instant.
- **Worker-side query batching** — don't postMessage per row for large reads.
  Use `Transferable` for blobs.
- **Streamed backup pipeline** — for DBs > ~100 MB, pipe `CompressionStream`
  directly into the upload body rather than buffering. AES-GCM also supports
  streaming if we use SubtleCrypto's CTR + HMAC mode (more work; defer until
  needed).
- **Customised SQLite-WASM build** — drop FTS, RTREE, ICU if unused. Save ~200
  KB.

## Risks

- **WebKitGTK feature gaps.** OPFS works on 2.42+; older distros may lag. Worst
  case: bundle a fallback async-VFS path.
- **GitHub Pages SW reload UX.** First load isn't isolated; SW takes effect on
  second. Need to make this invisible. Phase 0 spike is the early check. Polish
  the loading screen so the reload looks intentional.
- **Bundle size growth.** SQLite-WASM (~1 MB) + argon2 WASM (~300 KB)
  - Drizzle + router. Measure after Phase 3, enforce budgets above.
- **Browser data clear is a real failure mode.** Restore flow has to be
  bulletproof. Test deliberately on every release.
- **Encryption mistakes are permanent.** Pin specific WebCrypto primitives,
  fresh IV per encrypt, verify-after-upload always.
- **Package boundary leaks.** Easy to accidentally import hipo-specific things
  into a package. Catch with an ESLint rule from Phase 1, not from Phase 10.
- **Multi-tab with same OPFS.** Two tabs of the same app open at once contend
  for the OPFS sync access handle. SQLite-WASM holds an exclusive lock; the
  second tab would fail to open. **Addressed by Phase 13** (landed 2026-05-20) —
  every tab probes a `"hipo-db"` Web Lock before spawning its Worker; the second
  tab sees the lock held and renders `MultiTabBlock`, polling for release. No
  SharedWorker (rejected — full multi-tab not worth the LOC for the hipo use
  case).
- **Worker / SW lifecycle traps.** Workers can be terminated by the browser
  under memory pressure; service workers can update mid- session and leave the
  Worker orphaned. Make the SW → Worker connection resilient: re-spawn the
  Worker on demand, replay any pending requests. Test on a low-memory device.

---

## Alternatives considered + utilities worth knowing

Compact reference so we don't re-evaluate the same options later. One line each;
expand when their phase comes up.

### Substrate (database engine) — evaluated, kept SQLite-WASM

| Option                                  | Verdict                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sqlite.org/sqlite-wasm`               | **Chosen.** Official, OPFS-backed, MIT, real SQL.                                                                                           |
| `wa-sqlite`                             | Strong alternative; pick in Phase 0 spike if official has issues.                                                                           |
| `@libsql/client-wasm` (Turso)           | **Rejected 2026-05-17 per Spike 1b**: 1.76 MB WASM vs 399 KB vanilla SQLite-WASM. Cost not justified by a Turso path we don't plan to take. |
| `pglite` (Postgres-WASM)                | Same architecture as SQLite-WASM; larger bundle (~3 MB), richer types. Future substrate package candidate.                                  |
| DuckDB-WASM                             | OLAP-shaped, overkill for OLTP small apps.                                                                                                  |
| Dexie (IndexedDB wrapper)               | Right answer for document-shaped apps that want zero WASM. Doesn't fit hipo (no joins/aggregates). Future substrate package candidate.      |
| RxDB                                    | Document model + reactive paradigm + Premium-license uncertainty. Wrong fit.                                                                |
| PouchDB                                 | Mature CouchDB sync; document model; wrong fit for relational domains.                                                                      |
| LowDB / jsdb / NeDB / AxioDB / NebulaDB | JSON-file / unmaintained / immature / no real queries. Not framework-worthy.                                                                |
| Bun's SQLite                            | Server-side runtime only — wrong context for browser.                                                                                       |

### SQLite-WASM helpers — consider during Phase 1/2

- **`sqlocal`** — MIT wrapper that handles the Worker + OPFS +
  sync-access-handle dance for you. Could substantially shrink
  `packages/sqlite`'s boilerplate. Evaluate in Phase 0 alongside the raw adapter
  pick.

### Compression — fallback if `CompressionStream` ever isn't enough

- **`fflate`** — small, fast pure-JS gzip. ~10 KB. Drop-in fallback if a target
  browser somehow lacks `CompressionStream` (unlikely given our matrix).

### Crypto — primary path is WebCrypto + `hash-wasm`

- **`noble-ciphers` / `noble-curves`** — audited pure-JS crypto, MIT. Useful
  only if we ever need primitives WebCrypto doesn't expose (e.g.
  chacha20-poly1305 streaming). Not needed now.
- **`libsodium-wrappers`** — battle-tested, heavier (~200 KB). Same "not needed
  unless WebCrypto lacks something" framing.

### Auth — future UX upgrades to consider

- **Passkeys / WebAuthn** — removes the passphrase-memorisation burden for the
  _login_, but doesn't replace the encryption passphrase (passkeys can't be
  exported and re-used as a key on a fresh device). Useful as an additional
  factor or as the way to unwrap a device-local copy of the key. Real v2 design
  work.
- **OAuth providers (Google / GitHub / etc.) for vault auth** — much nicer UX
  than vault-account-username+password. The encryption passphrase stays separate
  so the vault operator still can't read backups.

### Deployment shapes — between web and Tauri

- **PWA "Install app"** — modern browsers can install an SPA as a standalone
  window with its own dock icon, separate from the browser tab. No installer, no
  Rust, no Tauri build. Works on Chromium + Edge + Safari + (limited) Firefox.
  Worth supporting as a third deployment shape: GitHub Pages demo → PWA install
  → Tauri install, in increasing levels of native integration. Lightweight add
  at the framework level.

### Backup targets — future siblings to `backup-{local,github,vault}`

- **`backup-drive`** — Google Drive API via OAuth. Easier UX than GitHub for
  non-developers.
- **`backup-dropbox`** — same shape, different provider.
- **`backup-webdav`** — Nextcloud / ownCloud / generic WebDAV.
  Self-hosted-friendly.
- **`backup-s3`** — S3 / R2 / B2 / MinIO via presigned URLs (small server piece
  for URL signing). Power-user storage.

The `BackupTarget` interface is stable; new providers are just new packages.

### Sync — upgrade paths when manual backup isn't enough

- ~~**Turso embedded replicas**~~ — explicitly out of scope per 2026-05-17
  decision. We picked vanilla SQLite-WASM (sqlocal) over libsql-wasm and don't
  plan to revisit.
- **ElectricSQL** — active SQLite sync layer with conflict resolution. Layers on
  top of SQLite-WASM. Strong candidate when sync becomes a real requirement.
- **cr-sqlite** — CRDT extension to SQLite; offline-first multi-writer. More
  invasive (changes schema design) but no central server needed.
- **Just deploy the router app as a real server** — the boring answer that keeps
  working. Same code, different runtime.

### Internationalisation — `react-i18next` is the pick

- **Lingui** — smaller runtime, macro-based. Maybe revisit if i18n becomes a
  bundle-weight concern.
- **Tolgee / Inlang** — newer; in-context editing is nice for non-technical
  translators. Possibly worth integrating if a consumer app needs heavy
  localisation.

### Things explicitly _not_ considered

- Server-rendered / hydration-heavy frameworks (Next / Nuxt / Remix): SPA-only
  is in non-goals.
- Multi-bundler support (Webpack / Rspack / esbuild): Vite-only is in non-goals.
- Native Tauri mobile builds (iOS/Android): explicit non-goal — mobile users hit
  the responsive PWA / web shape.
- Electron / Wails / Neutralino as alternatives to Tauri: Tauri is the chosen
  shell; not re-litigating.

## Glossary

- **OPFS** — Origin Private File System. Per-origin sandboxed filesystem;
  SQLite-WASM's persistent backing store.
- **COOP/COEP** — Cross-Origin Opener Policy + Cross-Origin Embedder Policy.
  HTTP headers that put the page in a cross-origin isolated context, required
  for SQLite-WASM's sync-access-handle OPFS mode.
- **`coi-serviceworker`** — small open-source service worker that injects
  COOP/COEP headers on responses, enabling cross-origin isolation on hosts that
  don't let you set headers (GitHub Pages). The framework's `packages/sw`
  reimplements this same technique alongside its `/api/*` routing, since a page
  can only register one SW per scope.
- **`do_*` operation** — convention from hipo: every backend mutation is a plain
  function `do_thing(ctx, args) → Promise<T>`. Route handlers are one-liners.
- **Ctx** — `{ db, user }`. Per-request context.
- **Consumer** — an app that uses the framework. hipo is the first.
  `templates/minimal/` is the second (and the contract validator).
- **CompressionStream / DecompressionStream** — native browser API for
  gzip/deflate compression. Streams, zero dependency.
- **Sync access handle** — OPFS API exposing synchronous file I/O, only
  available in dedicated Web Workers. SQLite-WASM's fast OPFS mode depends on
  it.
- **BackupFormat** — `binary` (raw SQLite file via `VACUUM INTO`) or `sql-dump`
  (text SQL statements like `mysqldump`/`pg_dump`). Pluggable; orthogonal to
  BackupTarget.

## Related memory

- `[[project-app-maker]]` — framework framing and audience
- `[[project-framework-architecture]]` — architectural shape detail
- `[[feedback-github-pages-mandatory]]` — Pages-must-work constraint
- `[[project-hipo-scope]]` — what hipo is today
- `[[project-hipo-build-gotchas]]` — current bundle sizes baseline
