// Re-export of @hipo/server's error primitives so existing
// apps/backend imports (`../errors.ts`) keep working unchanged.
// The canonical home is @hipo/server.
export {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
} from "@hipo/server";
