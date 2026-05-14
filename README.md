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

**Localhost token (Tauri build only).** The shell generates a 256-bit
random token, passes it to the Deno child via `HIPO_AUTH_TOKEN`, and
embeds it in the webview URL as `#token=...`. The SPA's
`extractAuthToken()` reads and clears the hash on boot; `httpRequest`
adds `X-Hipo-Token` to every fetch. The backend's `requireLocalToken`
middleware enforces it when the env var is set — preventing other
processes on the machine from hitting the local API. Cloud / browser-dev
leaves the env var unset and the middleware is a no-op.

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

**Bundle sizes (reference):**

- Compiled Deno sidecar (libsql + V8 + std + JS): **~132 MB**.
- Final Windows installer: **~145 MB** (Tauri ~15 MB + sidecar + JS).
- Comparison: pure Tauri+Rust ~25 MB, Electron-equivalent ~250 MB.

The size delta vs. pure Rust buys backend code reuse with the cloud
build (same binary deploys hosted).

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

## Lost-password recovery (V1)

No in-app reset flow. If the sole admin forgets their password, recover
manually:

```bash
# Locate the data dir (default: OS app_data_dir for ar.com.adjimann.hipo).
# Linux:   ~/.local/share/ar.com.adjimann.hipo/hipo.db
# Windows: %APPDATA%\ar.com.adjimann.hipo\hipo.db

sqlite3 hipo.db \
  "UPDATE users SET password_hash = '<new-argon2id-encoded-hash>' WHERE username = 'admin'"
```

Generate the hash with any argon2id tool (or the wrappers in
`apps/backend/src/auth/passwords.ts`). Alternatively, delete `hipo.db`
to re-bootstrap from scratch (data loss). The cloud build will add a
real email-based reset flow.

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
- **Users ≠ parties.** Separate tables on purpose: parties include
  entities (banks, trusts) that don't authenticate, plus there are
  hundreds of them vs. 1–10 staff `users`. If lender-portal access ever
  lands, add a `users.party_id` FK then — bridge pattern, not
  inheritance. Forward-compatible.
- **Cross-domain guards** enforced in `do_*` operations + tests:
  - Can't change a loan's lenders if it has payments.
  - Can't delete a loan with payments — close it instead.

---

## Design decisions (considered & rejected)

Decisions taken during architecture exploration, recorded here so we
don't re-litigate them.

**Backend runtime / topology:**

- **Embedded Deno** (`deno_core` / `deno_runtime`) — single-process
  feels tighter but pulls slow Rust compiles, runtime drift, and
  frontend transport divergence. The sidecar's "problems" (port
  allocation, auth token) are ~30 LOC each.
- **Bun rewrite** — Bun statically links **LGPL 2.1**
  JavaScriptCore; commercial closed-source would require NOTICE +
  offer-to-relink paperwork. Deno (MIT + V8 BSD) is cleaner.
- **Pure Rust + axum** — preserves the old Rust backend but blocks the
  actual goal: sharing TS code with the frontend (`types`, validators,
  split, format).
- **Third-party Tauri plugins** (`tauri-plugin-deno`, `tauri-plugin-js`)
  — documented Windows production bugs, single-maintainer projects.
  Tauri's built-in `externalBin` instead.

**Frontend libraries:**

- **Zod** — parallel schema layer with no upside given the shared
  `check*` validators in `@hipo/shared` already cover both sides.
- **Jotai / Zustand / Redux** — source of truth is the backend; React
  only holds ephemeral UI state. `useState` / `useReducer` /
  `useContext` are enough.
- **TanStack Query** — deferred until 3+ views share data and manual
  invalidation gets painful. Migration is mechanical when needed.
- **Sass / CSS-in-JS** — plain CSS at this size.
- **Sentry / telemetry** — not at this scale.
- **Native file dialogs** (`@tauri-apps/plugin-dialog` / `plugin-fs`) —
  prefer browser APIs (`<input type="file">`, `Blob` downloads) so the
  frontend is identical across Tauri and cloud builds.

**Money / domain:**

- **Floats for money** — rejected. Integer cents in storage; BigInt for
  intermediate products in the split (cent × cent overflows
  `Number.MAX_SAFE_INTEGER` at realistic loan sizes). Largest-remainder
  allocation guarantees the total reconciles exactly.
- **Amortization tables / interest-rate math** — out of scope.
  `principal_cents` + flat `interest_cents` matches the use case.

---

## Cloud deployment caveats (when wired)

The same Deno binary runs as a hosted server, but several things flip
from "deferred" to "required" the moment it does:

- **Multi-tenancy: one SQLite file per org.** Filesystem-enforced
  isolation, so a missed `WHERE org_id = ?` can't leak data; per-customer
  backup/restore is `cp`. Not yet implemented (single-tenant currently);
  architecture supports it without breaking changes — subdomain → path.
- **Encryption at rest** becomes required (SQLCipher or platform disk
  encryption). Local desktop installs run plain SQLite by design — the
  user's filesystem is the trust boundary there.
- **AR regulatory flags** (per the `ar.com.adjimann.hipo` identifier):
  - **Ley 25.326 (PDPA)** — AAIP registration likely required for SaaS
    that stores third-party data.
  - **Right-of-access / right-of-deletion** endpoints needed;
    soft-delete may need to become hard-delete for compliance requests.
  - **SOC 2 / ISO 27001** for B2B sales eventually.

Not blocking now — factor into the timeline when cloud SaaS goes live.

---

## Prior art

If you're considering extracting `apps/desktop` into a generic
"wrap-a-web-app-as-a-desktop-app" tool, **CrabNebula's Taurify**
(`https://docs.crabnebula.dev/taurify/`) already covers substantially
the same ground: `npx taurify init/dev/build`, no Rust required,
first-class Deno backend config (`backend: { flavor: "deno", path,
entryPoint }`), auto-updates, multi-platform output (desktop + iOS +
Android).

The only meaningful differentiator identified for an OSS alternative is
licensing / lock-in: Taurify is paired with CrabNebula's commercial
Cloud (billing page + `cloud/ci/taurify-workflow` doc), and the CLI has
no visible OSS license — only `vscode-taurify` is on GitHub.

**Recommended path** (2026-05-14 finding): try Taurify on hipo first —
cheapest experiment. If it fits, the OSS-tool idea is moot. If it
doesn't, the gap list becomes the actual scope.

---

## Licensing

Commercial closed-source — all runtime deps are MIT/Apache. Tauri
(MIT/Apache), Deno (MIT + V8 BSD), Hono / Drizzle / Zod / decimal.js
(MIT/Apache), @node-rs/argon2 (MIT), libsql (MIT). No LGPL exposure.
