# templates/minimal — framework build-gate template

This is the framework's **build-gate template**. It is the simplest possible
consumer of the local-first framework packages: it boots, lets you log in, shows
"hello {user}", and lets you take an encrypted backup. Nothing more.

**Any change to a `packages/*` API that breaks this template's build or smoke is
wrong by construction.** If `templates/minimal` fails after a package change,
the package change is the bug — fix the package, not the template.

## What it composes

| Package              | What it provides                                                    |
| -------------------- | ------------------------------------------------------------------- |
| `@hipo/sqlite`       | OPFS-backed SQLite via sqlocal; migrations runner                   |
| `@hipo/server`       | Hand-rolled 50-LOC router; `serveOnPort` worker bridge              |
| `@hipo/auth`         | Users + sessions; `doSetupFirstAdmin`, `doLogin`, `doLogout`        |
| `@hipo/audit`        | `writeAudit` (used implicitly by auth operations)                   |
| `@hipo/backup`       | AES-GCM encrypt/decrypt; `packEnvelope`/`unpackEnvelope`; `gzipped` |
| `@hipo/backup-local` | `downloadTarget` + `readBackupFromFile`                             |

**Adds:** users + sessions tables + auth routes + one backup endpoint. **Nothing
else.** No parties, loans, payouts, or hipo domain.

## How to run

```sh
# From repo root (installs workspaces including @hipo/* symlinks):
npm install

# Start the dev server on port 1430:
cd templates/minimal && npm run dev
```

Open `http://localhost:1430`. The first visit triggers:

1. Service Worker registration + COOP/COEP injection (one reload).
2. Passphrase entry (sets up encrypted backup key).
3. Admin account creation.
4. "Hello admin" + backup/restore buttons.

## File tour

```
templates/minimal/
├── public/sw.js              Merged SW: COOP/COEP + /api/* routing
├── src/
│   ├── main.tsx              Boot: SW → OPFS check → Worker → React
│   ├── App.tsx               Auth-state switch (loading/setup/login/main)
│   ├── BootstrapApp.tsx      Pre-boot wrapper for the passphrase page
│   ├── in-page-backend.ts    SW registration + Worker spawn helpers
│   ├── in-page-worker.ts     Worker entry: DB + Router + auth + backup routes
│   ├── migrations.ts         Version 1: users + sessions tables
│   ├── api.ts                httpRequest wrapper + typed API calls
│   ├── opfs-state.ts         OPFS marker file detection
│   ├── PassphraseContext.tsx In-memory passphrase + derived-key cache
│   ├── styles.css            Plain CSS, no UI library
│   └── pages/
│       ├── Bootstrap.tsx     Passphrase entry
│       ├── Setup.tsx         First-admin creation
│       ├── Login.tsx         Username + password
│       └── Main.tsx          hello {user} + backup + restore + logout
├── tests/
│   └── boot.test.tsx         Vitest smoke: components mount without crashing
├── smoke.mjs                 Playwright E2E: bootstrap → setup → backup → verify
└── README.md                 This file
```

## Copy to start a new app

```sh
cp -r templates/minimal apps/myapp
# Then:
#   - rename in package.json
#   - add your domain migrations to src/migrations.ts
#   - add domain routes to src/in-page-worker.ts
#   - add domain pages under src/pages/
```

## Running checks

```sh
cd templates/minimal
npx tsc --noEmit       # type check
npx vitest run         # unit smoke tests
node smoke.mjs         # Playwright E2E (requires Vite dev server + Chromium)
```
