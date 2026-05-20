# @hipo/auth

Framework auth package: users + sessions tables, Argon2id passwords,
rate-limited login, `Ctx` + auth-guards. Swappable (apps with different role
models or auth flows can drop this and ship their own).

## Public surface

```ts
import {
  // Operations
  doAuthStatus,
  doCurrentUser,
  doListUsers,
  doSetupFirstAdmin,
  doLogin,
  doLogout,
  doChangePassword,
  doCreateUser,
  doDeleteUser,
  doResetUserPassword,
  doChangeUserRole,
  // Helpers
  hashPassword,
  verifyPassword,
  validatePassword,
  validateUsername,
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
  // Types + guards (Ctx moves to @hipo/server in Phase 1C)
  type Ctx,
  requireAuth,
  requireAdmin,
  publicUser,
  nowSecs,
  type User,
  type AuthStatus,
  // Schema
  users,
  sessions,
  type UserRow,
  type NewUser,
  type Session,
} from "@hipo/auth";
```

For deep imports:

```ts
import { users, sessions } from "@hipo/auth/schema";
```

## What this package does not own

- **Migrations** that create the tables — see `apps/<app>/src/db/migrations.ts`
  for now; future split per Phase 1's eventual lex-ID migration story.
- **HTTP/cookie wiring** (`middleware-session.ts`) — lives in `apps/hipo`
  (rewritten on the framework router in Phase 1C).
