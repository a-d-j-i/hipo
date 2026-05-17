# Spike 02 — Service Worker + dedicated Worker + hand-rolled router

**Goal:** validate the framework's runtime topology end-to-end:
`fetch("/api/…")` on the main thread → Service Worker intercepts →
forwards to dedicated Worker via MessageChannel → router dispatches →
Drizzle hits OPFS SQLite → response. **No Hono** — testing whether
~50 LOC of hand-rolled router is enough.

## How to run

```bash
cd spikes/02-sw-worker-routing
npm install
npm run dev
# open http://127.0.0.1:5175
```

## Result (Phase 0 Spike #2, 2026-05-17)

### What's confirmed automatically

- ✅ `npm install` succeeds.
- ✅ `tsc --noEmit` clean.
- ✅ Vite build succeeds; emits Worker chunk separately from main bundle.
- ✅ Dev server serves `/` and `/sw.js` with COOP/COEP headers
  (verified via `curl -I`).
- ✅ `/sw.js` is served from `public/` and reachable at root scope.
- ✅ Worker entry transpiles via `new Worker(new URL("./worker.ts",
  import.meta.url))`.

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Main thread (src/main.ts)                                  │
│  - spawns dedicated Worker                                 │
│  - registers /sw.js, reloads once if first install         │
│  - creates a MessageChannel, hands port1→Worker,           │
│    port2→ServiceWorker via postMessage with transfer       │
│  - thereafter just calls vanilla fetch("/api/…")           │
└──────┬─────────────────────────────────────────────────────┘
       │ fetch /api/*
       ▼
┌────────────────────────────────────────────────────────────┐
│ Service Worker (public/sw.js, plain JS)                    │
│  - intercepts /api/* via "fetch" event                     │
│  - serializes Request → wire format                        │
│  - postMessage on api port → Worker                        │
│  - awaits matching response by id                          │
│  - reconstructs Response, returns to caller                │
└──────┬─────────────────────────────────────────────────────┘
       │ port.postMessage(wireReq)
       ▼
┌────────────────────────────────────────────────────────────┐
│ Dedicated Worker (src/worker.ts)                           │
│  - receives wireReq via api port                           │
│  - reconstructs Request                                    │
│  - calls app.fetch(req) — Router from src/router.ts        │
│  - serializes Response → wire format                       │
│  - postMessage back through port                           │
└────────────────────────────────────────────────────────────┘
                       │
                       ▼ Drizzle + sqlocal + SQLite-WASM + OPFS
```

The wire protocol is simple:

```ts
type WireRequest  = { id, method, url, headers, body: string | null }
type WireResponse = { id, status, statusText, headers, body: string }
```

Bodies are text-encoded for this spike. Binary support is a follow-up
(structured-clone the ArrayBuffer or use Transferable).

### The hand-rolled router

`src/router.ts` is **53 LOC including imports** (verifiable).
Provides:

- `router.get|post|put|delete(path, handler)` — chainable.
- Path parameters: `/api/items/:id` → `ctx.params.id`.
- `Web Standard Request` in, `Response` out.
- `router.onError(fn)` — handler-thrown errors become 500 by default.
- `json(body, init?)` helper for `Response.json()`-style ergonomics.
- 404 fallback returns `{ "error": "METHOD /path not found" }`.

Route handlers (`src/routes.ts`):

```ts
const app = new Router()
  .get("/api/health", () => json({ ok: true, ts: Date.now() }))
  .get("/api/items", async () => {
    const rows = await db.select().from(items);
    return json({ items: rows });
  })
  .get("/api/items/:id", async ({ params }) => {
    const [row] = await db.select().from(items).where(eq(items.id, +params.id));
    return row ? json(row) : json({ error: "not found" }, { status: 404 });
  })
  .post("/api/items", async ({ req }) => {
    const body = await req.json();
    const [inserted] = await db.insert(items).values({...}).returning();
    return json(inserted, { status: 201 });
  })
  .delete("/api/items", async () => {
    await db.delete(items);
    return json({ ok: true });
  });
```

Reads exactly like Hono. Different import, same ergonomics.

### Measured bundle (post-gzip)

| Asset | Spike 01 (no SW/router) | Spike 02 (SW+router) | Delta |
|---|---|---|---|
| `index.html` | 1.00 KB | 1.13 KB | +0.13 KB |
| **Main thread JS (gzipped)** | **95 KB** | **1.54 KB** | **−93 KB** |
| Worker / routes chunk (raw) | — | 97 KB | new |
| Vendor (Drizzle) raw | (mixed in) | 219 KB | (moved here) |
| SQLite WASM (gzipped) | 399 KB | 399 KB | — |
| Service worker | — | ~2 KB | new |

**Surprise win:** moving Drizzle + routes + sqlocal driver into the
Worker module made the main thread bundle drop from 95 KB to 1.54 KB
gzipped. The user sees a near-instant first paint; the heavy stuff
loads in the Worker after the page renders. This is exactly the
code-split-by-architecture property we wanted, and it falls out of
Vite's worker handling for free.

Critical-path payload for first paint is now **~3 KB** of JS + HTML.
The WASM (399 KB) loads in the Worker after, which means it doesn't
block first paint at all. A consumer app's interactivity would gate
on the Worker being ready (Hono / router not available until then),
but the *page itself* paints immediately.

### Hono vs hand-rolled — verdict

**The hand-rolled router is sufficient for the framework v1.**

Side-by-side cost:

| | Hono | hand-rolled |
|---|---|---|
| Bundle (gzipped) | ~15 KB | ~1 KB (the 50 LOC compiled) |
| Path params | ✓ | ✓ |
| Method routing | ✓ | ✓ |
| Error handler | ✓ | ✓ |
| `Response`/`Request` Web Standard | ✓ | ✓ |
| `app.fetch(req)` isomorphism | ✓ | ✓ |
| Middleware chain | ✓ rich | absent — need to add if hipo needs it |
| Body/header helpers | ✓ rich | `req.json()`, `Response.json()` are enough |
| Validators / type-safe routing | ✓ | absent |
| Community plugins | ✓ | none |
| Maintenance | external | ours |

The "absent" items above are real but not blocking for v1 — middleware
can be a 10-LOC wrap pattern when we need it (`packages/auth` would
add it). The bundle savings are smaller than I'd estimated (~14 KB)
because Hono is already pretty tight.

**Recommendation:** ship hand-rolled. Revisit *only* if:
- `packages/auth` middleware patterns grow more elaborate than a
  simple wrap-handler chain, OR
- A consumer app wants Hono's rich validator/plugin ecosystem, OR
- The Shape 2 server promotion path benefits from Hono's
  better-tested production-server semantics.

If we ever do revisit, swapping is a search-and-replace in the route
files plus a trivial Worker entry change.

**Plan update implied:** strike "Hono" from `packages/server`'s
description; the substrate is just a router + Ctx. `packages/server`
gets ~10x smaller.

### What still needs human verification

Real browsers haven't run the spike yet. Open
http://127.0.0.1:5175 and check:

- [ ] Status panel shows `crossOriginIsolated: true`, then "Worker:
      loaded", then "Service Worker: controlling, port wired".
- [ ] **First-load reload happens once** (SW skipWaiting + claim
      flow). Subsequent reloads should be instant.
- [ ] `GET /api/health` returns `{ ok: true, ts: ..., worker: true }`.
- [ ] `POST /api/items` with text inserts; `GET /api/items` lists it.
- [ ] **Reload page → list still has the row** (OPFS persistence
      through the SW + Worker chain).
- [ ] `GET /api/missing` returns 404 with JSON error body.
- [ ] DevTools Network tab shows `/api/health` as "(ServiceWorker)"
      (intercepted, not network).
- [ ] DevTools Application → Service Workers → shows `/sw.js`
      active.
- [ ] Cross-browser: Chromium, Firefox, WebKit-based.

### Risks / known issues

1. **First-install reload UX.** Code does
   `setTimeout(() => location.reload(), 100)` if `controller` is null
   after register — ugly. The framework version should use
   `serviceWorker.ready` and the `controllerchange` event more
   carefully so the reload is invisible.
2. **Multi-tab.** Each tab spawns its own Worker, but only one tab can
   own the OPFS sync access handle at a time. Second tab will get an
   exclusive-lock error or a stuck Worker. BroadcastChannel-based
   leader election (from the plan's risks) is the v1 fix; not in this
   spike.
3. **Binary bodies.** Spike serializes bodies as text. Real framework
   needs structured-clone of ArrayBuffer for file uploads etc. Easy
   to add to the wire protocol.
4. **No middleware in the router yet.** When auth ships, we add a
   `router.use(fn)` that wraps every handler. ~5 LOC. Defer until
   needed.

### What's worth keeping from this spike

- `src/router.ts` — the 53-LOC router. Becomes the basis for
  `packages/server/src/router.ts` (with a few hardening tweaks).
- The wire protocol shape (`WireRequest` / `WireResponse`) and the
  MessageChannel handshake pattern. Becomes
  `packages/server/src/worker-bridge.ts` and
  `packages/sw/src/api-route.ts`.
- The plain-JS `public/sw.js` as starting point for `packages/sw`.
- The `setTimeout` reload hack in `main.ts` — **flag** as the first
  thing to clean up when productionizing.
