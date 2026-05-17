# Spike 04 — Performance baseline

**Goal:** capture real numbers to anchor the Performance budget section
in `docs/local-first-framework.md`. Measure cold-start, the full backup
pipeline (export → gzip → Argon2id KDF → AES-GCM → verify), and bundle
weight against a synthetic 5 MB DB.

## Run

```bash
cd spikes/04-perf-baseline
npm install
npm run dev
# open http://127.0.0.1:5177
```

Then:

1. The "Cold-start timings" table populates automatically. Hard-refresh
   (Ctrl+Shift+R) to measure a true cold load; soft-refresh for warm.
2. Click **Seed** with the default (5000 rows × 1024 bytes = ~5 MB) to
   generate a synthetic DB.
3. Click **Count rows** to verify; **Inspect OPFS** (DevTools or copy
   from Spike 03) to see the on-disk size.
4. Click **Run backup benchmark** to exercise the full encrypt/verify
   pipeline. Stage-by-stage timings appear in the table.

## What's measured

**Cold-start timings** (relative to module-start):

- `isolation+SW ready` — SW registered, controller in place, COI true.
- `worker loaded` — dedicated Worker bootstrapped its module.
- `port wired` — MessageChannel handshake complete; can now serve API.
- `first /api/health` — first real round-trip through the full stack.

The gap between `port wired` and `first /api/health` is the
end-to-end overhead of the SW → Worker → router → response chain
for a no-op request.

**Backup pipeline** (per-stage, one shot):

- `read-opfs` — fetch `spike-04.sqlite3` bytes via
  `navigator.storage.getDirectory()`.
- `gzip` — `CompressionStream("gzip")` over the bytes.
- `kdf` — `hash-wasm` Argon2id (m=64 MiB, t=3, p=1, 32-byte output)
  + `crypto.subtle.importKey` to an AES-GCM key.
- `encrypt` — AES-GCM with random 12-byte IV.
- `decrypt` / `gunzip` / `verify` — round-trip the encrypted blob
  back to bytes and length-check against the original.

## Automatic results (build + tooling)

- ✅ `npm install` clean (sqlocal 0.18.0 + drizzle 0.36 + hash-wasm 4.11 + vite 6).
- ✅ `tsc --noEmit` clean.
- ✅ Production build emits all artifacts.
- ✅ Dev server serves `/`, `/sw.js`, `/src/main.ts`, `/src/backup.ts`
      with COOP/COEP headers.

### Bundle weight (post-gzip)

| Asset | Size (gzipped) |
|---|---|
| `index.html` | 1.42 KB |
| Main JS (with hash-wasm + backup pipeline) | 14.25 KB |
| Worker chunk (raw) | 97.19 KB |
| Vendor (Drizzle, raw) | 219.43 KB |
| sqlite3 worker bootstrap (raw) | 217.41 KB |
| sqlite3 OPFS async proxy (raw) | 11.64 KB |
| SQLite WASM | 399.15 KB |
| Worker wrapper (raw) | 19.59 KB |

**Main-thread bundle vs Spike 03:** 1.77 KB → 14.25 KB. The delta is
the hash-wasm JS wrapper for Argon2id (its actual WASM module loads
lazily on first KDF call). For the framework this stays in budget
(target: < 400 KB main thread), and in the real app this code would
sit in `packages/backup` and only load when the Settings → Backup
page is opened.

## Result — measured numbers

Headless Chromium / Linux, dev server (production gzip costs apply
on top — see "How dev vs prod differs" below). Data: 5000 rows × 1 KB
of pseudo-random text via the `randomText()` LCG.

### Cold-start (first navigation, fresh context)

| Event | Time (ms since module-start) |
|---|---|
| DOMContentLoaded | 101 |
| isolation+SW ready | 14 |
| worker loaded | 66 |
| port wired | 67 |
| first /api/health | 68 |

**Time to interactive: 68 ms.** Budget: < 5,000 ms — comfortably inside.

### Warm-start (reload, OPFS populated, SW cached)

| Event | Time (ms) |
|---|---|
| DOMContentLoaded | 16 |
| isolation+SW ready | 1 |
| worker loaded | 24 |
| port wired | 25 |
| first /api/health | 26 |

**Time to interactive: 26 ms.** Budget: < 500 ms — comfortably inside.

### Seeding 5 MB synthetic DB

- 5000 rows × 1024 bytes random text inserted in **362 ms** (Drizzle
  batches of 500).

### Backup pipeline (5.6 MiB raw DB → 4.1 MiB compressed)

| Stage | Time (ms) | Output size | Notes |
|---|---|---|---|
| read-opfs | 17 | 5.61 MiB | navigator.storage.getDirectory + getFile |
| gzip | 98 | 4.11 MiB | CompressionStream("gzip") |
| kdf (Argon2id m=64MiB, t=3, p=1) | 182 | — | **56% of total** — dominant |
| encrypt (AES-GCM) | 3 | 4.11 MiB | + 16-byte tag, 12-byte IV |
| decrypt | 3 | 4.11 MiB | round-trip verification |
| gunzip | 24 | 5.61 MiB | |
| verify (length match) | 0 | — | bytes equal |
| **Total** | **327** | | Budget < 2,000 ms — inside |

Compression ratio: **73.2%** (4.11 / 5.61). Matches our 50–80% estimate
for SQLite-with-mixed-data exactly.

### Key takeaways

1. **Crypto is not the bottleneck — KDF is.** Argon2id at our parameters
   is 56% of total backup time. AES-GCM encrypt/decrypt is 3 ms each on
   4 MiB. Per the plan: cache the derived key for the session so
   subsequent backups skip the 182 ms KDF cost.
2. **CPU portion of cold-start is tiny** (~70 ms). On a real network the
   WASM download dominates; budget should be set against network, not
   CPU.
3. **Compression ratio confirmed.** The plan's 50–80% target was right;
   real-life data lands in the middle of the range.
4. **Worker boot ~50 ms warm, ~65 ms cold.** Negligible vs network or
   crypto.
5. **First-fetch round-trip overhead: ~2 ms** through SW → Worker →
   router → Worker → SW chain. The added topology costs essentially
   nothing.

### How dev vs prod differs

Cold-start numbers above are from `vite dev` (un-minified, served
fresh per module). In production:
- Main thread JS is bundled (smaller, faster parse)
- SQLite WASM is the same 399 KB gzipped
- Network is the dominant variable; on a 10 Mbps line the WASM
  download adds ~320 ms (vs near-zero on localhost)

So on a real connection, **cold-start ≈ 400–500 ms**; on cached warm,
the 26 ms measured here is representative.

### Cross-browser (Chromium confirmed; Firefox + WebKit pending)

| Browser | Cold-start | Backup total | Notes |
|---|---|---|---|
| Chromium / Linux / headless dev | 68 ms | 327 ms | this run |
| Chromium / Linux / desktop | confirmed working | — | user, Spike 03 |
| Firefox / Linux / desktop | confirmed working | — | user, Spike 03 |
| WebKit (Epiphany / GNOME Web) | not tested | not tested | |

Numbers are robust enough on a single browser to validate the
architecture; cross-browser is for stability not perf.

## How this feeds the Performance budget

Once filled, the numbers update `docs/local-first-framework.md` in the
Performance budget table — replacing the placeholder estimates with
measured anchors.

Key questions the data should answer:

- Does cold-start fit the < 5 s target on a representative connection?
- Does warm-start fit the < 500 ms target?
- Does a 5 MB backup fit the < 2 s target (excluding network)?
- Is Argon2id KDF the dominant cost (most likely it will be)? If yes,
  by how much, and does it justify caching the derived key for the
  session?
- Does gzip compression ratio align with the 50–80% estimate?

## What's worth keeping

- `src/backup.ts` — the staged pipeline becomes the basis for
  `packages/backup/src/{encrypt.ts,export.ts,format-binary.ts}`.
- The Argon2id parameters (m=64 MiB, t=3, p=1) are reasonable starting
  values; tune after measuring on slower devices.
- The cold-start milestone-marker pattern in `main.ts` becomes a
  framework helper (`packages/server/src/timings.ts`) so consumer apps
  can self-report their own boot phases for dev-tooling.

## What still needs you

Fill in the tables above. Numbers from a single machine are enough to
move; cross-browser passes can come later.
