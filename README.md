# hipo

Desktop admin app for tracking **mortgage loans with multiple lenders**.
Tauri 2 shell + Deno backend (sidecar) + React/TypeScript frontend, all from
one codebase. Targets **Windows** and **Linux**. SQLite-only persistence,
full audit trail, Spanish-default UI with English toggle.

> The same Deno backend binary can also be deployed as a regular HTTP server
> for a hosted (browser-only) flavor of the app. The Tauri shell is just a
> launcher around it.

---

## Architecture in one diagram

```
                ┌──────────────────────────────┐
                │  Tauri shell (Rust, ~110 LOC)│
                │  • generates auth token       │
                │  • spawns sidecar             │
                │  • opens window at backend URL│
                │  • auto-updater               │
                └──────────────┬───────────────┘
                               │ spawns
                               ▼
                ┌──────────────────────────────┐
                │  Deno backend (sidecar)       │
                │  • Hono + Drizzle + libsql    │
                │  • cookie sessions            │
                │  • full domain API + audit log│
                │  • serves the React SPA       │
                └──────────────▲───────────────┘
                               │ fetch (cookie + X-Hipo-Token)
                               │
                ┌──────────────┴───────────────┐
                │  React frontend               │
                │  • antd 5, responsive         │
                │  • no `invoke()` — fetch only │
                │  • i18n (es default + en)     │
                └──────────────────────────────┘
```

Same React + Deno code runs unchanged in three deployment shapes:

1. **Tauri desktop** — sidecar spawned by Rust, auth token in URL hash.
2. **Local-service** — Deno binary running standalone, accessed via browser.
3. **Cloud SaaS** — same Deno binary on Fly.io / Hetzner / etc.

---

## Prerequisites

- **Node 20+** and **Yarn 1.x** (`yarn install` works with `package-lock.json` ignored)
- **Rust stable** with `cargo` on PATH
- **Deno 2.x** — `curl -fsSL https://deno.com/install.sh | sh`
- **Linux build deps** (if dev'ing on Linux):
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### For cross-compiling Linux → Windows (optional, dev-only)

```bash
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
```

(First `cargo-xwin` run downloads Microsoft Windows SDK headers/libs ~600 MB.
CI uses a native `windows-latest` runner instead — see `.github/workflows/release.yml`.)

---

## Dev workflow

Two long-running processes, hot-reload on both sides:

```bash
# Terminal 1 — the Deno backend (with --watch)
cd backend
deno task dev
# → HIPO_READY hostname=127.0.0.1 port=8787

# Terminal 2 — the Tauri shell (which runs Vite dev under the hood)
yarn tauri dev
# Window opens at http://localhost:1420; Vite proxies /api/* → :8787
```

Browser-only dev (skips Tauri entirely):

```bash
# Terminal 1: same as above
# Terminal 2:
yarn dev
# Open http://localhost:1420 in any browser
```

In dev, the backend's `HIPO_AUTH_TOKEN` env var is unset, so `requireLocalToken`
is a no-op — fetch calls work without the `X-Hipo-Token` header.

### Useful commands

| Command | What it does |
|---|---|
| `yarn tauri dev` | Tauri webview pointing at Vite dev (sidecar **not** spawned in dev) |
| `yarn dev` | Vite only — open in browser; proxies `/api/*` to the Deno backend |
| `yarn dev:mock` | Vite + mock IPC for fast UI iteration (no real backend needed) |
| `cd backend && deno task dev` | Deno backend with `--watch` |
| `cd backend && deno task test` | 57 unit + integration tests |
| `cd backend && deno task check` | Type-check the backend |
| `yarn test` | Frontend unit tests |
| `yarn tsc --noEmit` | Type-check the frontend |

---

## Building for release

The build chains the Deno sidecar (compiled to a single native binary) with
the Tauri wrapper.

```bash
yarn tauri:build:linux      # Linux x86_64
yarn tauri:build:windows    # Linux host → Windows x86_64 via cargo-xwin
```

Output paths:
- `src-tauri/binaries/hipo-backend-<target>(.exe)` — the Deno sidecar
- `src-tauri/target/<target>/release/bundle/{deb,nsis,msi,...}/` — the installers

CI alternative: push a `v*` tag to trigger `.github/workflows/release.yml`,
which builds for Linux + Windows in parallel using native runners and uploads
signed installers + `latest.json` to a draft GitHub Release.

---

## Auto-updater setup

The Tauri shell ships with `tauri-plugin-updater` wired up. On launch (release
builds only) the frontend calls `check()`; if a newer signed bundle is
available the user gets an antd modal offering to install and relaunch.

### One-time setup before your first release

1. **Generate a signing keypair:**
   ```bash
   yarn tauri signer generate -w ~/.tauri/hipo.key
   ```
   - **Public key** → paste into `src-tauri/tauri.conf.json` at
     `plugins.updater.pubkey` (replace the `PLACEHOLDER_…` value).
   - **Private key** + password → store as repo secrets
     `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - **Keep the private key safe** — losing it means existing installations
     can no longer accept updates and need a fresh install.

2. **Replace the placeholder URL** in `src-tauri/tauri.conf.json` at
   `plugins.updater.endpoints` with your GitHub org/repo:
   ```
   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
   ```

3. **Verify cross-compile** (only if you'll build Windows locally — otherwise
   CI handles it):
   ```bash
   yarn tauri:build:windows
   ```

### Cutting a release

```bash
git tag v0.2.0
git push --tags
# → triggers .github/workflows/release.yml
# → matrix build (Linux + Windows) with signed bundles
# → draft GitHub Release created with installers + latest.json attached
```

Flip the draft to published when you're happy with the build. Existing
installations will pick it up on next launch via the `latest.json` endpoint.

---

## Project layout

```
hipo/
├── src/                    React frontend (TypeScript + antd 5)
│   ├── api/                http.ts (fetch helper), updater.ts
│   ├── auth/               AuthContext + login/setup flows
│   ├── audit/ loans/ parties/ payments/ payouts/  ← per-domain api.ts
│   ├── bindings/           types (kept for compat with existing pages)
│   ├── hooks/useIsMobile.ts
│   ├── layouts/AppLayout.tsx     responsive sidebar + hamburger
│   ├── pages/              one .tsx per route
│   ├── i18n/locales/{es,en}.json
│   └── main.tsx
│
├── backend/                Deno + Hono + Drizzle backend
│   ├── deno.json
│   └── src/
│       ├── server.ts                 entry: Hono app
│       ├── config.ts static.ts
│       ├── db/                       client + schema + migrations
│       ├── auth/ parties/ loans/
│       │   payments/ payouts/ audit/ per-domain operations + tests
│       ├── routes/                   thin Hono handlers calling do_*
│       ├── middleware/session.ts
│       └── errors.ts error_handler.ts
│
├── src-tauri/              Tauri shell (Rust, launcher only)
│   ├── src/lib.rs          spawns sidecar, opens window
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── binaries/hipo-backend-<target>  ← built by deno compile
│
└── .github/workflows/release.yml      tag → signed installers
```

---

## Conventions & rules

- **Money in integer cents** — `i64`/`number` everywhere in storage; `decimal.js`
  on the frontend for arithmetic.
- **Payment splits** use largest-remainder cents allocation — every payment
  reconciles exactly to the lender shares. See `backend/src/payments/split.ts`.
- **Soft delete** on `users`, `parties`, `loans`, `debtor_payments`,
  `lender_payouts`. Reads filter `WHERE deleted_at IS NULL`. Junction tables
  (`loan_lenders`, `debtor_payment_splits`) aren't soft-deleted.
- **Every mutation writes an audit row** inside the same transaction.
  `action` is `entity.verb` (`party.create`, `loan.update`, etc.). Payload is
  `{before, after}` JSON.
- **Migrations are append-only** — never edit a migration that has shipped.
  Add a new one with the next version number.
- **No `Deno.*` namespace in business logic** — only Web Standard APIs + Hono
  + Drizzle. Keeps the backend runnable on Node/Bun/Workers if needed.
- **i18n: Spanish default + English.** Rust shell error strings remain
  English (sidecar-internal only; never user-visible).

---

## Licensing

Commercial closed-source — all runtime deps are MIT/Apache. Tauri (MIT/Apache),
Deno (MIT + V8 BSD), Hono / Drizzle / Zod / decimal.js (MIT/Apache),
@node-rs/argon2 (MIT), libsql (MIT). No LGPL exposure.
