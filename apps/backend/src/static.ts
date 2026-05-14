import { join, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./middleware/session.ts";
import { config } from "./config.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** Serves staticDir as static files; falls back to index.html for SPA routes. */
export const staticSpa: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();

  // Resolve once; reject anything that escapes the static root after
  // path normalization (handles `..`, redundant separators, etc.).
  const baseDir = resolve(config.staticDir);
  const requested = c.req.path === "/" ? "/index.html" : c.req.path;
  const candidate = resolve(join(baseDir, "." + requested));
  const insideBase =
    candidate === baseDir || candidate.startsWith(baseDir + sep);

  let body: Uint8Array | null = null;
  let path = candidate;
  if (insideBase) body = await readIfExists(candidate);
  if (!body) {
    // SPA fallback — always index.html, always inside baseDir.
    path = resolve(baseDir, "index.html");
    body = await readIfExists(path);
  }
  if (!body) return c.text("not found", 404);

  // TS 5.7 narrowed BodyInit's Uint8Array to <ArrayBuffer> but Deno.readFile
  // returns <ArrayBufferLike>. Runtime is identical; cast through unknown.
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": contentType(path) },
  });
};
