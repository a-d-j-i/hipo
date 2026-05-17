//! Generic Tauri shell for local-first apps.
//!
//! Spawns a sidecar backend (release builds), reads `<prefix>_READY
//! hostname=… port=…` from its stdout, opens a webview at the announced
//! port with an auth token in the URL hash, runs the auto-updater.
//! Debug builds skip the sidecar and open the consumer's Vite dev server
//! at a configured URL instead.
//!
//! Extracted from hipo's apps/desktop in Phase 1D — same behaviour,
//! parameterised on `ShellConfig` so other apps can reuse.
//!
//! ## Usage
//!
//! ```rust,ignore
//! // apps/<app>/src/lib.rs
//! pub fn run() {
//!     tauri_shell::build_app(tauri_shell::ShellConfig::from_prefix(
//!         "myapp", "MYAPP", "myapp-backend", "http://localhost:1420",
//!     ))
//!     .run(tauri::generate_context!())
//!     .expect("tauri runtime error");
//! }
//! ```
//!
//! `tauri::generate_context!()` is invoked in the consumer crate so it
//! reads the consumer's `tauri.conf.json` (icons, app id, window
//! settings). The library only owns the runtime behaviour.

// Sidecar-related imports + helpers are only used on release builds;
// dev builds skip the sidecar entirely and open the dev URL directly.
#[cfg(not(debug_assertions))]
use rand::RngCore;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
use tauri::{Builder, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

// Re-exports so consumers don't have to add `tauri` themselves and stay
// version-aligned with this crate.
pub use tauri;
pub use tauri_plugin_updater;

/// Configuration parameters for the generic shell.
#[derive(Clone)]
pub struct ShellConfig {
    /// Window title.
    pub app_name: String,
    /// Sidecar binary basename (matched by Tauri shell plugin against
    /// `apps/<app>/binaries/<sidecar_name>-<target>` plus its variants).
    pub sidecar_name: String,
    /// Env var the sidecar reads to learn which port to bind (0 = any).
    pub port_env: String,
    /// Env var the shell injects with a random per-launch token; the
    /// sidecar gates `/api/*` on it via the `X-<App>-Token` header.
    pub auth_token_env: String,
    /// Env var the shell injects with the app data directory path.
    pub data_dir_env: String,
    /// Stdout line prefix the sidecar emits when listening, with
    /// `hostname=… port=…` tokens following.
    pub ready_prefix: String,
    /// URL the webview opens in debug builds (your Vite dev server).
    pub dev_url: String,
    /// Initial window inner size (width, height) in logical px.
    pub window_size: (f64, f64),
}

impl ShellConfig {
    /// Convenience: derive port/auth-token/data-dir env vars and the
    /// ready-line prefix from a single uppercase prefix.
    ///
    /// `from_prefix("hipo", "HIPO", "hipo-backend", "http://localhost:1420")`
    /// → port_env="HIPO_PORT", auth_token_env="HIPO_AUTH_TOKEN",
    /// data_dir_env="HIPO_DATA_DIR", ready_prefix="HIPO_READY".
    pub fn from_prefix(
        app_name: impl Into<String>,
        prefix: &str,
        sidecar_name: impl Into<String>,
        dev_url: impl Into<String>,
    ) -> Self {
        Self {
            app_name: app_name.into(),
            sidecar_name: sidecar_name.into(),
            port_env: format!("{prefix}_PORT"),
            auth_token_env: format!("{prefix}_AUTH_TOKEN"),
            data_dir_env: format!("{prefix}_DATA_DIR"),
            ready_prefix: format!("{prefix}_READY"),
            dev_url: dev_url.into(),
            window_size: (800.0, 600.0),
        }
    }
}

/// Held in Tauri managed state so the sidecar process survives for the
/// app lifetime and is dropped on shutdown.
#[cfg(not(debug_assertions))]
struct Sidecar(#[allow(dead_code)] Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Parses `<prefix> hostname=127.0.0.1 port=NNNN` and returns the port.
#[cfg(not(debug_assertions))]
fn parse_ready(line: &str, prefix: &str) -> Option<u16> {
    let s = line.trim();
    if !s.starts_with(prefix) {
        return None;
    }
    s.split_whitespace()
        .find_map(|tok| tok.strip_prefix("port=").and_then(|p| p.parse().ok()))
}

fn build_main_window<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    title: &str,
    size: (f64, f64),
    url: WebviewUrl,
) -> tauri::Result<()> {
    WebviewWindowBuilder::new(handle, "main", url)
        .title(title)
        .inner_size(size.0, size.1)
        .build()?;
    Ok(())
}

/// Builds a Tauri `Builder` with the shell's plugins, sidecar logic,
/// and updater registered. The consumer calls
/// `.run(tauri::generate_context!())` on the result.
pub fn build_app(config: ShellConfig) -> Builder<Wry> {
    #[allow(unused_mut)]
    let mut builder = Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));

    // Updater is release-only: dev builds skip it so signing keys are
    // only required when shipping. The release pipeline writes the
    // public key into `tauri.conf.json` (`plugins.updater.pubkey`).
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder.setup(move |app| {
        #[cfg(debug_assertions)]
        {
            // Dev mode: assume the user is running the backend separately
            // (`deno task dev` or equivalent) and Vite proxies /api/* to
            // it. Skip the sidecar entirely so hot-reload works.
            build_main_window(
                &app.handle().clone(),
                &config.app_name,
                config.window_size,
                WebviewUrl::External(config.dev_url.parse()?),
            )?;
            return Ok(());
        }

        #[cfg(not(debug_assertions))]
        {
            let token = random_token();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let sidecar = app
                .shell()
                .sidecar(&config.sidecar_name)?
                .env(&config.port_env, "0")
                .env(&config.auth_token_env, &token)
                .env(&config.data_dir_env, data_dir.to_string_lossy().to_string());
            let (mut rx, child) = sidecar.spawn()?;

            app.manage(Sidecar(Mutex::new(Some(child))));

            let handle = app.handle().clone();
            let ready_prefix = config.ready_prefix.clone();
            let app_name = config.app_name.clone();
            let window_size = config.window_size;
            tauri::async_runtime::spawn(async move {
                let mut opened = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let s = String::from_utf8_lossy(&line);
                            eprintln!("[backend] {}", s.trim_end());
                            if !opened {
                                if let Some(port) = parse_ready(&s, &ready_prefix) {
                                    let url = format!(
                                        "http://127.0.0.1:{port}/#token={token}"
                                    );
                                    if let Ok(parsed) = url.parse() {
                                        if let Err(e) = build_main_window(
                                            &handle,
                                            &app_name,
                                            window_size,
                                            WebviewUrl::External(parsed),
                                        ) {
                                            eprintln!(
                                                "[shell] could not open main window: {e}"
                                            );
                                        } else {
                                            opened = true;
                                        }
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!(
                                "[backend!] {}",
                                String::from_utf8_lossy(&line).trim_end()
                            );
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[shell] backend exited: {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        }
    })
}
