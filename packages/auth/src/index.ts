// Public surface for @hipo/auth.
//
// `Ctx` lives here temporarily; will move to @hipo/server in Phase 1C.
// `schema` and `middleware-session` are deep imports.

export {
  type AuthStatus,
  type Ctx,
  nowSecs,
  publicUser,
  requireAdmin,
  requireAuth,
  type User,
} from "./types.ts";

export { hashPassword, verifyPassword } from "./passwords.ts";
export { validatePassword, validateUsername } from "./validators.ts";
export {
  _resetForTests,
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
} from "./rate-limit.ts";

export {
  doAuthStatus,
  doChangePassword,
  doChangeUserRole,
  doCreateUser,
  doCurrentUser,
  doDeleteUser,
  doListUsers,
  doLogin,
  doLogout,
  doResetUserPassword,
  doSetupFirstAdmin,
} from "./operations.ts";

export {
  type NewUser,
  type Session,
  sessions,
  type UserRow,
  users,
} from "./schema.ts";
