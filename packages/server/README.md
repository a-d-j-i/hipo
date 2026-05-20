# @hipo/server

Framework substrate: HTTP plumbing shared by all app shapes (in-page Worker,
deployed server, Tauri).

## Public surface (current — Phase 1B)

```ts
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
} from "@hipo/server";
```

## Coming in Phase 1C

- `router.ts` — the 53-LOC hand-rolled router from Spike #2.
- `ctx.ts` — `Ctx = { db, user }` (currently lives in `@hipo/auth`).
- `error-handler.ts` — `AppError → Response` converter.
- `cookies.ts`, `cors.ts` — small replacements for hono/cookie + hono/cors.
- Worker entry + Service Worker fragment helpers for the in-page shape.
