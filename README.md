# hipo

Desktop admin app for tracking **mortgage loans with multiple lenders**.
Tauri 2 shell + Deno backend (sidecar) + React/TypeScript frontend, all in
one monorepo. Targets **Windows** and **Linux**. SQLite-only persistence,
full audit trail, Spanish-default UI with English toggle.

> The same Deno backend binary can also be deployed as a regular HTTP server
> for a hosted (browser-only) flavor of the app. The Tauri shell is just a
> launcher around it.

---

## Repo layout

```
hipo/
├── apps/
│   ├── frontend/   React + Vite + antd (browser bundle)
│   ├── backend/    Deno + Hono + Drizzle + libsql (HTTP server)
│   └── desktop/    Tauri shell — spawns backend, opens webview
└── packages/
    └── shared/     (stub) source-only TS shared by frontend + backend
```

Workspaces are managed by **npm workspaces** (no yarn, no turbo).
Each app keeps its native config: `package.json` + `vite.config.ts` in
frontend, `deno.json` in backend, `Cargo.toml` + `tauri.conf.json` in
desktop. The thin `package.json` files in `apps/{backend,desktop}` only
exist so npm workspaces can resolve them by name.

---

## Architecture

```
                ┌──────────────────────────────┐
                │  apps/desktop (Tauri shell)   │
                │  • generates auth token       │
                │  • spawns sidecar             │
                │  • opens window at backend URL│
                │  • auto-updater               │
                └──────────────┬───────────────┘
                               │ spawns
                               ▼
                ┌──────────────────────────────┐
                │  apps/backend (Deno sidecar)  │
                │  • Hono + Drizzle + libsql    │
                │  • cookie sessions            │
                │  • full domain API + audit log│
                │  • serves the React SPA       │
                └──────────────▲───────────────┘
                               │ fetch (cookie + X-Hipo-Token)
                               │
                ┌──────────────┴───────────────┐
                │  apps/frontend (React)        │
                │  • antd 5, responsive         │
                │  • no `invoke()` — fetch only │
                │  • i18n (es default + en)     │
                └──────────────────────────────┘
```

---

## Prerequisites

- **Node 20+** with **npm 10+** (workspaces support)
- **Rust stable** with `cargo` on PATH
- **Deno 2.x** — `curl -fsSL https://deno.com/install.sh | sh`
- **Linux build deps** (only if dev'ing on Linux):
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### For cross-compiling Linux → Windows (optional, dev-only)

```bash
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
```

CI uses a native `windows-latest` runner instead — see `.github/workflows/release.yml`.

---

## First-time setup

```bash
npm install        # installs frontend + desktop JS deps via npm workspaces
                   # (apps/backend deps are managed by Deno separately)
```

Deno auto-installs its own deps to `node_modules/` on first `deno task` run.

---

## Dev workflow

Two long-running processes, hot-reload on both sides:

```bash
# Terminal 1 — the Deno backend (with --watch)
npm run dev:backend
# → HIPO_READY hostname=127.0.0.1 port=8787

# Terminal 2 — the Tauri shell (which runs Vite under the hood)
npm run dev:desktop
# Window opens at http://localhost:1420; Vite proxies /api/* → :8787
```

Browser-only dev (skips Tauri entirely):

```bash
# Terminal 1: same as above
# Terminal 2:
npm run dev:frontend
# Open http://localhost:1420 in any browser
```

In dev, the backend's `HIPO_AUTH_TOKEN` env var is unset, so `requireLocalToken`
is a no-op — fetch calls work without the `X-Hipo-Token` header.

### Useful commands (from repo root)

| Command | What it does |
|---|---|
| `npm run dev:desktop` | Tauri webview pointing at Vite dev (sidecar **not** spawned in dev) |
| `npm run dev:frontend` | Vite only — open in browser; proxies `/api/*` to the Deno backend |
| `npm run dev:mock` | Vite + mock IPC for fast UI iteration (no real backend needed) |
| `npm run dev:backend` | Deno backend with `--watch` |
| `npm run check:frontend` / `check:backend` | Type-check each |
| `npm run test:frontend` / `test:backend` | Run unit tests |
| `npm run lint` | ESLint over the frontend |

You can also `cd` into any workspace and use its native tools directly:
`cd apps/backend && deno task test`, `cd apps/desktop && cargo check`, etc.

---

## Building for release

The build chains the Deno sidecar (compiled to a single native binary) with
the Tauri wrapper:

```bash
npm run build:desktop:linux      # Linux x86_64
npm run build:desktop:windows    # Linux host → Windows x86_64 via cargo-xwin
```

Output paths:
- `apps/desktop/binaries/hipo-backend-<target>(.exe)` — the Deno sidecar
- `apps/desktop/target/<target>/release/bundle/{deb,nsis,msi,...}/` — the installers

CI alternative: push a `v*` tag to trigger `.github/workflows/release.yml`,
which builds for Linux + Windows in parallel using native runners and uploads
signed installers + `latest.json` to a draft GitHub Release.

---

## Auto-updater setup

`apps/desktop` ships with `tauri-plugin-updater` wired up. On launch (release
builds only) the frontend calls `check()`; if a newer signed bundle is
available the user gets an antd modal offering to install and relaunch. A
manual "Check for updates" button lives in the Settings page.

### One-time setup before your first release

1. **Generate a signing keypair:**
   ```bash
   npm run signer:generate -w @hipo/desktop
   # or equivalently: cd apps/desktop && tauri signer generate
   ```
   - **Public key** → paste into `apps/desktop/tauri.conf.json` at
     `plugins.updater.pubkey` (replace the `PLACEHOLDER_…` value).
   - **Private key** + password → store as repo secrets
     `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - **Keep the private key safe** — losing it means existing installations
     can no longer accept updates and need a fresh install.

2. **Replace the placeholder URL** in `apps/desktop/tauri.conf.json` at
   `plugins.updater.endpoints` with your GitHub org/repo:
   ```
   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
   ```

3. **Verify cross-compile** (only if you'll build Windows locally —
   otherwise CI handles it):
   ```bash
   npm run build:desktop:windows
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

## Conventions & rules

- **Money in integer cents** — `i64`/`number` everywhere in storage;
  `decimal.js` on the frontend for arithmetic.
- **Payment splits** use largest-remainder cents allocation — every payment
  reconciles exactly to the lender shares. See
  `apps/backend/src/payments/split.ts`.
- **Soft delete** on `users`, `parties`, `loans`, `debtor_payments`,
  `lender_payouts`. Reads filter `WHERE deleted_at IS NULL`. Junction tables
  (`loan_lenders`, `debtor_payment_splits`) aren't soft-deleted.
- **Every mutation writes an audit row** inside the same transaction.
  `action` is `entity.verb` (`party.create`, `loan.update`, etc.). Payload
  is `{before, after}` JSON.
- **Migrations are append-only** — never edit a migration that has shipped.
  Add a new one with the next version number.
- **No `Deno.*` namespace in business logic** — only Web Standard APIs +
  Hono + Drizzle. Keeps the backend runnable on Node/Bun/Workers if needed.
- **i18n: Spanish default + English.** Rust shell error strings remain
  English (sidecar-internal only; never user-visible).

---

## Licensing

Commercial closed-source — all runtime deps are MIT/Apache. Tauri
(MIT/Apache), Deno (MIT + V8 BSD), Hono / Drizzle / Zod / decimal.js
(MIT/Apache), @node-rs/argon2 (MIT), libsql (MIT). No LGPL exposure.
