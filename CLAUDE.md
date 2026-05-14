# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project goals

`hipo` is a desktop admin app for tracking **mortgage loans with multiple
lenders**, packaged as a Tauri shell over a Deno+Hono backend. Targets
**Windows and Linux** (no macOS, no native mobile — mobile users hit the
cloud build via responsive web). Hard requirements:

- **Cross-compile Linux → Windows** without a Windows VM. Wired via
  `cargo-xwin` for the Tauri shell and `deno compile --target` for the
  sidecar.
- **SQLite** for local persistence (via `@libsql/client` + Drizzle).
- **Auto-updates** on Linux + Windows (Tauri updater + signed GitHub
  Releases).
- **Full audit trail** of every mutation (who, when, what changed).
- **i18n: Spanish (default) + English.**

Stack: Tauri 2 (Rust shell, ~110 LOC) + Deno + Hono + Drizzle + libsql
+ React 19 + TypeScript + Vite + Ant Design 5. **All MIT/Apache deps**
(commercial closed-source constraint — no LGPL exposure).

The same Deno binary that ships as a Tauri sidecar can also run as a
standalone HTTP server. Three deployment shapes from one codebase:
**Tauri desktop**, **local-service**, **hosted SaaS** (when wired).

## Repo layout (npm-workspaces monorepo)

```
hipo/
├── apps/
│   ├── frontend/     React + Vite + antd (browser bundle)
│   ├── backend/      Deno + Hono + Drizzle + libsql (HTTP server)
│   └── desktop/      Tauri shell — spawns backend, opens webview
├── packages/
│   └── shared/       Source-only TypeScript shared by frontend + backend
├── package.json      Workspace root (npm workspaces)
└── deno.json         Deno workspace root (declares apps/backend)
```

Each workspace keeps its native config: `package.json` + `vite.config.ts`
in frontend, `deno.json` in backend, `Cargo.toml` + `tauri.conf.json` in
desktop. The thin `package.json` files in `apps/{backend,desktop}` only
exist so npm workspaces can resolve them by name.

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
  (deterministic, reconciles exactly). Algorithm in
  `packages/shared/src/split.ts` (BigInt math — cent×cent products can
  exceed `Number.MAX_SAFE_INTEGER`).
- **lender_payouts** — pool-wide, per-currency. Not tied to a specific loan.
  A lender's balance is computed per currency:
  `SUM(their share of payments in <ccy>) − SUM(their payouts in <ccy>)`.
- **audit_log** — every mutation writes a row inside the same transaction
  with `(at, user_id, action, entity_type, entity_id, payload_json)`.

**Money rules:** integer cents (`number`/`bigint`) in SQLite. Never floats.
Frontend uses `decimal.js` for currency math, backend uses `BigInt` for
overflow-safe intermediate products. Payment splitting uses largest-
remainder so totals reconcile exactly.

**Multi-currency:** loans, payments, payouts each carry a currency. No FX
conversion — currencies stay separate in reporting.

**Users vs parties:** deliberately separate tables. Login `users` are staff
running the app (1–10 people); `parties` are subjects being tracked
(hundreds — many of which never log in). If lender-portal access is ever
needed, add an optional `users.party_id` FK then. See
`memory/project-hipo-domain.md`.

## Commands

Most commands run from the repo root.

- `npm run dev:frontend` — Vite dev server (port `1420`, `strictPort`).
- `npm run dev:backend` — Deno backend with `--watch` (default port 8787).
- `npm run dev:desktop` — Tauri shell (calls into Vite via
  `beforeDevCommand`). User runs `dev:backend` separately.
- `npm run dev:mock` / `npm run dev:fast` — Vite + in-browser mock backend.
  `apps/frontend/src/mocks/ipc.ts` stubs `window.fetch` for `/api/*` URLs;
  the React app runs end-to-end with seed data (`admin`/`admin123`,
  `alice`/`alice123`). No Deno needed.
- `npm run build:frontend` — `tsc --noEmit` + `vite build` → `apps/frontend/dist/`.
- `npm run build:backend:linux` / `:windows` — compile Deno sidecar to a
  single native binary in `apps/desktop/binaries/`.
- `npm run build:desktop:linux` / `:windows` — full Tauri build (chains
  frontend + backend + desktop). Windows uses `cargo-xwin` from Linux.
- `npm run check:frontend` / `check:backend` — type-check each workspace.
- `npm run test:frontend` / `test:backend` — unit tests per workspace.
- `npm run lint` — ESLint on the frontend.
- `npm run format` — Prettier across the repo.

Inside individual workspaces use the native tools directly:
- `cd apps/backend && deno task {dev,test,check,compile:linux,…}`
- `cd apps/desktop && cargo check`, `cargo tauri dev`, `cargo tauri build`
- `cd apps/frontend && npm run dev` (or any other frontend script)

## Frontend stack — agreed deps

Minimal by design. Don't add deps without a concrete pain to solve.

- `antd` + `@ant-design/icons` — UI library. MIT.
- `react-router` — sidebar nav between pages.
- `dayjs` — date handling (antd uses it anyway).
- `react-i18next` — i18n. Chosen for maturity over Lingui.
- `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` — auto-update
  flow (dynamically imported; only loads inside the Tauri shell).
- `@tauri-apps/api` — Tauri runtime helpers (used by `mocks/ipc.ts`).

**Explicitly rejected / deferred**

- **Jotai / Zustand / Redux** — React `useState` + `fetch()` is sufficient.
  Source of truth is the backend.
- **TanStack Query** — defer until 3+ views share data and manual
  invalidation gets painful.
- **Zod** — antd `rules` (using shared `check*` validators) + backend-side
  validation in `do_*` functions covers it without a parallel schema layer.
- **Sass / CSS-in-JS** — plain CSS only.
- **Sentry / telemetry** — not needed for this scale.
- **react-hotkeys-hook** — plain `keydown` listeners until 5+ shortcuts.
- **Native file dialogs** (`@tauri-apps/plugin-dialog` / `plugin-fs`) —
  prefer browser APIs (`<input type="file">`, `Blob` downloads) so the
  frontend stays identical between Tauri and cloud builds.

## Backend stack — agreed deps

- **Deno 2.x** runtime. All npm packages via `npm:` specifiers.
- **`hono`** — HTTP framework (lightweight, runs on Deno/Bun/Node/Workers).
- **`drizzle-orm`** (`drizzle-orm/libsql` adapter) — typed query builder.
- **`@libsql/client/node`** — local SQLite via libsql (bundled native
  bindings). Same code can swap to Turso for hosted backends later.
- **`@node-rs/argon2`** — argon2id password hashing (native, fast).
- **`tower-sessions`-style cookie sessions** — DB-backed (rows in
  `sessions` table), HttpOnly + Secure + SameSite=Strict.

## Shared package (`packages/shared`)

Single source of truth for things both sides need. **Source-only TS** —
no build step; both Vite and Deno read the `.ts` files directly. Imports
use explicit `.ts` extensions so Deno's strict resolver is happy.

- `src/types.ts` — 14 canonical API + input types (`User`, `Party`, `Loan`,
  `CreateLoanInput`, `PartyInput`, …). Backend `apps/backend/src/<domain>/types.ts`
  files re-export these under `Public*` aliases that operation files use.
- `src/validators.ts` — `check*` functions returning `string | null` plus
  constants (`USERNAME_MAX_LENGTH`, `PASSWORD_MIN_LENGTH`, etc.). Backend
  wraps each in a thin `validate*` that throws `badRequest(msg)`. Frontend
  uses them via `rule(checkX)` (see `apps/frontend/src/lib/antdRules.ts`).
- `src/split.ts` — largest-remainder payment split (BigInt-safe).
- `src/format.ts` — currency formatters + `centsToMajor`/`majorToCents`.

Resolution mechanisms differ but the import specifier is the same:
- Frontend (Vite + npm workspaces): symlink at `node_modules/@hipo/shared`.
- Backend (Deno): import map entry in `apps/backend/deno.json`
  (`"@hipo/shared": "../../packages/shared/src/index.ts"`).

## Architectural conventions

**State.** The Deno backend (SQLite per scope) is the source of truth.
React holds only ephemeral UI state (`useState`, `useReducer`,
`useContext`). No client state library.

**Data flow.** Components call functions in their domain's `api.ts`
(`listLoans`, `createParty`, …). Each `api.ts` calls `httpRequest()` from
`apps/frontend/src/api/http.ts`, which `fetch()`es the backend at
`/api/...` (proxied to the Deno port in dev; same-origin in prod via the
sidecar). After a mutation, the page re-fetches the affected list — locally
or via a `refresh()` callback passed through props. No global cache yet.

**Auth-token bootstrap (Tauri build only).** The Tauri shell generates a
256-bit random token, passes it to the Deno child via `HIPO_AUTH_TOKEN`
env var, and embeds it in the webview URL as `#token=...`. `main.tsx`'s
`extractAuthToken()` reads + clears the hash; `httpRequest` adds
`X-Hipo-Token: <token>` to every fetch when the token is set. In cloud /
browser dev the env var is unset and the middleware is a no-op.

**Forms.** Antd `<Form>` + `Form.useForm()`. For edit, open a `<Drawer>` and
`setFieldsValue(record)` (not `initialValues` — only reads on first render).
`onFinish` → call `api.X(...)` → toast → refresh → close.

**Validation, two layers.**

1. Antd `rules` on `<Form.Item>` for instant client-side feedback. Use
   `rule(checkX)` from `apps/frontend/src/lib/antdRules.ts` alongside
   `{ required: true, message: t("...") }` so the empty case stays
   localized and the structural case comes from shared.
2. Backend `do_*` functions throw `AppError` via `badRequest(msg)`. The
   error handler converts to JSON `{error}`; `httpRequest` unwraps it into
   a thrown `Error` whose message the page surfaces with
   `message.error(String(e))`.

**Errors.** Wrap `httpRequest`/`api.X` calls in `try/catch`; on failure
call `message.error(String(e))`.

**Migrations.** A `migrations` table tracks applied versions; the Deno
side holds an ordered `(version, sql)` array in
`apps/backend/src/db/migrations.ts` and applies any whose version isn't yet
recorded. Every schema change is a new entry with a monotonic version.
**Never edit a migration that has shipped.** Multi-statement SQL is split
on `;` and run one statement at a time (`splitStatements` in
`apps/backend/src/db/client.ts`).

**Soft delete.** `users`, `parties`, `loans`, `debtor_payments`, and
`lender_payouts` carry a `deleted_at INTEGER` column (NULL = active). All
delete commands `UPDATE … SET deleted_at = ?` instead of `DELETE FROM …`.
Every read query filters `WHERE deleted_at IS NULL`. The
`lender_balances` aggregate filters soft-deleted payments and payouts.
Soft-deleted records stay in the DB so audit-log JOINs (e.g. user_name
lookup, party debtor_name) still resolve. `loan_lenders` and
`debtor_payment_splits` are not soft-deleted — they're junction-style
and dependent on parent rows which are. No "restore" command — recovery
is by manual SQL. The audit log (`xxx.delete` action) records who
soft-deleted what with the `before` state.

**Type sync.** All API + input shapes live in `packages/shared/src/types.ts`.
Backend `apps/backend/src/<domain>/types.ts` files re-export them under
`Public*` aliases (which operations code uses); frontend imports them
directly from `@hipo/shared`. No codegen, no ts-rs.

**Auth.** Two roles: `admin` and `user`. Argon2id passwords via
`@node-rs/argon2`. **DB-backed cookie sessions** — random 256-bit hex id
in a `sessions` row joined to `users`. Cookies: `HttpOnly; Secure;
SameSite=Strict; Path=/; Max-Age=30d`. Domain data is **shared** across all
users (no `owner_id` columns). First-launch bootstrap creates the first
admin. Admin-only ops: user management, hard-delete of domain records,
audit log. Real enforcement lives in `requireAuth` / `requireAdmin`
middleware + per-operation guards; frontend gates are UX only. No password
recovery in V1 — backups are the answer. No encryption at rest (deferred).
See `memory/project-hipo-auth.md` for full design.

**i18n.** `react-i18next` + `i18next` + `i18next-browser-languagedetector`.
Catalogs at `apps/frontend/src/i18n/locales/{es,en}.json`. Default locale
`es`; toggle in Settings persists to `localStorage["hipo.locale"]`. All UI
surfaces translate via `useTranslation()` + `t()`. **Backend error strings
are pass-through English** — the UI displays them as-is. Translating them
would require an error-code refactor on the backend. Deferred.

**Dev feature flags** (Vite env vars, read by
`apps/frontend/src/vite-env.d.ts`):

- `VITE_USE_MOCKS=1` — loads `src/mocks/ipc.ts`, which stubs
  `window.fetch` so the app runs without a real backend. Seed users:
  `admin`/`admin123` (admin), `alice`/`alice123` (user). All domain
  state is in-memory; reloading the page resets it.
- `VITE_AUTO_LOGIN=1` — auto-calls `setup_first_admin` / `login` with
  `admin/admin123` on bootstrap; with these flags set, the user never sees
  the setup or login screens. Use `VITE_AUTO_LOGIN=user:pass` for custom
  creds. Failures log to the browser console.
- `VITE_LOCALE=en|es` — forces i18next's initial language (bypasses the
  detector for this session; does **not** write to localStorage).
- `VITE_BACKEND_URL` — absolute URL for `httpRequest` (e.g. when the Tauri
  webview needs to hit a backend that isn't behind Vite's proxy). Defaults
  to empty (same-origin).

**Testability pattern.** Every backend command has a `do_*` plain-function
form that takes `(ctx: Ctx, args)` and returns a `Promise<T>`. The Hono
route handler is a one-liner that calls `do_*` and returns its result as
JSON. Tests call the `do_*` functions directly against an in-memory libsql
database. Add new commands this way — never put real logic inside the
route handler.

**Audit pattern.** Every mutating `do_*` function opens a transaction
(`db.transaction(async (tx) => { … })`), performs the mutation, and calls
`writeAudit(tx, user_id, action, entity_type, entity_id, payload)` inside
that same transaction before committing. Action strings are `entity.verb`
(e.g. `party.create`, `loan.update`, `payment.delete`). Payload is
`{before, after}` JSON. Never write a mutation without an audit row.

## Testing

Two layers:

- **Deno tests** (`apps/backend/src/**/*_test.ts`) cover `do_*` operations
  against an in-memory libsql database (via `Deno.makeTempFile` —
  `:memory:` doesn't survive `db.transaction()` in libsql's node binding).
  57 tests across auth/parties/loans/payments/payouts/audit, plus the
  shared `splitPayment` algorithm tests in
  `apps/backend/src/payments/split_test.ts`.
- **Vitest** (`apps/frontend/src/**/*.test.tsx`) covers React with
  Testing Library + `vi.stubGlobal("fetch", ...)`. `setup.ts` extends
  `expect` with `@testing-library/jest-dom/matchers` explicitly (the
  auto-extend `/vitest` entry doesn't reach the right vitest instance
  under our npm-workspaces + Deno-managed `.deno/` layout).

E2E with `tauri-driver` + WebdriverIO is **not** wired up — defer until
there's a flow worth automating.

## Auto-updater

`apps/desktop` ships with `tauri-plugin-updater` (release builds only —
`#[cfg(not(debug_assertions))]`-gated). On launch, the frontend's
`checkForUpdates()` calls `check()`; if a newer signed bundle is available
the user gets an antd modal offering to install and relaunch. Settings →
"Check for updates" runs the same flow manually.

Signing pipeline:
- `npm run signer:generate -w @hipo/desktop` produces the keypair.
- Public key → `apps/desktop/tauri.conf.json` at `plugins.updater.pubkey`.
- Private key + password → CI secrets `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Endpoint URL points at
  `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`
  (placeholder in `tauri.conf.json` — replace with the real org/repo).

Release pipeline: `.github/workflows/release.yml` triggers on `v*` tags,
matrix-builds on `ubuntu-22.04` + `windows-latest`, signs via
`tauri-action`, uploads draft GitHub Release with installers +
`latest.json`. Native Windows runner used in CI; `cargo-xwin` only matters
for local Linux→Windows builds.

## Cross-compilation (Linux → Windows)

Wired. One-time local setup:
```
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
```
Then `npm run build:desktop:windows` chains
`deno task compile:windows` → `tauri build --runner cargo-xwin --target …`.
First `cargo-xwin` run downloads the Microsoft Windows SDK (~600 MB).
CI uses a native Windows runner instead.

## Architecture

```
┌──────────────────────────────┐
│  apps/desktop (Tauri shell)   │  generates auth token, spawns sidecar,
│                               │  opens webview, runs the auto-updater
└──────────────┬───────────────┘
               │ spawns
               ▼
┌──────────────────────────────┐
│  apps/backend (Deno sidecar)  │  Hono + Drizzle + libsql + cookie sessions
│                               │  + audit log + serves the React SPA
└──────────────▲───────────────┘
               │ fetch (cookie + X-Hipo-Token)
               │
┌──────────────┴───────────────┐
│  apps/frontend (React)        │  antd 5, responsive, no invoke()
└──────────────────────────────┘
```

Dev mode: the Tauri shell does **not** spawn the sidecar (it relies on
`npm run dev:backend` running separately, and Vite proxies `/api/*` to it).
Prod mode: the shell spawns the bundled `hipo-backend-<target>` from
`apps/desktop/binaries/`, parses `HIPO_READY hostname=… port=N` from
stdout, then builds the webview at `http://127.0.0.1:N/#token=<token>`.

Window/plugin permissions are gated by
`apps/desktop/capabilities/default.json` (currently `core:default` +
`updater:default` + a scoped `shell:allow-execute` for the sidecar).

App identifier `ar.com.adjimann.hipo`; product name `hipo`; default window
800×600 (`apps/desktop/tauri.conf.json`).

## Tooling

- **ESLint** flat config (`apps/frontend/eslint.config.js`): `@eslint/js`
  + `typescript-eslint` + `react-hooks` + `react-refresh`;
  `eslint-config-prettier` disables formatting rules.
- **Prettier** (`.prettierrc.json` at repo root): 2-space, double-quote,
  trailing-comma-all, 80 cols; `*.md` uses `proseWrap: "always"`.
- **TypeScript** (`apps/frontend/tsconfig.json`): bundler resolution,
  `jsx: react-jsx`, `noEmit: true`, `allowImportingTsExtensions: true`.

**Frontend source layout (`apps/frontend/src/`):**

- `App.tsx` — root: `ConfigProvider` + `BrowserRouter` + `AuthProvider` +
  routes.
- `api/http.ts` — `httpRequest(method, path, body?)` wrapper around
  `fetch` (cookie credentials, X-Hipo-Token header, JSON, error mapping).
- `api/updater.ts` — Tauri-only update-check helper.
- `auth/` — `AuthContext.tsx` (provider + guards
  `RequireSetup`/`RequireLogin`/`RequireAuth`/`RequireAdmin`) and `api.ts`.
- `<domain>/api.ts` — typed `httpRequest` wrappers per domain.
- `hooks/useIsMobile.ts` — `Grid.useBreakpoint()` wrappers for responsive.
- `i18n/` — `index.ts` (i18next init), `locales/{es,en}.json` catalogs.
- `layouts/AppLayout.tsx` — sidebar + header + content; hamburger drawer
  at `< md` breakpoint.
- `lib/antdRules.ts` — `rule(check)` helper bridging shared `check*` to
  antd Form rules.
- `mocks/ipc.ts` — `window.fetch` stub for `VITE_USE_MOCKS=1`. Mirrors the
  Deno backend's API surface against in-memory seed data.
- `pages/` — one `.tsx` per route (`Setup`, `Login`, `Dashboard`, `Parties`,
  `Loans`, `Payments` drawer, `Payouts`, `Users`, `AuditLog`, `Settings`).
- `test/setup.ts` — Vitest setup (cleanup, fetch stub, jest-dom matchers).

**Backend source layout (`apps/backend/src/`):**

- `server.ts` — Hono entry: middleware chain (CORS, requireLocalToken,
  session), route mounts, `Deno.serve` printing `HIPO_READY`.
- `config.ts` — env-var-driven config (`HIPO_PORT`, `HIPO_DATA_DIR`,
  `HIPO_AUTH_TOKEN`, `HIPO_STATIC_DIR`, `HIPO_SESSION_TTL_DAYS`).
- `db/{client,schema,migrations}.ts` — Drizzle setup + table defs + v1
  migration.
- `<domain>/{operations,types,validators}.ts` — `do_*` operations,
  `Public*` type aliases, validator wrappers. Each domain has a
  `*_test.ts` next to `operations.ts`.
- `routes/<domain>.ts` — Hono routes, one per domain.
- `audit/write.ts` — `writeAudit(tx, ...)` helper.
- `auth/{passwords,types}.ts` + `middleware/session.ts` — session +
  argon2 + Ctx + requireAuth/Admin.
- `errors.ts` + `error_handler.ts` — `AppError` class + `onError` handler.
- `static.ts` — SPA fallback (serves `dist/` outside `/api/*`).
