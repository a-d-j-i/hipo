# hipo backend

TypeScript backend running on Deno. Serves the React SPA and exposes the JSON
API. The same binary runs as a Tauri sidecar locally and as the cloud server.

## Prerequisites

Install Deno (https://deno.com):

```bash
npm install -g deno
```

## Tasks

```bash
deno task dev              # start dev server with --watch
deno task start            # production-mode run
deno task check            # type-check
deno task compile:linux    # build Linux x86_64 single binary
deno task compile:windows  # cross-compile Windows x86_64 binary from Linux
```

## Configuration (env vars)

| Var                     | Default    | Purpose                                                                                                                                                     |
| ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIPO_PORT`             | `0` (auto) | Port to bind on `127.0.0.1`. `0` picks a free one and prints it to stdout (used by the Tauri shell to discover where to point the webview).                 |
| `HIPO_DATA_DIR`         | `./data`   | Where SQLite files live.                                                                                                                                    |
| `HIPO_AUTH_TOKEN`       | unset      | Localhost-only auth token. When set, every request must carry `X-Hipo-Token: <value>`. Tauri shell generates and injects this; cloud build leaves it unset. |
| `HIPO_STATIC_DIR`       | `../dist`  | Path to the built React SPA. Served as fallback for any non-API route.                                                                                      |
| `HIPO_SESSION_TTL_DAYS` | `30`       | Session cookie lifetime.                                                                                                                                    |

## Architecture notes

- **One SQLite file per "scope"** — locally that means one file. In cloud mode
  (later), one file per org, routed by subdomain.
- **Sessions are DB-backed**, not JWT. Logout =
  `DELETE FROM sessions WHERE id = ?`. See the deployment-directions memory for
  the full rationale.
- **`do_*` pattern** carries over from the Rust backend: business logic is plain
  async functions taking the connection + scoped context; route handlers are
  thin wrappers. Same testability gain.
- **No `Deno.*` namespace** in business logic — only Web Standard APIs + Hono +
  Drizzle. Keeps the code runnable on Node/Bun/Workers if the runtime ever
  changes.
