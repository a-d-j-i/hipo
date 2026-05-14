//! Thin Tauri shell: spawns the Deno backend as a sidecar in production
//! builds, navigates the webview at it once it announces itself via
//! `HIPO_READY hostname=… port=…` on stdout. Dev builds skip the sidecar
//! and just open the Vite dev server (user runs `cd backend && deno task dev`
//! separately).

use rand::RngCore;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the sidecar process so it stays alive for the app lifetime and is
/// terminated when the managed state is dropped.
struct Sidecar(#[allow(dead_code)] Mutex<Option<CommandChild>>);

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Parses a `HIPO_READY hostname=127.0.0.1 port=NNNN` line, returning the port.
fn parse_ready(line: &str) -> Option<u16> {
    let s = line.trim();
    if !s.starts_with("HIPO_READY") {
        return None;
    }
    s.split_whitespace()
        .find_map(|tok| tok.strip_prefix("port=").and_then(|p| p.parse().ok()))
}

fn build_main_window<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    url: WebviewUrl,
) -> tauri::Result<()> {
    WebviewWindowBuilder::new(handle, "main", url)
        .title("hipo")
        .inner_size(800.0, 600.0)
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));

    // Updater is release-only: dev builds skip it so a real signing key is
    // only required when shipping. The release pipeline replaces the pubkey
    // placeholder in tauri.conf.json with the public half of the signing key.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            // Dev mode: assume the user is running `deno task dev` separately
            // and `yarn dev` provides the Vite proxy. Skip the sidecar entirely
            // so hot-reload on both sides keeps working.
            #[cfg(debug_assertions)]
            {
                build_main_window(
                    &app.handle().clone(),
                    WebviewUrl::External("http://localhost:1420".parse()?),
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
                    .sidecar("hipo-backend")?
                    .env("HIPO_PORT", "0")
                    .env("HIPO_AUTH_TOKEN", &token)
                    .env("HIPO_DATA_DIR", data_dir.to_string_lossy().to_string());
                let (mut rx, child) = sidecar.spawn()?;

                app.manage(Sidecar(Mutex::new(Some(child))));

                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut opened = false;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let s = String::from_utf8_lossy(&line);
                                eprintln!("[backend] {}", s.trim_end());
                                if !opened {
                                    if let Some(port) = parse_ready(&s) {
                                        let url = format!(
                                            "http://127.0.0.1:{port}/#token={token}"
                                        );
                                        if let Ok(parsed) = url.parse() {
                                            if let Err(e) = build_main_window(
                                                &handle,
                                                WebviewUrl::External(parsed),
                                            ) {
                                                eprintln!(
                                                    "[hipo] could not open main window: {e}"
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
                                eprintln!("[hipo] backend exited: {:?}", payload);
                            }
                            _ => {}
                        }
                    }
                });

                Ok(())
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
