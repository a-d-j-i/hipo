# hipo

Desktop + browser app for tracking **mortgage loans with multiple lenders**.
Built on top of a small **local-first TypeScript framework** that lives in
`packages/` — hipo is the framework's first consumer.

Three deployment shapes from one codebase:

- **GitHub Pages (in-page)** — primary demo target. React + sqlocal +
  OPFS-backed SQLite + service-worker-routed `/api/*` to a dedicated Web Worker.
  No backend process. Works in Chromium, Firefox.
- **Tauri desktop (Windows only)** — same in-page bundle, wrapped in a ~135-LOC
  Rust shell with auto-updater and signed releases. Linux Tauri was sunset in
  Phase 8A — webkit2gtk 2.50 is missing `FileSystemSyncAccessHandle`, which
  sqlocal's OPFS pool VFS needs. Linux users go to the Pages build (Chromium /
  Firefox have it).
- **Local Deno backend (Shape 2)** — same router and `do_*` ops, but served over
  real HTTP by `apps/backend`. Path forward when "one DB per device" needs to
  become "one DB shared by a team."

Full audit trail of every mutation; Spanish-default UI with English toggle;
integer-cents money math everywhere.

---

## Repo layout

```
hipo/
├── apps/
│   ├── frontend/     React + Vite + antd (the SPA)
│   ├── backend/      Deno HTTP server — hipo routes + vault-server
│   └── desktop/      Tauri shell (Windows)
├── packages/         The local-first framework
│   ├── sqlite/         data layer: libsql (Deno) + sqlocal (browser)
│   ├── server/         hand-rolled router (~50 LOC), Ctx, AppError
│   ├── auth/           users + sessions + Argon2id (PHC-encoded both sides)
│   ├── audit/          audit_log table + writeAudit() helper
│   ├── backup/         AES-GCM + Argon2id + gzip primitives + target interface
│   ├── backup-local/   <a download>, FS Access API, Tauri plugin-fs
│   ├── backup-github/  GitHub Contents API target
│   ├── backup-vault/   client for @hipo/backup-vault-server
│   ├── backup-vault-server/  PAT-authed blob storage HTTP routes
│   ├── tauri-shell/    generic Tauri Rust shell (consumed by apps/desktop)
│   └── shared/         hipo-specific shared types + validators + split algorithm
├── docs/
│   └── local-first-framework.md   the load-bearing strategic plan
└── spikes/             Phase-0 derisk spikes + Playwright smoke harnesses
```

Workspaces are npm + Deno simultaneously: npm-workspaces resolve `@hipo/*` via
symlinks for the frontend, and `apps/backend/deno.json`'s `imports` map resolves
them for Deno. Source-only TypeScript — no build step for any framework package
while it lives in this monorepo (publishing to npm is Phase 10, deferred).

The plan document `docs/local-first-framework.md` is the load-bearing spec —
read it before making package-boundary changes.

---

## Architecture

### Shape 1: in-page (Pages + Tauri share this bundle)

```
Main thread (UI)           Service Worker            Dedicated Worker
─────────────────          ─────────────────         ──────────────────
React + httpRequest()  ──► intercept /api/*  ──►   router.fetch(req)
                           inject COOP/COEP        Drizzle
                                                   SQLite-WASM + OPFS
       ◄──── Response ──────────  ◄──── postMessage(response)
```

`httpRequest` calls `fetch("/api/...")`. The SW intercepts and proxies to the
Worker via MessageChannel. SQLite-WASM lives in the Worker because
`FileSystemSyncAccessHandle` (OPFS fast mode) only exists in dedicated Workers —
that's a browser spec constraint, not a choice.

The same SW also injects `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers so the page becomes cross-origin-isolated
— required for SQLite-WASM. This is what makes GitHub Pages work without any
header configuration on the host.

### Shape 2: Deno HTTP server

```
┌──────────────────────────────┐
│  apps/backend (Deno)          │   Hono → hand-rolled router
│  • libsql via @libsql/client  │   cookie sessions or X-Hipo-Token
│  • hipo domain routes         │
│  • @hipo/backup-vault-server  │   PAT-authed vault endpoints
│  • serves the React SPA       │
└──────────────▲───────────────┘
               │ fetch (cookie + X-Hipo-Token)
┌──────────────┴───────────────┐
│  apps/frontend (React SPA)    │
└──────────────────────────────┘
```

Same router and `do_*(ctx, args)` operations as Shape 1 — only the substrate
differs. The Vite dev server proxies `/api/*` to whatever port the Deno backend
is on (`HIPO_BACKEND_PORT`, default 8787). Same auth, same migrations, same
backup pipeline — promotion is configuration, not rewrite.

### Tauri shell (Windows)

The Tauri Rust shell is now ~135 LOC after Phase 8A's trim — it just opens a
webview against the bundled in-page SPA. No sidecar to spawn, no `externalBin`,
no auth-token bootstrap. Auto-updater + signing pipeline intact (see "Releases"
below). Bundle size for Windows: low tens of MB (was ~117 MB `.deb` / ~387 MB
sidecar before).

---

## Prerequisites

- **Node 20+** with **npm 10+** (workspaces support)
- **Deno 2.x** — `curl -fsSL https://deno.com/install.sh | sh`
- **Rust stable** with `cargo` on PATH (only if you'll build the Tauri shell)
- **Windows build deps** (only if cross-compiling Linux → Windows):
  ```bash
  cargo install cargo-xwin --locked
  rustup target add x86_64-pc-windows-msvc
  ```
  First `cargo-xwin` run downloads the Microsoft Windows SDK (~600 MB).

---

## First-time setup

```bash
npm install        # installs JS deps via npm workspaces
                   # (apps/backend deps come from Deno on first `deno task` run)
```

---

## Dev workflows

There are three modes; pick by what you're building.

### Mode A: Pages-style in-page dev (no Deno process)

```bash
npm run dev:frontend -- --port 1420
# Open http://localhost:1420 in Chromium or Firefox
```

The SPA runs entirely in-browser. SQLite lives in OPFS; first launch shows a
Bootstrap page (start fresh / restore from backup). The service worker registers
on first load and triggers a one-time reload to activate cross-origin isolation
— subsequent boots are direct.

> **Set `VITE_INPAGE_BACKEND=1`** for this mode if you want it through
> `apps/frontend`'s native `npm run dev` (the dev:frontend script doesn't set it
> by default — Mode B does, see below).

### Mode B: Local Deno backend + Vite SPA (Shape 2 dev)

Two terminals, hot-reload on both sides:

```bash
# Terminal 1
npm run dev:backend
# → HIPO_READY hostname=127.0.0.1 port=8787

# Terminal 2
npm run dev:frontend
# Vite proxies /api/* to :8787
```

This is the "hipo as a regular web app with a backend" path. Setup flow on first
launch: `/api/auth/setup` creates the admin; subsequent boots go through the
login form.

### Mode C: Tauri shell (Windows-only target; works on Linux for dev iteration)

```bash
# Tauri shell + Vite under the hood (in-page bundle)
npm run dev:desktop
```

No separate backend terminal — the in-page Worker IS the backend. Window opens
at the bundled Vite page. On Linux dev, the `packages/tauri-shell` Rust crate
flips a webkit2gtk feature flag through C-FFI to enable the partial OPFS surface
— fine for iteration, not enough for actual shipping (the sync access handle is
missing, which sqlocal needs).

### Mock-based fast iteration

```bash
npm run dev:mock        # browser-only with in-memory mock backend
npm run dev:fast        # mock backend + auto-login + Spanish locale
```

Seed users: `admin/admin123` (admin), `alice/alice123` (user). Mocks live in
`apps/frontend/src/mocks/ipc.ts` and stub `window.fetch` for `/api/*` URLs.

### Useful commands (from repo root)

| Command                                    | What it does                                                    |
| ------------------------------------------ | --------------------------------------------------------------- |
| `npm run dev:frontend`                     | Vite only (Shape 2 expects a backend at `:8787`)                |
| `npm run dev:backend`                      | Deno backend with `--watch`                                     |
| `npm run dev:desktop`                      | Tauri shell + in-page Vite build                                |
| `npm run dev:mock`                         | Vite + in-memory mock backend                                   |
| `npm run dev:fast`                         | Mock backend + auto-login + es locale                           |
| `npm run build:frontend`                   | Vite build (Shape 2 SPA, expects a backend)                     |
| `npm run build:frontend:inpage`            | Vite build with `VITE_INPAGE_BACKEND=1`                         |
| `npm run build:desktop:windows`            | Full Tauri installer for Windows (Linux→Windows via cargo-xwin) |
| `npm run check:frontend` / `check:backend` | Type-check each                                                 |
| `npm run test:frontend` / `test:backend`   | Unit tests (Vitest / Deno)                                      |
| `npm run lint`                             | ESLint over the frontend                                        |
| `npm run format`                           | Prettier across the repo                                        |

Inside individual workspaces use the native tools directly:
`cd apps/backend && deno task test`, `cd apps/desktop && cargo check`,
`cd apps/frontend && npm run test:watch`, etc.

---

## Backup system (Phase 4–7, 9)

Every install has an end-to-end encrypted backup story. Pipeline:

```
exportDb()        VACUUM INTO → Uint8Array (consistent snapshot)
   ↓
compress()        CompressionStream("gzip")
   ↓
encryptBlob()     AES-256-GCM(key derived via Argon2id from passphrase)
   ↓
upload()          to a chosen BackupTarget
   ↓
verify()          re-fetch + decrypt + byte-equal compare (when target supports get)
```

Targets that ship today, all behind the same `BackupTarget` interface:

- `@hipo/backup-local/download` — `<a download>`-based one-shot backup.
  Universal fallback.
- `@hipo/backup-local/fs-access` — File System Access API for a persistent
  folder (Chromium).
- `@hipo/backup-local/tauri` — `@tauri-apps/plugin-fs` injection (caller
  supplies the surface).
- `@hipo/backup-github` — single rolling `backup.bin` in a repo via Contents
  API + fine-grained PAT.
- `@hipo/backup-vault` + `@hipo/backup-vault-server` — Phase 9, PAT-authed blob
  storage running on your own Deno backend.

The passphrase never leaves the device. PATs are encrypted with a
passphrase-derived AES-GCM key (`secrets-vault.ts`) and stored in localStorage.
Lose the passphrase and PAT/blob recovery is gone — same as losing a GPG private
key.

A `CadenceRunner` mounted at the app root checks every 5 min after a 30 s
warm-up and runs a backup against the first cadence-eligible target when the
last backup was >24 h ago. Preference order: fs-access > github > vault.
`local-download` is deliberately excluded from cadence (would pop save dialogs
randomly).

`/api/system/status` returns a structured "where is my data, how safe is it,
what can lose it" picture that drives a banner in the dashboard and a panel in
Settings.

See `docs/local-first-framework.md` Phase 4–7 for the full design.

---

## Releases (Tauri)

`apps/desktop` ships with `tauri-plugin-updater`. On launch (release builds
only) the frontend calls `check()`; if a newer signed bundle is available the
user gets an antd modal offering to install and relaunch.

### One-time setup before your first release

1. **Generate a signing keypair:**

   ```bash
   npm run signer:generate -w @hipo/desktop
   ```

   - Public key → `apps/desktop/tauri.conf.json` at `plugins.updater.pubkey`
     (replace the `PLACEHOLDER_…` value).
   - Private key + password → repo secrets `TAURI_SIGNING_PRIVATE_KEY` and
     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - Keep the private key safe — losing it means existing installs can't accept
     updates.

2. **Replace the placeholder URL** in `apps/desktop/tauri.conf.json` at
   `plugins.updater.endpoints` with your repo:

   ```
   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
   ```

3. **Verify local cross-compile** (only if you'll cut releases manually):
   ```bash
   npm run build:desktop:windows
   ```

### Cutting a release

```bash
git tag v0.2.0
git push --tags
# → .github/workflows/release.yml builds + signs + drafts a release
```

The workflow currently matrix-builds Linux + Windows. **Linux is not a supported
target** (Phase 8A decision); the workflow's Linux job remains for dev iteration
and can be trimmed when we're sure webkit2gtk 2.52 won't fix the OPFS gap — see
Phase 8B in the plan.

---

## Lost-password / lost-data recovery

The recovery story depends on which shape you're in.

### In-page (Pages, Tauri, browser-only dev)

SQLite lives in OPFS, which the browser owns. You cannot edit it with `sqlite3`
from a terminal — the path is sandboxed and per-origin.

- **Lost password** → Restore from an encrypted backup made earlier (Settings →
  "Restore from a backup file"), or wipe OPFS and start fresh (DevTools →
  Application → Storage → Clear site data).
- **Lost passphrase, no backup** → unrecoverable. The first-install flow
  strongly encourages an initial backup before any data is entered.

### Deno backend (Shape 2)

```bash
# Default data dir: ./data (override with HIPO_DATA_DIR)
sqlite3 ./data/hipo.db \
  "UPDATE users SET password_hash = '<new-argon2id-encoded-hash>' WHERE username = 'admin'"
```

Generate the hash with any argon2id tool, or via
`packages/auth/src/passwords.ts`.

### Tauri (Windows) — Mechanism B fallback

Tauri's webview stores OPFS under a known per-app directory on disk. Copying
that directory between two installs of the same Tauri app on the same OS gives
you "portable install" semantics. Paths:

| OS               | Path                                   |
| ---------------- | -------------------------------------- |
| Windows          | `%LOCALAPPDATA%\ar.com.adjimann.hipo\` |
| Linux (dev only) | `~/.local/share/ar.com.adjimann.hipo/` |

Same OS + same webview only. Cross-version copy is undefined — use a
framework-managed encrypted backup (Mechanism A) instead.

---

## Conventions & rules

- **Money in integer cents** — `i64`/`number` everywhere in storage;
  `decimal.js` on the frontend for arithmetic; `BigInt` in the backend
  payment-split algorithm (cent × cent overflows `Number.MAX_SAFE_INTEGER`).
- **Payment splits** use largest-remainder cents allocation — reconciles
  exactly. See `packages/shared/src/split.ts`.
- **Soft delete** on `users`, `parties`, `loans`, `debtor_payments`,
  `lender_payouts`. Reads filter `WHERE deleted_at IS NULL`. Junction tables
  aren't soft-deleted.
- **Every mutation writes an audit row** inside the same transaction. Action
  format is `entity.verb` (`party.create`, `vault.blob.put`, etc.); payload is
  `{before, after}` JSON.
- **Migrations are append-only** — never edit a migration that has shipped. Hipo
  domain claims versions 1–2; vault tables claim versions 100+; new framework
  packages get their own version range.
- **Every backend command is `do_*(ctx, args)`** — plain function, no HTTP
  dependency, callable directly from tests. Route handlers are one-liners.
- **No `Deno.*` namespace in business logic** — only Web Standard APIs
  - Drizzle. Same code runs in Deno and in the in-page Worker.
- **No hipo-specific code in `packages/*`** — framework principle 1.
- **i18n: Spanish default + English.** Backend error strings stay English; UI
  catalogs translate `risk_flags` and other facts.

---

## Design decisions (considered & rejected)

Decisions taken during architecture exploration, recorded here so we don't
re-litigate them.

**Substrate:**

- `@libsql/client-wasm` (Turso) — rejected per Spike #1b: 1.76 MB WASM vs 399 KB
  vanilla SQLite-WASM (4.4× the bundle for a Turso path we don't plan to take).
- DuckDB / pglite / RxDB / Dexie / PouchDB — wrong fit for relational domains,
  document model mismatch, or licensing uncertainty. See
  `docs/local-first-framework.md` "Alternatives considered."

**Backend topology:**

- **Embedded Deno** (`deno_core` / `deno_runtime`) — slow Rust compiles +
  runtime drift. We did this for a while, then Phase 8A removed the embedded
  sidecar entirely in favour of the in-page topology.
- **Bun rewrite** — Bun statically links **LGPL 2.1** JavaScriptCore; commercial
  closed-source would require NOTICE + offer-to-relink paperwork. Deno (MIT + V8
  BSD) is cleaner.
- **Hono** — replaced by a 53-LOC hand-rolled router per Spike #2. Hono is fine
  but redundant once `Request`/`Response` are the isomorphic contract.

**Frontend libraries:**

- **Zod** — parallel schema layer with no upside given the shared `check*`
  validators in `@hipo/shared` already cover both sides.
- **Jotai / Zustand / Redux** — source of truth is the backend; React only holds
  ephemeral UI state.
- **TanStack Query** — deferred until 3+ views share data.
- **Sass / CSS-in-JS / Sentry** — not at this scale.
- **Native file dialogs** — prefer browser APIs so the frontend stays identical
  across Tauri and Pages builds.

**Money / domain:**

- **Floats for money** — rejected. Integer cents in storage; BigInt for
  intermediate products; largest-remainder for splits.
- **Amortization tables** — out of scope; flat `principal_cents` +
  `interest_cents` matches the use case.

---

## Cloud deployment caveats (when wired)

The same Deno binary that runs `apps/backend` locally also runs as a hosted
server, but several things flip from "deferred" to "required" the moment it
does:

- **Multi-tenancy** — one SQLite file per org, filesystem-isolated. Subdomain or
  path routes to the right DB. Architecture supports it without breaking
  changes; do\_\* ops stay single-`Ctx.db`.
- **Encryption at rest** — SQLCipher or platform disk encryption. Local desktop
  installs run plain SQLite by design (the user's filesystem is the trust
  boundary there).
- **`packages/server-deploy`** — Phase 9 strict-mode extraction (deferred). Will
  hold the generic `Deno.serve` bootstrap + Dockerfile + fly.toml template +
  Litestream config so a hosted deployment is configuration, not rewrite.
- **AR regulatory flags** (`ar.com.adjimann.hipo`): Ley 25.326 (PDPA) AAIP
  registration likely required; right-of-access / right-of- deletion endpoints;
  SOC 2 / ISO 27001 for B2B sales eventually.

Not blocking now — factor into the timeline when SaaS goes live.

---

## Licensing

Commercial closed-source. All runtime deps are MIT/Apache. Tauri (MIT/Apache),
Deno (MIT + V8 BSD), Drizzle / decimal.js / antd (MIT), `@node-rs/argon2` (MIT),
libsql (MIT), `sqlocal` (MIT), `@sqlite.org/sqlite-wasm` (Public Domain / MIT),
`hash-wasm` (MIT). No LGPL exposure. See `memory/feedback-licensing.md`.
