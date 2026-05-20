# tauri-shell

Framework crate: a generic Tauri shell for local-first apps. Opens the webview
at the consumer's bundled frontend, focuses the existing window on a second
launch (single-instance), and runs the auto-updater on release builds.

The shell does **not** spawn a backend process. Local-first apps host their
`/api/*` router in-page via Service Worker + dedicated Worker (see
`packages/server`, `packages/sw`, `packages/sqlite`), so the Rust layer only has
to bring the webview up.

## Usage

```rust
// apps/<app>/src/lib.rs
pub fn run() {
    tauri_shell::build_app(tauri_shell::ShellConfig::new("myapp"))
        .run(tauri::generate_context!())
        .expect("tauri runtime error");
}
```

For a non-default window size:

```rust
tauri_shell::build_app(tauri_shell::ShellConfig {
    app_name: "myapp".into(),
    window_size: (1024.0, 720.0),
})
```

`tauri::generate_context!()` stays in the consumer crate so it reads the
consumer's `tauri.conf.json` (icons, identifier, frontend dist, updater pubkey,
CSP). This crate only owns the runtime behaviour.

## What the consumer's frontend must do

- Register a service worker that injects COOP/COEP on navigation responses
  (required for OPFS sync-access-handle mode).
- Spawn a dedicated Worker that owns the SQLite-WASM database and the
  `app.fetch`-style router.
- Route `/api/*` from the page through the SW to the Worker via
  `MessageChannel`.

`@hipo/frontend` is the reference consumer; `packages/sw` will be extracted once
a second consumer materialises.

## History

Pre-Phase-8 versions of this crate spawned a Deno sidecar, parsed
`<PREFIX>_READY hostname=… port=…` from its stdout, and opened the webview at
`http://127.0.0.1:<port>/#token=<random>`. Phase 8 of the framework plan moved
the backend into the page; see `docs/local-first-framework.md` §530 for context.
