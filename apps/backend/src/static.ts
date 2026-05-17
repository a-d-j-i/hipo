import { join, resolve, sep } from "node:path";
import { json, type Handler } from "@hipo/server";
import type { AppState } from "./middleware/session.ts";
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

/**
 * SPA fallback handler — registered via `router.notFound`. For any
 * unmatched non-`/api/*` request, serves the matching static file or
 * falls back to `index.html`.
 */
export const staticSpa: Handler<AppState> = async (c) => {
  if (c.url.pathname.startsWith("/api/")) {
    return json({ error: "not found" }, { status: 404 });
  }

  const baseDir = resolve(config.staticDir);
  const requested = c.url.pathname === "/" ? "/index.html" : c.url.pathname;
  const candidate = resolve(join(baseDir, "." + requested));
  const insideBase =
    candidate === baseDir || candidate.startsWith(baseDir + sep);

  let body: Uint8Array | null = null;
  let path = candidate;
  if (insideBase) body = await readIfExists(candidate);
  if (!body) {
    path = resolve(baseDir, "index.html");
    body = await readIfExists(path);
  }
  if (!body)
    return new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": contentType(path) },
  });
};
