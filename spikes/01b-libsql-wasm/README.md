# Spike 01b — @libsql/client-wasm + Drizzle + OPFS

**Goal:** evaluate whether `@libsql/client-wasm` is viable as the framework's
`packages/sqlite` substrate, preserving the Turso embedded-replica upgrade path
documented in [[project-hipo-deployment-directions]] and the "Promotion path"
section of `docs/local-first-framework.md`.

**Comparison anchor:** spike 01 (sqlocal + Drizzle).

## Setup

```bash
cd spikes/01b-libsql-wasm
npm install
npm run dev
# open http://127.0.0.1:5174
```

COOP/COEP headers are set **manually** in `vite.config.ts` (no Vite plugin
shipped by libsql-wasm; sqlocal had one).

## Result (Phase 0 Spike #1b, 2026-05-17)

### What's confirmed automatically

- ✅ `npm install` succeeds. Adds `@libsql/client-wasm` ^0.17.3, which pulls in
  `@libsql/libsql-wasm-experimental` ^0.0.2 transitively.
- ✅ Drizzle has a **dedicated `drizzle-orm/libsql/wasm` adapter** that imports
  from `@libsql/client-wasm` (not `@libsql/client`). Using the wrong entry point
  (`drizzle-orm/libsql`) fails the build.
- ✅ `tsc --noEmit` is clean.
- ✅ Vite build succeeds **after** setting `build.target: "es2022"` —
  `@libsql/client-wasm` uses top-level await, which ES2020 default doesn't
  support.
- ✅ Dev server serves with correct COOP/COEP headers (manual config in
  `vite.config.ts`).

### Measured bundle sizes (post-gzip)

| Asset                      | Size (gzipped)         | vs spike-01 (sqlocal)                        |
| -------------------------- | ---------------------- | -------------------------------------------- |
| `index.html`               | 1.10 KB                | ~same                                        |
| Main JS bundle             | 90.48 KB               | smaller (sqlocal split into 28 + 67 = 95 KB) |
| `sqlite3-*.wasm`           | **1,762 KB** (1.76 MB) | **vs 399 KB — 4.4× larger**                  |
| `sqlite3-opfs-async-proxy` | 10.92 KB raw           | ~same                                        |

**Critical-path cold-start payload:** ~1.85 MB gzipped. **vs spike-01:** ~495 KB
gzipped (3.7× larger payload).

On a 10 Mbps connection: ~1.5 seconds of _additional_ download for the WASM
alone. Still inside the < 5s cold-start budget on fast networks, but tight;
flaky mobile would push past.

### vs Performance budget in plan

- Main thread JS < 400 KB ✓ (90 KB, well under)
- SQLite-WASM < 600 KB ❌ **(1.76 MB, ~3× over)**
- Framework JS < 100 KB ✓

The SQLite-WASM budget number was set with vanilla sqlite-wasm in mind. libsql
is a SQLite _fork_ with significant additions (replication protocol, server
features compiled in even for the embedded build). The 1.76 MB is the cost of
buying the Turso upgrade path upfront.

### What still needs human verification

Open `http://127.0.0.1:5174` and check:

- [ ] `crossOriginIsolated === true` in the Environment panel
- [ ] Migration succeeds (log: "migration ok")
- [ ] Insert + Refresh work
- [ ] **Reload page → row is still there** (THE key test — does
      `file:spike-01b.db` actually persist to OPFS?)
- [ ] DevTools → Application → Storage → Origin Private File System → check
      whether libsql wrote to OPFS or somewhere else
- [ ] Cross-browser: Chromium, Firefox, WebKit-based

### Caveats discovered during build

1. **No Vite plugin.** Headers must be configured manually (`vite.config.ts`
   `server.headers` + `preview.headers`). Sqlocal shipped this; libsql-wasm
   doesn't.
2. **Top-level await** — `build.target` must be ≥ `es2022` (or `esnext`).
   Without this, Vite production builds fail.
3. **`@libsql/libsql-wasm-experimental` is v0.0.2** — a pre-release transitive
   dep we have no control over. The whole stack inherits that maturity level for
   the OPFS persistence layer.
4. **OPFS persistence is undocumented** — the example in the upstream repo just
   does `SELECT * FROM users` against `file:local.db` with no CREATE TABLE step.
   Doesn't actually demonstrate persistence. Whether `file:spike-01b.db` writes
   to OPFS or to memory is what this spike's manual run will determine.

### Decision matrix

| Criterion                                 | sqlocal (01)                        | libsql-wasm (01b)                       |
| ----------------------------------------- | ----------------------------------- | --------------------------------------- |
| Bundle size (WASM, gzip)                  | 399 KB ✓                            | 1.76 MB ❌                              |
| Critical-path payload                     | 495 KB ✓                            | 1.85 MB ⚠                               |
| Vite integration                          | Plugin ships with package ✓         | Manual config ⚠                         |
| Drizzle adapter                           | `sqlite-proxy` ✓                    | `libsql/wasm` ✓                         |
| TypeScript types                          | Clean ✓                             | Clean ✓                                 |
| OPFS persistence (verified)               | needs manual test                   | needs manual test + URL scheme research |
| Worker management                         | Built in ✓                          | Unclear — needs verification            |
| Upstream maturity                         | 0.18.0, MIT, active                 | 0.17.3 + 0.0.2 transitive ⚠             |
| Future Turso embedded replica path        | ✗ (would need re-substrate)         | ✓ (native fit)                          |
| Future Turso _remote_ (Shape 2 with sync) | Available via libsql (re-substrate) | Available trivially                     |

### Recommendation

**Stay with sqlocal (Spike 01) as the framework substrate**, with the Turso path
treated as a future re-substrate event rather than a preserved option.
Rationale:

1. The **3× bundle weight** of libsql-wasm is a load-bearing tax paid on every
   cold start, for an option (Turso embedded replicas) that may never be
   exercised. Better to ship lean today and pay the migration cost later if/when
   needed.
2. **Sqlocal's Vite plugin** handles operational details (headers, Worker setup)
   we'd otherwise own; this is real engineering effort saved.
3. The Turso _remote_ sync (Shape 2 promotion path) doesn't actually require
   libsql-wasm at the client — it can be added later by wrapping fetch calls or
   by switching to libsql-wasm at that point. What we lose by not picking
   libsql-wasm today is only the **local- replica-of-Turso** mode, which is the
   "offline-capable Shape 2" intermediate. That mode is itself a "consider
   later" option in the plan.

This **flips the bias** that the plan had toward libsql-wasm — we now have
measured numbers that justify the change. The plan's "Promotion path" section
should be updated:

> Strategic Phase 0 implication: bias adapter pick toward libsql-wasm…

becomes:

> Phase 0 measurements (2026-05-17) showed libsql-wasm's WASM bundle is ~4× the
> size of vanilla SQLite-WASM (1.76 MB vs 399 KB gzipped). The framework picks
> vanilla SQLite-WASM via sqlocal for v1. Turso embedded replicas are a possible
> future substrate migration, not a preserved option.

### What's worth keeping from this spike

- The `drizzle-orm/libsql/wasm` import-path finding (most likely saves the next
  person an hour of debugging).
- The "Vite + top-level await needs es2022 target" finding.
- The bundle-size measurement (1.76 MB) — anchor for any future re-evaluation.
- The verdict — keep this README as the "why we didn't pick libsql-wasm"
  reference.
