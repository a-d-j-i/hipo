# @hipo/server-deploy

Deno HTTP shell for the local-first framework. Boots a `Router`, attaches the
framework's stock middleware chain (security headers, optional CORS, optional
X-Hipo-Token gate, static SPA fallback), runs the consumer's `build(app)`
callback to attach app-specific session middleware + routes, then calls
`Deno.serve`.

This is what makes **promoting from Shape 1 (OPFS local-first) to Shape 2 (real
HTTP server)** a configuration change rather than a rewrite. The same `do_*`
operations and the same router work in both shapes — server-deploy just provides
the Deno-specific boot boilerplate.

## Usage

```ts
import { serve } from "@hipo/server-deploy";
import { openDb } from "./db/client.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { registerAllRoutes } from "./routes/index.ts";

const { db } = await openDb();

await serve({
  port: 8787,
  cors: {
    allowedOrigins: new Set(["http://localhost:1420", "http://127.0.0.1:1420"]),
    credentials: true,
  },
  staticDir: "../dist",
  build(app) {
    app.use(sessionMiddleware(db));
    registerAllRoutes(app);
  },
});
```

Boots a server on 127.0.0.1:8787, logs `HIPO_READY hostname=127.0.0.1 port=8787`
so a wrapping shell can parse the actual port.

## Shape 1 → Shape 2 promotion recipe

The framework's default deployment is Shape 1 — single-user, OPFS-backed,
browser only. Promoting to Shape 2 (shared libsql on a real server) is a
configuration change:

1. Provision a Linux VM (Fly.io / Render / Hetzner). $5/mo is fine for under
   ~100 users.
2. Build `apps/backend` (`deno task compile:linux`) and copy the binary to the
   host.
3. Set env vars: `MYAPP_PORT=8787`, `MYAPP_DATA_DIR=/var/lib/myapp/`, no
   `MYAPP_AUTH_TOKEN` (that's for sidecar mode), `MYAPP_STATIC_DIR` pointing at
   your built SPA.
4. Point the consumer SPA's `VITE_BACKEND_URL` at the deployed host; turn off
   `VITE_INPAGE_BACKEND` so it goes through real HTTP.
5. Wire Litestream (or equivalent) for server-side incremental backups of the
   SQLite file to S3.
6. **Consolidate existing user data**: each user exports their OPFS backup,
   admin imports/merges them. Discrete migration moment, not a continuous flow.

Frontend code, `do_*` operations, Drizzle schema, migrations, audit log, and
`@hipo/backup` envelopes are unchanged. The router app stays runnable in-page
(Shape 1) for offline use.

## Exports

| Path                              | What                             |
| --------------------------------- | -------------------------------- |
| `@hipo/server-deploy`             | `serve`, plus everything below   |
| `@hipo/server-deploy/security`    | `securityHeaders`, `DEFAULT_CSP` |
| `@hipo/server-deploy/cors`        | `cors`                           |
| `@hipo/server-deploy/local-token` | `requireLocalToken`              |
| `@hipo/server-deploy/static-spa`  | `staticSpa`                      |
| `@hipo/server-deploy/env`         | `envRaw`, `envInt`, `envString`  |

## What's NOT here yet

Hosting artifacts (Dockerfile, fly.toml, Litestream config) are deferred to
Phase 11 of the framework plan. The current package is the code extraction;
deploy templates land when the first consumer actually ships a hosted build.
