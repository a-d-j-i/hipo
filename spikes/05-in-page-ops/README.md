# Spike 05 — in-page `do_*` ops against OPFS

**Goal:** prove the framework's `do_*` operations (parties, loans, audit etc.)
run unchanged in a browser, executing against an OPFS-backed SQLite DB via
`@hipo/sqlite/client-browser` + `@hipo/auth/passwords.browser`. Phase 2 of the
framework plan.

## How to run

```bash
cd spikes/05-in-page-ops
npm install   # workspace deps; resolves @hipo/* via root node_modules
npm run dev
# open http://127.0.0.1:5178
```

Or headless via Playwright:

```bash
node bench.mjs
```

## Result (Phase 2D, 2026-05-17)

```
crossOriginIsolated: true
opening OPFS DB…
DB opened + migrations applied
calling doSetupFirstAdmin…
admin created in 213 ms        ← Argon2id KDF, matches Spike 4
calling doListUsers…
doListUsers returned 1 user(s)
smoke ok ✓
```

The `doSetupFirstAdmin` source that runs in `apps/hipo` on Deno runs
unchanged here in a browser. Same Drizzle queries, same audit write inside the
transaction. Only swapped:

- `@libsql/client/node` → `sqlocal` + `drizzle-orm/sqlite-proxy` (via
  `@hipo/sqlite/client-browser`)
- `@node-rs/argon2` (Node native) → `hash-wasm` Argon2id (browser)

## Notes on the `passwords.ts` swap

`@hipo/auth/src/operations.ts` imports `./passwords.ts` (the `@node-rs/argon2`
Node implementation). Vite resolves that to an absolute path and tries to bundle
its `@node-rs/argon2` import — which fails in a browser.

The spike uses a tiny `resolveId` plugin (with `enforce: "pre"`) to swap the
resolved path for `passwords.browser.ts` before Vite's import-scanner walks it.
`optimizeDeps.exclude` keeps the @hipo/\* workspace packages out of pre-bundling
so the plugin actually runs.

The framework-level fix (when we get there in `templates/minimal` or
post-Phase-9) is a `browser` export condition on `@hipo/auth/passwords` so the
swap is automatic. Spike-level shim is good enough for now.

## What's worth keeping

- `packages/sqlite/src/client-browser.ts` and the unified `migrations-runner.ts`
  — production-ready as-is.
- `packages/auth/src/passwords.browser.ts` — same. PHC-encoded output is
  cross-compatible with `@node-rs/argon2`, so hashes are portable across the
  Deno and browser shapes (matters for backup restore in Phase 4).
- The `resolveId` shim — copy into `templates/minimal` later, or replace with
  the proper conditional-exports refactor.
- `bench.mjs` — headless driver pattern that can be CI-ized.
