use hipo_lib::{auth, db};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::WebviewWindow;

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    let mut conn = Connection::open_in_memory().unwrap();
    db::migrate(&mut conn).unwrap();
    let state = auth::AppState::new(conn);

    mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::setup_first_admin,
            auth::login,
            auth::logout,
            auth::current_user,
            auth::list_users,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build mock app")
}

fn invoke<T: DeserializeOwned>(
    webview: &WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<T, String> {
    let req = tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    match get_ipc_response(webview, req) {
        Ok(body) => Ok(body.deserialize().unwrap()),
        Err(e) => Err(e.to_string()),
    }
}

#[test]
fn ipc_setup_then_login_round_trip() {
    let app = build_app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    // 0 users → needs_setup
    let status: auth::AuthStatus =
        invoke(&webview, "auth_status", serde_json::json!({})).unwrap();
    assert!(status.needs_setup);
    assert!(status.current_user.is_none());

    // create the first admin via the actual IPC plumbing
    let admin: auth::User = invoke(
        &webview,
        "setup_first_admin",
        serde_json::json!({ "username": "root", "password": "password123" }),
    )
    .unwrap();
    assert_eq!(admin.username, "root");
    assert_eq!(admin.role, auth::Role::Admin);

    // session is now established
    let status: auth::AuthStatus =
        invoke(&webview, "auth_status", serde_json::json!({})).unwrap();
    assert!(!status.needs_setup);
    assert_eq!(status.current_user.as_ref().map(|u| u.id), Some(admin.id));

    // logout + login again through IPC
    let _: serde_json::Value = invoke(&webview, "logout", serde_json::json!({})).unwrap();
    let again: auth::User = invoke(
        &webview,
        "login",
        serde_json::json!({ "username": "root", "password": "password123" }),
    )
    .unwrap();
    assert_eq!(again.id, admin.id);

    // admin can list users
    let users: Vec<auth::User> =
        invoke(&webview, "list_users", serde_json::json!({})).unwrap();
    assert_eq!(users.len(), 1);
}

#[test]
fn ipc_login_with_wrong_password_returns_error_over_invoke() {
    let app = build_app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let _: auth::User = invoke(
        &webview,
        "setup_first_admin",
        serde_json::json!({ "username": "root", "password": "password123" }),
    )
    .unwrap();
    let _: serde_json::Value = invoke(&webview, "logout", serde_json::json!({})).unwrap();

    let err = invoke::<auth::User>(
        &webview,
        "login",
        serde_json::json!({ "username": "root", "password": "wrong" }),
    )
    .unwrap_err();
    assert!(err.contains("wrong"), "got: {err}");
}
