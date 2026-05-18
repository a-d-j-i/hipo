//! Generic Tauri shell for local-first apps.
//!
//! The webview loads the consumer's bundled frontend (`frontendDist`
//! in `tauri.conf.json`) via Tauri's default custom protocol — no
//! sidecar process, no per-launch auth token, no port handshake. The
//! frontend hosts its own backend in-page (Service Worker + Worker +
//! OPFS-backed SQLite) so every `/api/*` fetch is handled locally.
//!
//! What the shell owns:
//!
//! - Window bring-up (title, initial size).
//! - `tauri-plugin-single-instance` so a second launch focuses the
//!   existing window instead of starting another process.
//! - `tauri-plugin-updater` (release builds only — the signing key is
//!   only required when shipping).
//!
//! Pre-Phase-8 versions of this crate spawned a Deno sidecar, parsed
//! `<PREFIX>_READY hostname=… port=…` from its stdout, and opened the
//! webview at `http://127.0.0.1:<port>/#token=…`. All of that has
//! moved into the page via `packages/sw` + `packages/server`'s
//! `worker-bridge`. See `docs/local-first-framework.md` §530.
//!
//! ## Usage
//!
//! ```rust,ignore
//! // apps/<app>/src/lib.rs
//! pub fn run() {
//!     tauri_shell::build_app(tauri_shell::ShellConfig {
//!         app_name: "myapp".into(),
//!         window_size: (1024.0, 720.0),
//!     })
//!     .run(tauri::generate_context!())
//!     .expect("tauri runtime error");
//! }
//! ```
//!
//! `tauri::generate_context!()` is invoked in the consumer crate so it
//! reads the consumer's `tauri.conf.json` (icons, identifier, frontend
//! dist path, updater pubkey). The library only owns runtime behaviour.

use tauri::{Builder, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

// Re-exports so consumers don't have to add `tauri` themselves and stay
// version-aligned with this crate.
pub use tauri;
pub use tauri_plugin_updater;

/// Configuration parameters for the generic shell.
#[derive(Clone)]
pub struct ShellConfig {
    /// Window title.
    pub app_name: String,
    /// Initial window inner size (width, height) in logical px.
    pub window_size: (f64, f64),
}

impl ShellConfig {
    /// Convenience constructor with the default 800×600 window size.
    pub fn new(app_name: impl Into<String>) -> Self {
        Self {
            app_name: app_name.into(),
            window_size: (800.0, 600.0),
        }
    }
}

fn build_main_window<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    title: &str,
    size: (f64, f64),
) -> tauri::Result<()> {
    // `WebviewUrl::default()` opens the bundled `frontendDist` via
    // Tauri's `tauri://localhost/` (Windows) / `http://tauri.localhost/`
    // (Linux/macOS) protocol. In `tauri dev` it follows `build.devUrl`
    // from `tauri.conf.json`. Either way the consumer's frontend boots
    // and registers its own service worker.
    WebviewWindowBuilder::new(handle, "main", WebviewUrl::default())
        .title(title)
        .inner_size(size.0, size.1)
        .build()?;
    Ok(())
}

/// Linux/webkit2gtk only: JavaScriptCore gates `SharedArrayBuffer`
/// behind a runtime feature flag, and webkit2gtk only auto-enables
/// it when COOP/COEP arrive at the network layer of the original
/// navigation response. Service-worker-injected COI is *visible* to
/// JS (`crossOriginIsolated === true`) but doesn't unlock JSC's SAB.
/// Setting this JSC env var before WebKit spawns its WebContent
/// process bypasses that gate, which is required for SQLite-WASM's
/// OPFS sync-access-handle mode (and any other SAB user) to work in
/// the in-page-backend topology. No-op on other platforms.
#[cfg(target_os = "linux")]
fn enable_jsc_shared_array_buffer() {
    // SAFETY: build_app runs at startup before any threads / child
    // processes are spawned; webkit2gtk inherits the env var from us.
    std::env::set_var("JSC_useSharedArrayBuffer", "1");
}

#[cfg(not(target_os = "linux"))]
fn enable_jsc_shared_array_buffer() {}

/// Linux/webkit2gtk only: webkit2gtk-rs 2.0.x doesn't expose the
/// `webkit_settings_set_feature_enabled` API (added in webkit2gtk
/// 2.42+), so we link to libwebkit2gtk-4.1 directly and call the C
/// API via FFI. Force-enables every webkit2gtk feature whose
/// identifier matches a file-system / storage / OPFS needle.
///
/// **Status (2026-05-18):** Linux Tauri is no longer a shipped
/// target — webkit2gtk 2.50.6 (Debian 12) does not implement
/// `FileSystemSyncAccessHandle`, which SQLite-WASM's OPFS pool VFS
/// requires. Linux users get the Pages-hosted in-page-backend build
/// in a real browser (Chromium/Firefox have full OPFS support).
/// This code remains because flipping `StorageAPI`, `FileSystem`
/// etc. still gives main-thread OPFS + `navigator.storage`, which
/// is useful when iterating on the Tauri shell itself in dev on a
/// Linux box. When webkit2gtk eventually adds the sync-access-handle
/// API, this code is the only remaining gate.
#[cfg(target_os = "linux")]
fn enable_webkit_fs_access_features<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) {
    use std::ffi::{c_char, c_void, CStr};

    type GBoolean = i32;
    type GObjectPtr = *mut c_void;

    extern "C" {
        fn webkit_settings_get_all_features() -> *mut c_void;
        fn webkit_feature_list_get_length(list: *mut c_void) -> u32;
        fn webkit_feature_list_get(list: *mut c_void, idx: u32) -> *mut c_void;
        fn webkit_feature_list_unref(list: *mut c_void);
        fn webkit_feature_get_identifier(feature: *mut c_void) -> *const c_char;
        fn webkit_settings_set_feature_enabled(
            settings: GObjectPtr,
            feature: *mut c_void,
            enabled: GBoolean,
        );
    }

    // Substrings (case-insensitive) of feature identifiers to enable.
    // Cast a wide net — we'd rather over-enable here than miss the
    // one that gates `navigator.storage` exposure in Workers.
    const NEEDLES: &[&str] = &[
        "filesystem",
        "file_system",
        "file-system",
        "opfs",
        "originprivate",
        "origin_private",
        "origin-private",
        "storageapi",
        "storage_api",
        "storage-api",
        "syncaccesshandle",
        "sync_access",
        "sync-access",
        "syncaccess",
        "directoryhandle",
        "directory_handle",
        "writable",
        "fileaccess",
        "file_access",
        "private_file",
        "private-file",
        "originpfs",
    ];

    let _ = window.with_webview(|webview| {
        use glib::translate::ToGlibPtr;
        use webkit2gtk::WebViewExt;

        let wv = webview.inner();
        let settings = match wv.settings() {
            Some(s) => s,
            None => return,
        };
        let settings_ptr: GObjectPtr =
            ToGlibPtr::<*mut webkit2gtk::ffi::WebKitSettings>::to_glib_none(&settings).0
                as *mut c_void;

        unsafe {
            let list = webkit_settings_get_all_features();
            if list.is_null() {
                // webkit2gtk < 2.42 — no Feature API. Silent no-op
                // (older webkit2gtk just won't have the toggles).
                return;
            }
            let len = webkit_feature_list_get_length(list);
            for i in 0..len {
                let feat = webkit_feature_list_get(list, i);
                if feat.is_null() {
                    continue;
                }
                let ident_ptr = webkit_feature_get_identifier(feat);
                if ident_ptr.is_null() {
                    continue;
                }
                let ident = CStr::from_ptr(ident_ptr).to_string_lossy();
                let lower = ident.to_lowercase();
                if NEEDLES.iter().any(|n| lower.contains(n)) {
                    webkit_settings_set_feature_enabled(settings_ptr, feat, 1);
                }
            }
            webkit_feature_list_unref(list);
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn enable_webkit_fs_access_features<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) {
}

/// Builds a Tauri `Builder` with the shell's plugins + window setup
/// registered. The consumer calls `.run(tauri::generate_context!())`
/// on the result.
pub fn build_app(config: ShellConfig) -> Builder<Wry> {
    enable_jsc_shared_array_buffer();

    #[allow(unused_mut)]
    let mut builder = Builder::default().plugin(
        tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }),
    );

    // Updater is release-only: dev builds skip it so signing keys are
    // only required when shipping. The release pipeline writes the
    // public key into `tauri.conf.json` (`plugins.updater.pubkey`).
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder.setup(move |app| {
        let handle = app.handle().clone();
        build_main_window(&handle, &config.app_name, config.window_size)?;
        if let Some(window) = handle.get_webview_window("main") {
            enable_webkit_fs_access_features(&window);
        }
        Ok(())
    })
}
