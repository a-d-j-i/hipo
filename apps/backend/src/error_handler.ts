import type { Context } from "hono";
import { AppError } from "./errors.ts";

/** Global error handler: AppError → JSON; everything else → 500. */
export function errorHandler(err: Error, _c: Context): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("[hipo] unhandled error:", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}
