use crate::audit::write_audit;
use crate::auth::AppState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LenderPayout {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub lender_id: i64,
    pub lender_name: String,
    pub currency_code: String,
    #[ts(type = "number")]
    pub amount_cents: i64,
    #[ts(type = "number")]
    pub paid_at: i64,
    pub notes: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub created_by: Option<i64>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LenderBalance {
    #[ts(type = "number")]
    pub lender_id: i64,
    pub lender_name: String,
    pub currency_code: String,
    #[ts(type = "number")]
    pub received_cents: i64,
    #[ts(type = "number")]
    pub paid_out_cents: i64,
    #[ts(type = "number")]
    pub outstanding_cents: i64,
}

// ---------- Helpers ----------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn normalize_opt(s: Option<String>) -> Option<String> {
    s.and_then(|v| {
        let t = v.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

fn validate_currency_code(code: &str) -> Result<(), String> {
    if code.len() != 3 || !code.chars().all(|c| c.is_ascii_uppercase()) {
        return Err("currency_code must be 3 uppercase letters (ISO 4217)".to_string());
    }
    Ok(())
}

fn fetch_payout(conn: &Connection, id: i64) -> Result<LenderPayout, String> {
    conn.query_row(
        "SELECT lp.id, lp.lender_id, p.name AS lender_name, lp.currency_code,
                lp.amount_cents, lp.paid_at, lp.notes, lp.created_at, lp.created_by
         FROM lender_payouts lp
         JOIN parties p ON p.id = lp.lender_id
         WHERE lp.id = ?1 AND lp.deleted_at IS NULL",
        params![id],
        |row| {
            Ok(LenderPayout {
                id: row.get("id")?,
                lender_id: row.get("lender_id")?,
                lender_name: row.get("lender_name")?,
                currency_code: row.get("currency_code")?,
                amount_cents: row.get("amount_cents")?,
                paid_at: row.get("paid_at")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                created_by: row.get("created_by")?,
            })
        },
    )
    .map_err(|_| "payout not found".to_string())
}

// ---------- Core operations ----------

pub fn do_list_payouts(state: &AppState) -> Result<Vec<LenderPayout>, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT lp.id, lp.lender_id, p.name AS lender_name, lp.currency_code,
                    lp.amount_cents, lp.paid_at, lp.notes, lp.created_at, lp.created_by
             FROM lender_payouts lp
             JOIN parties p ON p.id = lp.lender_id
             WHERE lp.deleted_at IS NULL
             ORDER BY lp.paid_at DESC, lp.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LenderPayout {
                id: row.get("id")?,
                lender_id: row.get("lender_id")?,
                lender_name: row.get("lender_name")?,
                currency_code: row.get("currency_code")?,
                amount_cents: row.get("amount_cents")?,
                paid_at: row.get("paid_at")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
                created_by: row.get("created_by")?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn do_create_lender_payout(
    state: &AppState,
    lender_id: i64,
    currency_code: String,
    amount_cents: i64,
    paid_at: i64,
    notes: Option<String>,
) -> Result<LenderPayout, String> {
    let me = state.require_auth()?;
    let currency_code = currency_code.trim().to_uppercase();
    validate_currency_code(&currency_code)?;
    if amount_cents <= 0 {
        return Err("amount must be > 0".to_string());
    }
    let notes = normalize_opt(notes);
    let now = now_secs();

    let mut conn = state.conn.lock().unwrap();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM parties WHERE id = ?1 AND deleted_at IS NULL",
            params![lender_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err(format!("party {lender_id} not found"));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO lender_payouts
            (lender_id, currency_code, amount_cents, paid_at, notes, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            lender_id,
            &currency_code,
            amount_cents,
            paid_at,
            &notes,
            now,
            me.id
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    let payout = fetch_payout(&tx, id)?;
    write_audit(
        &tx,
        me.id,
        "payout.create",
        "payout",
        Some(id),
        &json!({ "after": &payout }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(payout)
}

pub fn do_delete_lender_payout(state: &AppState, id: i64) -> Result<(), String> {
    let me = state.require_admin()?;
    let mut conn = state.conn.lock().unwrap();
    let before = fetch_payout(&conn, id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE lender_payouts SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "payout.delete",
        "payout",
        Some(id),
        &json!({ "before": &before }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn do_lender_balances(state: &AppState) -> Result<Vec<LenderBalance>, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT p.id AS lender_id, p.name AS lender_name, t.currency_code,
                    SUM(t.received) AS received_cents,
                    SUM(t.paid_out) AS paid_out_cents
             FROM (
                 SELECT s.lender_id, l.currency_code,
                        s.amount_cents AS received, 0 AS paid_out
                 FROM debtor_payment_splits s
                 JOIN debtor_payments dp ON dp.id = s.payment_id
                 JOIN loans l ON l.id = dp.loan_id
                 WHERE dp.deleted_at IS NULL AND l.deleted_at IS NULL
                 UNION ALL
                 SELECT lender_id, currency_code,
                        0 AS received, amount_cents AS paid_out
                 FROM lender_payouts
                 WHERE deleted_at IS NULL
             ) t
             JOIN parties p ON p.id = t.lender_id
             GROUP BY p.id, t.currency_code
             ORDER BY p.name, t.currency_code",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let received: i64 = row.get("received_cents")?;
            let paid: i64 = row.get("paid_out_cents")?;
            Ok(LenderBalance {
                lender_id: row.get("lender_id")?,
                lender_name: row.get("lender_name")?,
                currency_code: row.get("currency_code")?,
                received_cents: received,
                paid_out_cents: paid,
                outstanding_cents: received - paid,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ---------- Tauri command wrappers ----------

#[tauri::command]
pub fn list_payouts(state: State<'_, AppState>) -> Result<Vec<LenderPayout>, String> {
    do_list_payouts(&state)
}

#[tauri::command]
pub fn create_lender_payout(
    state: State<'_, AppState>,
    lender_id: i64,
    currency_code: String,
    amount_cents: i64,
    paid_at: i64,
    notes: Option<String>,
) -> Result<LenderPayout, String> {
    do_create_lender_payout(&state, lender_id, currency_code, amount_cents, paid_at, notes)
}

#[tauri::command]
pub fn delete_lender_payout(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    do_delete_lender_payout(&state, id)
}

#[tauri::command]
pub fn lender_balances(state: State<'_, AppState>) -> Result<Vec<LenderBalance>, String> {
    do_lender_balances(&state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{do_create_user, do_login, do_logout, do_setup_first_admin, Role};
    use crate::db;
    use crate::loans::{do_create_loan, LoanLenderInput};
    use crate::parties::do_create_party;
    use crate::payments::do_create_debtor_payment;
    use rusqlite::Connection;

    fn state() -> AppState {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        AppState::new(conn)
    }

    struct Fx {
        debtor: i64,
        alice: i64,
        bob: i64,
    }

    fn parties(s: &AppState) -> Fx {
        do_setup_first_admin(s, "root", "password123").unwrap();
        let d = do_create_party(s, "Juan".into(), None, None).unwrap();
        let a = do_create_party(s, "Alice".into(), None, None).unwrap();
        let b = do_create_party(s, "Bob".into(), None, None).unwrap();
        Fx {
            debtor: d.id,
            alice: a.id,
            bob: b.id,
        }
    }

    fn loan_with_split(
        s: &AppState,
        fx: &Fx,
        currency: &str,
        a_share: i64,
        b_share: i64,
    ) -> i64 {
        do_create_loan(
            s,
            None,
            fx.debtor,
            currency.into(),
            0,
            1700000000,
            None,
            vec![
                LoanLenderInput {
                    lender_id: fx.alice,
                    amount_lent_cents: a_share,
                },
                LoanLenderInput {
                    lender_id: fx.bob,
                    amount_lent_cents: b_share,
                },
            ],
        )
        .unwrap()
        .id
    }

    #[test]
    fn create_payout_happy_path() {
        let s = state();
        let fx = parties(&s);
        let p = do_create_lender_payout(
            &s,
            fx.alice,
            "USD".into(),
            5000,
            1700000200,
            Some("first payout".into()),
        )
        .unwrap();
        assert_eq!(p.amount_cents, 5000);
        assert_eq!(p.currency_code, "USD");
        assert_eq!(p.lender_name, "Alice");
    }

    #[test]
    fn create_payout_validates_party_exists() {
        let s = state();
        parties(&s);
        let err = do_create_lender_payout(&s, 99_999, "USD".into(), 100, 1, None).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn create_payout_validates_currency_and_amount() {
        let s = state();
        let fx = parties(&s);
        assert!(do_create_lender_payout(&s, fx.alice, "us".into(), 100, 1, None)
            .unwrap_err()
            .contains("currency_code"));
        assert!(do_create_lender_payout(&s, fx.alice, "USD".into(), 0, 1, None)
            .unwrap_err()
            .contains("> 0"));
    }

    #[test]
    fn delete_payout_admin_only() {
        let s = state();
        let fx = parties(&s);
        let p = do_create_lender_payout(&s, fx.alice, "USD".into(), 100, 1, None).unwrap();
        do_create_user(&s, "carol", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "carol", "password123").unwrap();
        assert_eq!(
            do_delete_lender_payout(&s, p.id).unwrap_err(),
            "forbidden".to_string()
        );
        do_logout(&s);
        do_login(&s, "root", "password123").unwrap();
        do_delete_lender_payout(&s, p.id).unwrap();
    }

    #[test]
    fn balances_simple_case() {
        let s = state();
        let fx = parties(&s);
        let loan_id = loan_with_split(&s, &fx, "USD", 60_000, 40_000);
        do_create_debtor_payment(&s, loan_id, 10_000, 1700000100, None).unwrap();
        // Alice gets 60% = 6000, Bob 40% = 4000
        let bals = do_lender_balances(&s).unwrap();
        let alice = bals.iter().find(|b| b.lender_name == "Alice").unwrap();
        let bob = bals.iter().find(|b| b.lender_name == "Bob").unwrap();
        assert_eq!(alice.received_cents, 6000);
        assert_eq!(alice.paid_out_cents, 0);
        assert_eq!(alice.outstanding_cents, 6000);
        assert_eq!(bob.outstanding_cents, 4000);
    }

    #[test]
    fn balances_after_payout() {
        let s = state();
        let fx = parties(&s);
        let loan_id = loan_with_split(&s, &fx, "USD", 60_000, 40_000);
        do_create_debtor_payment(&s, loan_id, 10_000, 1700000100, None).unwrap();
        do_create_lender_payout(&s, fx.alice, "USD".into(), 5000, 1700000200, None).unwrap();
        let bals = do_lender_balances(&s).unwrap();
        let alice = bals.iter().find(|b| b.lender_name == "Alice").unwrap();
        assert_eq!(alice.received_cents, 6000);
        assert_eq!(alice.paid_out_cents, 5000);
        assert_eq!(alice.outstanding_cents, 1000);
    }

    #[test]
    fn balances_overdraft_is_negative() {
        let s = state();
        let fx = parties(&s);
        let loan_id = loan_with_split(&s, &fx, "USD", 60_000, 40_000);
        do_create_debtor_payment(&s, loan_id, 1_000, 1700000100, None).unwrap();
        // Pay Alice more than she's owed (overpayment).
        do_create_lender_payout(&s, fx.alice, "USD".into(), 5000, 1700000200, None).unwrap();
        let bals = do_lender_balances(&s).unwrap();
        let alice = bals.iter().find(|b| b.lender_name == "Alice").unwrap();
        // 60% of 1000 = 600 received, 5000 paid → -4400 outstanding
        assert_eq!(alice.received_cents, 600);
        assert_eq!(alice.paid_out_cents, 5000);
        assert_eq!(alice.outstanding_cents, -4400);
    }

    #[test]
    fn balances_split_across_currencies() {
        let s = state();
        let fx = parties(&s);
        let usd_loan = loan_with_split(&s, &fx, "USD", 60_000, 40_000);
        let ars_loan = loan_with_split(&s, &fx, "ARS", 80_000, 20_000);
        do_create_debtor_payment(&s, usd_loan, 10_000, 1700000100, None).unwrap();
        do_create_debtor_payment(&s, ars_loan, 10_000, 1700000100, None).unwrap();
        let bals = do_lender_balances(&s).unwrap();
        let alice_usd = bals
            .iter()
            .find(|b| b.lender_name == "Alice" && b.currency_code == "USD")
            .unwrap();
        let alice_ars = bals
            .iter()
            .find(|b| b.lender_name == "Alice" && b.currency_code == "ARS")
            .unwrap();
        assert_eq!(alice_usd.outstanding_cents, 6000); // 60% of $100
        assert_eq!(alice_ars.outstanding_cents, 8000); // 80% of 100 ARS
    }

    #[test]
    fn balances_payout_only_lender_appears() {
        // A lender with payouts but no payments still shows up (negative outstanding).
        let s = state();
        let fx = parties(&s);
        do_create_lender_payout(&s, fx.alice, "USD".into(), 5000, 1700000200, None).unwrap();
        let bals = do_lender_balances(&s).unwrap();
        let alice = bals.iter().find(|b| b.lender_name == "Alice").unwrap();
        assert_eq!(alice.received_cents, 0);
        assert_eq!(alice.paid_out_cents, 5000);
        assert_eq!(alice.outstanding_cents, -5000);
    }

    #[test]
    fn audit_log_records_payout_mutations() {
        let s = state();
        let fx = parties(&s);
        let p = do_create_lender_payout(&s, fx.alice, "USD".into(), 100, 1, None).unwrap();
        do_delete_lender_payout(&s, p.id).unwrap();
        let conn = s.conn.lock().unwrap();
        let actions: Vec<String> = conn
            .prepare("SELECT action FROM audit_log WHERE entity_type='payout' ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions, vec!["payout.create", "payout.delete"]);
    }
}
