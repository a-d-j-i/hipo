// Ambient module stubs for packages that are only used in the Deno/Node
// runtime, not the browser. The Vite shim (swapPasswordsToBrowser in
// vite.config.ts) replaces the passwords.ts import at bundle time; these
// stubs keep TypeScript happy during tsc --noEmit.

declare module "@node-rs/argon2" {
  export function hash(
    password: string | Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<string>;
  export function verify(
    hash: string,
    password: string | Buffer | Uint8Array,
  ): Promise<boolean>;
}
