// Stubs for Node/Deno-only modules and globals that tsc walks via the
// in-page-worker's import graph but Vite's resolveId shim swaps out at
// bundle time. Allows the frontend type-check to succeed without
// installing native binaries we won't use in the browser.

declare module "@node-rs/argon2" {
  export function hash(password: string): Promise<string>;
  export function verify(hash: string, password: string): Promise<boolean>;
}

declare module "@libsql/client" {
  export type Client = unknown;
}

declare module "@libsql/client/node" {
  export type Client = unknown;
  export function createClient(opts: { url: string }): Client;
}

// `Deno` is referenced by config.ts and client-deno.ts — both behind a
// runtime guard. The declaration makes tsc happy.
declare const Deno:
  | { env: { get(name: string): string | undefined } }
  | undefined;
