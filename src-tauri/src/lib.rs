pub mod audit;
pub mod auth;
pub mod db;
pub mod loans;
pub mod parties;
pub mod payments;
pub mod payouts;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data dir: {e}"))?;
            std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
            let db_path = dir.join("hipo.db");
            let conn = db::open_and_migrate(&db_path)?;
            app.manage(auth::AppState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::setup_first_admin,
            auth::login,
            auth::logout,
            auth::current_user,
            auth::change_password,
            auth::list_users,
            auth::create_user,
            auth::delete_user,
            auth::reset_user_password,
            auth::change_user_role,
            parties::list_parties,
            parties::get_party,
            parties::create_party,
            parties::update_party,
            parties::delete_party,
            loans::list_loans,
            loans::get_loan,
            loans::create_loan,
            loans::update_loan,
            loans::set_loan_lenders,
            loans::delete_loan,
            payments::list_loan_payments,
            payments::create_debtor_payment,
            payments::delete_debtor_payment,
            payouts::list_payouts,
            payouts::create_lender_payout,
            payouts::delete_lender_payout,
            payouts::lender_balances,
            audit::list_audit_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
