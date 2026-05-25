// Wrapper around /api/system/status. Augments the backend response
// with main-thread-only facts: Tauri detection, PWA install state,
// and a refined browser shape_details block (the backend can only
// see User-Agent inside a Worker; we have richer signals here).

import type { SystemStatus, SystemStatusShape } from "@hipo/server";
import { httpRequest } from "./http";

export type { SystemStatus } from "@hipo/server";

function detectTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

function detectStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function refineShape(serverShape: SystemStatusShape): SystemStatusShape {
  if (detectTauri()) return "tauri";
  if (serverShape === "browser" && detectStandalonePwa()) return "pwa";
  return serverShape;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const raw = await httpRequest<SystemStatus>("GET", "/api/system/status");
  const shape = refineShape(raw.shape);
  return {
    ...raw,
    shape,
    risk_flags: {
      ...raw.risk_flags,
      cleared_by_browser_data_clear: shape === "browser" || shape === "pwa",
    },
  };
}
