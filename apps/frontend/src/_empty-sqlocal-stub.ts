// Stub aliased over `sqlocal` / `sqlocal/drizzle` /
// `@sqlite.org/sqlite-wasm` when building the Tauri target — see the
// `resolve.alias` block in `vite.config.ts`. Lets the bundler skip
// sqlocal's transitive worker / WASM chunks entirely (~600 KB gz)
// in builds that route SQLite through Tauri IPC instead.
//
// All exports throw if invoked. Reaching them at runtime would mean
// the Tauri-shape build accidentally followed a browser-only code
// path; the runtime `detectShape()` check in `main.tsx` should make
// that impossible, but the stub turns "should be impossible" into a
// loud, actionable error.

const throwStub = (): never => {
  throw new Error(
    "sqlocal is not available in this build (VITE_TARGET=tauri). " +
      "Code path that reached this is browser-shape only.",
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub: any = new Proxy(throwStub, {
  get: () => stub,
  apply: () => throwStub(),
  construct: () => throwStub(),
});

export const SQLocal = stub;
export const SQLocalDrizzle = stub;
export default stub;
