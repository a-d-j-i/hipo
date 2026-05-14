# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project goals

`hipo` is a **Tauri 2 desktop admin app** for tracking **mortgage loans with
multiple lenders**. Targets **Windows and Linux** (no macOS, no mobile). Hard
requirements:

- **Cross-compile Linux → Windows.** The dev host is Linux; Windows binaries
  must be produced on the same machine without a Windows VM.
- **SQLite** for local persistence.
- **Auto-updates** on both Linux and Windows builds.
- **Full audit trail** of every mutation (who, when, what changed).
- **i18n: Spanish (default) + English.**

Stack: Tauri 2 + React 19 + TypeScript + Vite + Ant Design 5.

## Domain

- **Parties** — records the app tracks. Not auth users. Can be people or
  entities (banks, trusts). Any party can play the lender or debtor role on
  any loan — there's no `kind` column.
- **Loans** — one debtor, multiple lenders. Each loan has a `currency_code`,
  `principal_cents`, and `interest_cents` (fixed flat interest, no
  amortization).
- **loan_lenders** — junction with `amount_lent_cents`. Lender's percentage
  derived live: `amount_lent / SUM(amount_lent on this loan)`.
- **debtor_payments** — payments from the debtor. Split among lenders by
  derived percentage using **largest-remainder cents allocation**
  (deterministic, reconciles exactly).
- **lender_payouts** — pool-wide, per-currency. Not tied to a specific loan.
  A lender's balance is computed per currency:
  `SUM(their share of payments in <ccy>) − SUM(their payouts in <ccy>)`.
- **audit_log** — every mutation writes a row inside the same transaction
  with `(at, user_id, action, entity_type, entity_id, payload_json)`.

**Money rules:** integer cents (`i64`) in SQLite. Never floats. Percentages
and splits in Rust with `rust_decimal`. Payment splitting uses largest-
remainder so totals reconcile exactly.

**Multi-currency:** loans, payments, payouts each carry a currency. No FX
conversion — currencies stay separate in reporting.

**Users vs parties:** deliberately separate tables. Login `users` are staff
running the app (1–10 people); `parties` are subjects being tracked
(hundreds — many of which never log in). If lender-portal access is ever
needed, add an optional `users.party_id` FK then. See
`memory/project-hipo-domain.md`.

## Commands

The repo is an npm-workspaces monorepo. Most commands run from the root.

- `npm run dev:frontend` — Vite dev server (port `1420`, `strictPort`).
- `npm run dev:backend` — Deno backend with `--watch`.
- `npm run dev:desktop` — Tauri shell (calls into Vite via `beforeDevCommand`).
- `npm run dev:mock` / `npm run dev:fast` — Vite + mockIPC (no backend needed).
- `npm run build:frontend` — `tsc --noEmit` + `vite build` → `apps/frontend/dist/`.
- `npm run build:backend:linux` / `:windows` — compile Deno sidecar to a single
  native binary in `apps/desktop/binaries/`.
- `npm run build:desktop:linux` / `:windows` — full Tauri build (chains
  frontend + backend + desktop). Windows uses `cargo-xwin` from a Linux host.
- `npm run check:frontend` — `tsc --noEmit` on the React app.
- `npm run check:backend` — `deno check` on the backend.
- `npm run test:frontend` / `test:backend` — unit tests per workspace.
- `npm run lint` — ESLint on the frontend.
- `npm run format` — Prettier across the whole repo.

Inside individual workspaces you can also use the native tools directly:
- `cd apps/backend && deno task {dev,test,check,compile:linux,…}`
- `cd apps/desktop && cargo check`, `cargo tauri dev`, `cargo tauri build`
- `cd apps/frontend && npm run dev` (or any other frontend script)

## Frontend stack — agreed deps

Minimal by design. Don't add deps without a concrete pain to solve.

- `antd` + `@ant-design/icons` — UI library (layout, table, form, drawer, date
  picker, notifications). MIT.
- `react-router` — sidebar nav between pages.
- `dayjs` — date handling (antd uses it anyway).
- `@tauri-apps/plugin-updater` — auto-update flow.
- `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` — backup/export
  (save-as + file copy).
- `@tauri-apps/plugin-log` — production logging.
- `react-i18next` — i18n. Chosen for maturity over Lingui.
- `decimal.js` — money math (JS floats are unsafe for currency).
- `@react-pdf/renderer` — PDF export for documents.

No `@tauri-apps/plugin-sql` — we use direct `rusqlite` in Rust and expose typed
commands. See "Backend (Rust) stack — agreed".

**Explicitly rejected / deferred**

- **Jotai / Zustand / Redux** — React `useState` + `invoke()` is sufficient.
  Source of truth is SQLite.
- **TanStack Query** — defer until 3+ views share data and manual invalidation
  gets painful.
- **Zod** — antd `rules` + Rust-side validation in commands covers it without a
  parallel schema layer.
- **Sass / CSS-in-JS** — plain CSS only.
- **Sentry / telemetry** — not needed for this scale.
- **react-hotkeys-hook** — plain `keydown` listeners until 5+ shortcuts.

## Backend (Rust) stack — agreed

- `rusqlite` (`bundled` feature) — direct SQLite with vendored libsqlite. We
  chose this over `tauri-plugin-sql` because every operation is a typed
  `#[tauri::command]`, so the plugin's JS query API gave us nothing.
- `argon2` — argon2id password hashing.
- `tauri-plugin-updater` — signed auto-updates.
- `tauri-plugin-single-instance` — only one app instance can hold the DB.
- `tauri-plugin-log` — file-based logging for prod.
- `ts-rs` — generate TS types from `#[derive(TS)]` structs to keep Rust ↔ TS in
  sync.

## Architectural conventions

**State.** The Rust backend (SQLite) is the source of truth. React holds only
ephemeral UI state (`useState`, `useReducer`, `useContext`). No client state
library.

**Data flow.** Components call `invoke<T>('cmd_name', args)`. After a mutation,
re-fetch the affected list — locally or via a `refresh()` callback passed
through props. No global cache yet.

**Forms.** Antd `<Form>` + `Form.useForm()`. For edit, open a `<Drawer>` and
`setFieldsValue(record)` (not `initialValues` — only reads on first render).
`onFinish` → `invoke` → toast → refresh → close.

**Validation, two layers.**

1. Antd `rules` on `<Form.Item>` for instant client-side feedback.
2. Rust commands return `Result<T, String>` — the real source of truth. Frontend
   catches and toasts.

**Errors.** Wrap `invoke` in `try/catch`; on failure call
`message.error(String(e))`. Consider a small `safeInvoke()` helper if the
pattern ends up everywhere.

**Migrations.** A `migrations` table tracks applied versions; the Rust side
holds an ordered array of `(version, sql)` pairs and applies any whose version
isn't yet recorded. Every schema change is a new entry with a monotonic version.
**Never edit a migration that has shipped.** Never edit user DBs by hand.

**Soft delete.** `users`, `parties`, `loans`, `debtor_payments`, and
`lender_payouts` carry a `deleted_at INTEGER` column (NULL = active). All
delete commands `UPDATE … SET deleted_at = ?` instead of `DELETE FROM …`.
Every read query filters `WHERE deleted_at IS NULL`. The `lender_balances`
aggregate filters soft-deleted payments and payouts. Soft-deleted records
stay in the DB so audit-log JOINs (e.g. user_name lookup, party debtor_name)
still resolve. `loan_lenders` and `debtor_payment_splits` are not
soft-deleted — they're junction-style and dependent on parent rows which
are. No "restore" command in V1 — recovery is by manual SQL
(`UPDATE … SET deleted_at = NULL WHERE id = ?`). The audit log
(`xxx.delete` action) records who soft-deleted what with the `before` state.

**Type sync.** Derive TS types from Rust via `ts-rs`. Avoids hand-maintained
drift.

**Auth.** Two roles: `admin` and `user`. Argon2id passwords. In-memory session
in Tauri-managed `Mutex<Option<CurrentUser>>` — no tokens. Domain data is
**shared** across all users (no `owner_id` columns). First-launch bootstrap
creates the first admin. Admin-only ops: user management, hard-delete of domain
records, app settings, data export/backup. Real enforcement lives in Rust
commands; frontend gates are UX only. No password recovery in V1 — backups are
the answer. No encryption at rest (deferred). See `memory/project-hipo-auth.md`
for full design.

**i18n.** `react-i18next` + `i18next` + `i18next-browser-languagedetector`.
Catalogs at `src/i18n/locales/{es,en}.json`. Default locale `es`; toggle in
Settings persists to `localStorage["hipo.locale"]`. All UI surfaces translate
via `useTranslation()` + `t()`. **Rust error strings are pass-through** — the
UI displays them as-is. Translating them would require an error-code refactor
on the backend (return codes like `username_already_exists` instead of prose,
then translate on the frontend). Deferred.

**Dev feature flags** (Vite env vars, read by `src/vite-env.d.ts`):

- `VITE_USE_MOCKS=1` — loads `src/mocks/ipc.ts` instead of talking to Rust.
- `VITE_AUTO_LOGIN=1` — on first launch, **auto-calls `setup_first_admin`**
  with `admin/admin123`; on subsequent launches, **auto-logs-in** with the
  same credentials. With this flag set, the user never sees the setup or
  login screens. For a real backend with custom creds, use
  `VITE_AUTO_LOGIN=username:password`. Failures log to the browser console
  (e.g. wrong password against an existing DB).
- `VITE_LOCALE=en|es` — forces i18next's initial language (bypasses the
  detector for this session; does **not** write to localStorage).

Compose freely (`VITE_USE_MOCKS=1 VITE_LOCALE=en yarn dev`), or use the
predefined `yarn dev:fast` shortcut.

**Testability pattern.** Every Rust command has a `do_*` plain-function twin
that takes `&AppState` and returns `Result<T, String>`. The `#[tauri::command]`
wrapper is a one-liner that calls the `do_*` function. Tests call the `do_*`
functions directly against an in-memory `Connection`. Add new commands this
way — never put real logic inside `#[tauri::command]`.

**Audit pattern.** Every mutating `do_*` function opens a transaction, performs
the mutation, and calls `audit::write_audit(&tx, user_id, action, entity_type,
entity_id, &payload_json)` inside that same transaction before committing.
Action strings are `entity.verb` (e.g. `party.create`, `loan.update`,
`payment.delete`). Payload is `{before, after}` JSON. Never write a mutation
without an audit row.

## Testing

Three layers, all using Tauri's officially-recommended tools:

- **Rust unit tests** (`#[cfg(test)] mod tests` in `auth.rs`) cover pure
  helpers (`hash_password`/`verify_password`/`validate_*`) and the `do_*`
  functions against `Connection::open_in_memory()`. Fast.
- **Rust integration tests** (`src-tauri/tests/auth_flow.rs`) use
  `tauri::test::mock_builder` + `get_ipc_response` to drive commands
  through the real IPC plumbing with a `MockRuntime` app. Requires the
  `test` feature on tauri (declared in `[dev-dependencies]`).
- **TS unit tests** (`*.test.tsx` next to source) use Vitest +
  Testing Library + `mockIPC` from `@tauri-apps/api/mocks`. `clearMocks()`
  runs after each test via `src/test/setup.ts`.

E2E with `tauri-driver` + WebdriverIO is **not** wired up — defer until
there's a flow worth automating.

**Mock backend dev mode** (`yarn dev:mock`): `src/main.tsx` conditionally
imports `src/mocks/ipc.ts` when `VITE_USE_MOCKS=1`, which registers
`mockIPC` with canned seed data (admin/`admin123`, alice/`alice123`).
Runs the React app in any browser; no Rust, no Tauri shell. Useful for
fast UI iteration.

## Cross-compilation (Linux → Windows)

Not yet wired up. Planned path:

- `rustup target add x86_64-pc-windows-msvc`.
- Install [`cargo-xwin`](https://github.com/rust-cross/cargo-xwin) for the MSVC
  toolchain without a Windows host.
- Build with
  `yarn tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc`.

The `-gnu` target via `mingw-w64` is the fallback if MSVC linking proves
painful, but `cargo-xwin` is the smoother default.

## Roadmap

Foundation-first ordering:

1. ✅ App shell: sidebar + content layout, router stubs.
2. ✅ SQLite via direct `rusqlite` with `migrations` table + array.
3. ✅ `ts-rs` for entity types (`src/bindings/`).
4. ✅ Auth foundation + `tauri-plugin-single-instance`.
5. ✅ User management (admin only).
6. ✅ Testing infrastructure (`tauri::test`, Vitest + `mockIPC`,
   `yarn dev:mock`).
7. **Phase 1 — Parties CRUD + audit_log infrastructure.** Foundation for
   everything domain-related; audit retrofitted onto existing auth/user
   commands.
8. **Phase 2 — Loans CRUD with lender shares editor** (live percentage
   display).
9. **Phase 3 — Debtor payments** with automatic largest-remainder split
   per lender.
10. **Phase 4 — Lender payouts** (pool, per-currency) + lender balance
    summary view.
11. **Phase 5 — Audit log viewer** (admin only).
12. **Phase 6 — i18n** via `react-i18next` (es default + en). Done last to
    avoid translating churn.
13. Backup / export DB (`plugin-dialog` + `plugin-fs`, admin-only).
14. `tauri-plugin-log`.
15. Auto-updates: keypair, signed bundles, hosted manifest.
16. Linux→Windows cross-compile pipeline (`cargo-xwin`).
17. Dark mode via antd `ConfigProvider` + `theme.darkAlgorithm`.
18. PDF export via `@react-pdf/renderer` (e.g., loan statements).

## Architectural directions under evaluation (as of 2026-05-13)

The Tauri-only direction above is being reconsidered. The product target is
now **three deployment shapes from one codebase**:

1. **Tauri desktop** — current shape; single-user-per-process.
2. **Local server / Windows service** — same binary as cloud, accessed via
   browser on `localhost`. Cookie sessions.
3. **Cloud multi-tenant SaaS** — same binary, deployed to Fly.io or similar.
   **One SQLite file per org** (filesystem-enforced tenant isolation), routed
   by subdomain or session. Target scale: ~100 orgs × ~100 users.

Goal: users start on local install and migrate to cloud without UI changes.
Backend speaks **HTTP even when running locally** — frontend always uses
`fetch()`. Tauri (if kept) becomes a thin shell that boots the local server
and opens the webview to `localhost:<port>`.

**Leading architecture: Tauri shell + Deno sidecar.**

- **Tauri** stays as a thin native shell (Rust, ~150–300 LOC, written once):
  spawns the backend, manages its lifecycle, opens the window at
  `http://127.0.0.1:<port>`, wires the auto-updater, enforces single-
  instance, bundles the installer. **No business logic in Rust.**
- **Deno + Hono + Drizzle** is the actual backend (TypeScript). Runs as a
  Tauri sidecar locally via `externalBin`; the **same binary** deploys to
  Fly.io / Hetzner for the cloud SaaS build.
- **React frontend** always speaks `fetch()`, never `invoke()`. Identical
  code in Tauri and cloud builds.
- For native-only features (e.g. backup/export), prefer browser APIs
  (`<input type="file">`, `Blob` downloads) over `invoke` so the frontend
  stays identical across deployment targets.

**Localhost-auth token (Tauri build only):** Tauri generates a random token
at startup, passes to the Deno child via env var, and injects it into the
frontend HTML. Deno middleware requires `X-Hipo-Token` on every request
(prevents other processes on the machine from hitting the local API). In
cloud build this is replaced by HTTPS + cookie sessions.

**Backend runtime portability:** write Deno code against **Web Standard
APIs + Hono + Drizzle**, not the `Deno.*` namespace, so the same backend
runs on Deno/Bun/Node/Workers without changes.

**Mobile support: responsive cloud build only.** No Capacitor, no Tauri
mobile, no React Native. Mobile users hit the cloud URL in a phone browser.
Backend doesn't change. Frontend must be responsive from day one: collapse
`<Sider>` to a hamburger drawer at `< md`, render `<Table>` as `<List>`
cards on narrow screens, `layout="vertical"` forms, `inputMode="decimal"`
for currency, `size="large"` buttons on mobile, test on a real phone.
Optional PWA upgrade later via `vite-plugin-pwa` for "Add to Home Screen."
Skip offline mode / push / App Store — not a fit for an admin app.

**Considered and rejected: embedding Deno inside Tauri's Rust process**
(via `deno_core` / `deno_runtime`). Single-process would feel tighter, but
clean Rust builds balloon to 10–15 min (V8 in the dep tree), local-vs-cloud
runtimes diverge (Deno-the-Rust-library vs Deno-the-binary), the frontend
transport splits (`invoke` for Tauri vs `fetch` for cloud), and debugging
loses Deno's native tools. Sidecar's "problems" (port allocation, localhost
auth token) are ~30 LOC each and standard. Would reconsider only if the app
grew lots of native-API calls from TS, which it currently doesn't.

**Bundle size:** ~110 MB Windows installer (Tauri ~15 MB + bundled Deno
binary ~85 MB + JS). Larger than pure Tauri+Rust (~25 MB), smaller than
Electron-equivalent (~250 MB).

**Licensing — fully clean.** Tauri (MIT/Apache), Deno (MIT + V8 BSD),
Hono/Drizzle/Zod/decimal.js (MIT/Apache). No LGPL exposure.

**Migration implication:** `auth.rs`, `db.rs`, `audit.rs`, and the loan/
party/payment commands in Rust get rewritten in TS. Tauri shell code shrinks
to launcher + updater + window. The `do_*` twin pattern still applies — just
in TypeScript now.

No commitment yet — pending a concrete side-by-side `do_create_loan`
example to confirm the TS shape feels right.

**Foundation refactor that helps regardless of stack:**

- `do_*` functions take explicit `user_id` parameter (not read from
  `AppState`). Tauri wrapper reads the in-memory session and passes it;
  HTTP wrapper reads from cookie-session middleware and passes it. Same
  business logic, two thin wrappers.

**What's net-new for cloud mode** (any stack): signup flow, email service
(Resend/Postmark/SES) for verification + password reset, DB-backed sessions,
rate limiting on auth endpoints, TLS (Caddy or platform-managed), Litestream
per-org backups, org management (invite/remove/role).

**Update distribution (Tauri build):** self-hosted via **GitHub Releases**
for signed binaries + **GitHub Pages** for the `latest.json` manifest,
wired up by `tauri-action`. Free, HTTPS, signature verification baked in.
Lacks CrabNebula's staged rollouts and download analytics — graduate to
those only if needed. Non-Tauri server builds use sysadmin-style updates
(`systemctl restart` / MSI upgrade rules) rather than rolling a custom
in-process updater. This is an argument for keeping Tauri in the mix even
alongside axum/HTTP mode.

**Regulated-industry flags** (Argentina mortgage data, SaaS context): Ley
25.326 registration with AAIP likely required; encryption at rest flips from
"deferred" to "required"; right-of-access / right-of-deletion endpoints
needed (soft-delete may need to become hard-delete for compliance requests).

See `memory/project-hipo-deployment-directions.md` for the full analysis.

## Architecture

Two-process Tauri app:

- **Frontend** (`src/`, `index.html`, `vite.config.ts`) — React 19 + Vite,
  served at `http://localhost:1420` in dev and from `../dist` in production
  (`tauri.conf.json` → `frontendDist`). `vite.config.ts` reads `TAURI_DEV_HOST`
  for LAN HMR and ignores `src-tauri/**`.
- **Backend** (`src-tauri/`) — Rust crate. `src/main.rs` is a thin entry that
  calls `hipo_lib::run()` from `src/lib.rs`, where `tauri::Builder` registers
  plugins and exposes commands via `invoke_handler!`. The library is named
  `hipo_lib` (`_lib` suffix is a Windows-cargo workaround documented in
  `Cargo.toml`).

Frontend ↔ backend bridge: React calls `invoke("name", args)` from
`@tauri-apps/api/core`; Rust exposes commands with `#[tauri::command]` and lists
them in `tauri::generate_handler![...]`. Auth + user-management commands live
in `src-tauri/src/auth.rs`; DB connection setup and migrations live in
`src-tauri/src/db.rs`. Tauri-managed `AppState { conn, current }` is created
in the `setup` callback of `lib.rs` after opening
`{app_data_dir}/hipo.db`. Window/plugin permissions are gated by
`src-tauri/capabilities/default.json` (currently `core:default` +
`opener:default`); new plugins typically need a permission added here.

`src/bindings/*.ts` is generated by ts-rs — do not edit by hand. Regenerate
with `cd src-tauri && cargo test`.

App identifier `ar.com.adjimann.hipo`; product name `hipo`; default window
800x600 (`tauri.conf.json`).

## Tooling

- **ESLint** flat config (`eslint.config.js`): `@eslint/js` +
  `typescript-eslint` + `react-hooks` + `react-refresh`;
  `eslint-config-prettier` disables formatting rules.
- **Prettier** (`.prettierrc.json`): 2-space, double-quote, trailing-comma-all,
  80 cols; `*.md` uses `proseWrap: "always"`.
- **TypeScript** (`tsconfig.json`): bundler resolution, `jsx: react-jsx`,
  `noEmit: true` (Vite emits, `tsc` only typechecks).

**Source layout (frontend):**

- `src/App.tsx` — root: `ConfigProvider` + `BrowserRouter` + `AuthProvider` +
  routes.
- `src/auth/` — `AuthContext.tsx` (provider + guards
  `RequireSetup`/`RequireLogin`/`RequireAuth`/`RequireAdmin`) and `api.ts`
  (typed invoke wrappers). Tests in `*.test.tsx` siblings.
- `src/bindings/` — ts-rs generated types (do not edit).
- `src/layouts/AppLayout.tsx` — sidebar + header + content.
- `src/mocks/ipc.ts` — `mockIPC` handlers used by `yarn dev:mock`.
- `src/pages/` — `Setup`, `Login`, `Dashboard`, `Parties`, `Users`,
  `Settings` (more pages land as phases ship: `Loans`, `Payments`,
  `Payouts`, `AuditLog`).
- `src/test/setup.ts` — Vitest setup (cleanup, `clearMocks`).
- `src/i18n/` — `index.ts` (i18next init), `locales/{es,en}.json` catalogs.
