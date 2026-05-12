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
pub struct DebtorPaymentSplit {
    #[ts(type = "number")]
    pub lender_id: i64,
    pub lender_name: String,
    #[ts(type = "number")]
    pub amount_cents: i64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DebtorPayment {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub loan_id: i64,
    #[ts(type = "number")]
    pub amount_cents: i64,
    #[ts(type = "number")]
    pub paid_at: i64,
    pub notes: Option<String>,
    pub splits: Vec<DebtorPaymentSplit>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub created_by: Option<i64>,
}

// ---------- Split algorithm ----------

/// Distribute `amount_cents` among lenders proportionally to their `amount_lent_cents`,
/// using the largest-remainder method. Returns Vec<(lender_id, share_cents)> aligned
/// with the input order. Sum of shares == `amount_cents` exactly.
///
/// Tiebreak on equal remainders: ascending `lender_id` (deterministic).
pub fn split_payment(amount_cents: i64, shares: &[(i64, i64)]) -> Vec<(i64, i64)> {
    if shares.is_empty() || amount_cents == 0 {
        return shares.iter().map(|(id, _)| (*id, 0)).collect();
    }
    let principal: i128 = shares.iter().map(|(_, a)| *a as i128).sum();
    if principal <= 0 {
        return shares.iter().map(|(id, _)| (*id, 0)).collect();
    }
    // Compute floor share and remainder for each lender.
    let mut rows: Vec<(i64, i64, i128)> = shares
        .iter()
        .map(|(id, amt)| {
            let numerator = (amount_cents as i128) * (*amt as i128);
            let floor_share = (numerator / principal) as i64;
            let remainder = numerator % principal;
            (*id, floor_share, remainder)
        })
        .collect();
    let floor_sum: i64 = rows.iter().map(|(_, f, _)| f).sum();
    let residual = amount_cents - floor_sum;

    // Sort indices by descending remainder, tiebreak by ascending lender_id.
    let mut indices: Vec<usize> = (0..rows.len()).collect();
    indices.sort_by(|&a, &b| rows[b].2.cmp(&rows[a].2).then(rows[a].0.cmp(&rows[b].0)));
    for &i in indices.iter().take(residual.max(0) as usize) {
        rows[i].1 += 1;
    }
    rows.into_iter().map(|(id, share, _)| (id, share)).collect()
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

pub fn loan_has_payments(conn: &Connection, loan_id: i64) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM debtor_payments
             WHERE loan_id = ?1 AND deleted_at IS NULL",
            params![loan_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn fetch_splits(conn: &Connection, payment_id: i64) -> Result<Vec<DebtorPaymentSplit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.lender_id, p.name AS lender_name, s.amount_cents
             FROM debtor_payment_splits s
             JOIN parties p ON p.id = s.lender_id
             WHERE s.payment_id = ?1
             ORDER BY p.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![payment_id], |row| {
            Ok(DebtorPaymentSplit {
                lender_id: row.get("lender_id")?,
                lender_name: row.get("lender_name")?,
                amount_cents: row.get("amount_cents")?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn fetch_payment(conn: &Connection, id: i64) -> Result<DebtorPayment, String> {
    let mut payment = conn
        .query_row(
            "SELECT id, loan_id, amount_cents, paid_at, notes, created_at, created_by
             FROM debtor_payments WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                Ok(DebtorPayment {
                    id: row.get("id")?,
                    loan_id: row.get("loan_id")?,
                    amount_cents: row.get("amount_cents")?,
                    paid_at: row.get("paid_at")?,
                    notes: row.get("notes")?,
                    splits: Vec::new(),
                    created_at: row.get("created_at")?,
                    created_by: row.get("created_by")?,
                })
            },
        )
        .map_err(|_| "payment not found".to_string())?;
    payment.splits = fetch_splits(conn, id)?;
    Ok(payment)
}

fn loan_lender_shares(conn: &Connection, loan_id: i64) -> Result<Vec<(i64, i64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT lender_id, amount_lent_cents FROM loan_lenders
             WHERE loan_id = ?1 ORDER BY lender_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![loan_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ---------- Core operations ----------

pub fn do_list_loan_payments(
    state: &AppState,
    loan_id: i64,
) -> Result<Vec<DebtorPayment>, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, loan_id, amount_cents, paid_at, notes, created_at, created_by
             FROM debtor_payments
             WHERE loan_id = ?1 AND deleted_at IS NULL
             ORDER BY paid_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![loan_id], |row| {
            Ok(DebtorPayment {
                id: row.get("id")?,
                loan_id: row.get("loan_id")?,
                amount_cents: row.get("amount_cents")?,
                paid_at: row.get("paid_at")?,
                notes: row.get("notes")?,
                splits: Vec::new(),
                created_at: row.get("created_at")?,
                created_by: row.get("created_by")?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut payments = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for p in &mut payments {
        p.splits = fetch_splits(&conn, p.id)?;
    }
    Ok(payments)
}

pub fn do_create_debtor_payment(
    state: &AppState,
    loan_id: i64,
    amount_cents: i64,
    paid_at: i64,
    notes: Option<String>,
) -> Result<DebtorPayment, String> {
    let me = state.require_auth()?;
    if amount_cents <= 0 {
        return Err("amount must be > 0".to_string());
    }
    let notes = normalize_opt(notes);
    let now = now_secs();

    let mut conn = state.conn.lock().unwrap();
    let status: String = conn
        .query_row(
            "SELECT status FROM loans WHERE id = ?1 AND deleted_at IS NULL",
            params![loan_id],
            |r| r.get(0),
        )
        .map_err(|_| "loan not found".to_string())?;
    if status != "active" {
        return Err("loan is not active".to_string());
    }
    let shares = loan_lender_shares(&conn, loan_id)?;
    if shares.is_empty() {
        return Err("loan has no lenders".to_string());
    }
    let split = split_payment(amount_cents, &shares);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO debtor_payments (loan_id, amount_cents, paid_at, notes, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![loan_id, amount_cents, paid_at, &notes, now, me.id],
    )
    .map_err(|e| e.to_string())?;
    let payment_id = tx.last_insert_rowid();
    for (lender_id, cents) in &split {
        if *cents > 0 {
            tx.execute(
                "INSERT INTO debtor_payment_splits (payment_id, lender_id, amount_cents)
                 VALUES (?1, ?2, ?3)",
                params![payment_id, lender_id, cents],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let payment = fetch_payment(&tx, payment_id)?;
    write_audit(
        &tx,
        me.id,
        "payment.create",
        "payment",
        Some(payment_id),
        &json!({ "after": &payment }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(payment)
}

pub fn do_delete_debtor_payment(state: &AppState, id: i64) -> Result<(), String> {
    let me = state.require_admin()?;
    let mut conn = state.conn.lock().unwrap();
    let before = fetch_payment(&conn, id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE debtor_payments SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "payment.delete",
        "payment",
        Some(id),
        &json!({ "before": &before }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Tauri command wrappers ----------

#[tauri::command]
pub fn list_loan_payments(
    state: State<'_, AppState>,
    loan_id: i64,
) -> Result<Vec<DebtorPayment>, String> {
    do_list_loan_payments(&state, loan_id)
}

#[tauri::command]
pub fn create_debtor_payment(
    state: State<'_, AppState>,
    loan_id: i64,
    amount_cents: i64,
    paid_at: i64,
    notes: Option<String>,
) -> Result<DebtorPayment, String> {
    do_create_debtor_payment(&state, loan_id, amount_cents, paid_at, notes)
}

#[tauri::command]
pub fn delete_debtor_payment(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    do_delete_debtor_payment(&state, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{do_create_user, do_login, do_logout, do_setup_first_admin, Role};
    use crate::db;
    use crate::loans::{do_create_loan, LoanLenderInput};
    use crate::parties::do_create_party;
    use rusqlite::Connection;

    fn state() -> AppState {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        AppState::new(conn)
    }

    fn sum(v: &[(i64, i64)]) -> i64 {
        v.iter().map(|(_, c)| c).sum()
    }

    #[test]
    fn split_empty_or_zero() {
        assert!(split_payment(100, &[]).is_empty());
        let r = split_payment(0, &[(1, 50), (2, 50)]);
        assert_eq!(r, vec![(1, 0), (2, 0)]);
    }

    #[test]
    fn split_single_lender() {
        let r = split_payment(123, &[(1, 100)]);
        assert_eq!(r, vec![(1, 123)]);
    }

    #[test]
    fn split_exact_division() {
        let r = split_payment(100, &[(1, 50), (2, 50)]);
        assert_eq!(r, vec![(1, 50), (2, 50)]);
        assert_eq!(sum(&r), 100);
    }

    #[test]
    fn split_classic_thirds() {
        // $100 / 3 = $33.33 + $33.33 + $33.34
        // 10000 cents / 3 equal lenders. Floor = 3333 each, residual = 1.
        // Lender 1 (smallest id) gets the extra cent.
        let r = split_payment(10000, &[(1, 100), (2, 100), (3, 100)]);
        assert_eq!(r, vec![(1, 3334), (2, 3333), (3, 3333)]);
        assert_eq!(sum(&r), 10000);
    }

    #[test]
    fn split_unequal_shares() {
        // payment=10, shares 33/33/34, principal=100
        // floors: 3, 3, 3 (sum=9), remainders: 30, 30, 40. Residual=1 → lender 3 gets +1.
        let r = split_payment(10, &[(1, 33), (2, 33), (3, 34)]);
        assert_eq!(r, vec![(1, 3), (2, 3), (3, 4)]);
        assert_eq!(sum(&r), 10);
    }

    #[test]
    fn split_two_cent_tip() {
        // payment=2, 3 lenders equal, principal=300
        // each: 2*100/300 = 0.66… floor=0 rem=200. residual=2 → lender 1 and 2 (id asc).
        let r = split_payment(2, &[(1, 100), (2, 100), (3, 100)]);
        assert_eq!(r, vec![(1, 1), (2, 1), (3, 0)]);
        assert_eq!(sum(&r), 2);
    }

    #[test]
    fn split_sum_always_reconciles_random() {
        // Sanity: for varied inputs, sum equals amount.
        let cases = [
            (1, vec![(1, 1)]),
            (7, vec![(1, 1), (2, 1), (3, 1)]),
            (999999, vec![(1, 333), (2, 333), (3, 334)]),
            (i32::MAX as i64, vec![(1, 7), (2, 11), (3, 13), (4, 17), (5, 19)]),
        ];
        for (amount, shares) in cases {
            let r = split_payment(amount, &shares);
            assert_eq!(sum(&r), amount, "amount={amount} shares={shares:?} got={r:?}");
        }
    }

    struct Fx {
        loan_id: i64,
        admin_id: i64,
    }

    fn fixture(s: &AppState) -> Fx {
        let admin = do_setup_first_admin(s, "root", "password123").unwrap();
        let debtor = do_create_party(s, "Juan".into(), None, None).unwrap();
        let la = do_create_party(s, "Alice".into(), None, None).unwrap();
        let lb = do_create_party(s, "Bob".into(), None, None).unwrap();
        let loan = do_create_loan(
            s,
            None,
            debtor.id,
            "USD".into(),
            0,
            1700000000,
            None,
            vec![
                LoanLenderInput {
                    lender_id: la.id,
                    amount_lent_cents: 60_000,
                },
                LoanLenderInput {
                    lender_id: lb.id,
                    amount_lent_cents: 40_000,
                },
            ],
        )
        .unwrap();
        Fx {
            loan_id: loan.id,
            admin_id: admin.id,
        }
    }

    #[test]
    fn create_payment_splits_correctly() {
        let s = state();
        let fx = fixture(&s);
        // $50 payment → Alice 60% = 3000, Bob 40% = 2000
        let p = do_create_debtor_payment(&s, fx.loan_id, 5000, 1700000100, None).unwrap();
        assert_eq!(p.amount_cents, 5000);
        assert_eq!(p.splits.len(), 2);
        let by_name: std::collections::HashMap<_, _> = p
            .splits
            .iter()
            .map(|s| (s.lender_name.clone(), s.amount_cents))
            .collect();
        assert_eq!(by_name.get("Alice"), Some(&3000));
        assert_eq!(by_name.get("Bob"), Some(&2000));
        assert_eq!(p.splits.iter().map(|s| s.amount_cents).sum::<i64>(), 5000);
    }

    #[test]
    fn create_payment_rejects_zero_amount() {
        let s = state();
        let fx = fixture(&s);
        let err = do_create_debtor_payment(&s, fx.loan_id, 0, 1700000100, None).unwrap_err();
        assert!(err.contains("> 0"), "got: {err}");
    }

    #[test]
    fn create_payment_rejects_closed_loan() {
        let s = state();
        let fx = fixture(&s);
        // close loan via direct UPDATE (simulating Phase 2 close)
        crate::loans::do_update_loan(
            &s,
            fx.loan_id,
            None,
            0,
            1700000000,
            crate::loans::LoanStatus::Closed,
            None,
        )
        .unwrap();
        let err = do_create_debtor_payment(&s, fx.loan_id, 1000, 1700000100, None).unwrap_err();
        assert!(err.contains("not active"), "got: {err}");
    }

    #[test]
    fn list_payments_orders_by_paid_at_desc() {
        let s = state();
        let fx = fixture(&s);
        do_create_debtor_payment(&s, fx.loan_id, 1000, 1700000100, None).unwrap();
        do_create_debtor_payment(&s, fx.loan_id, 2000, 1700000300, None).unwrap();
        do_create_debtor_payment(&s, fx.loan_id, 1500, 1700000200, None).unwrap();
        let list = do_list_loan_payments(&s, fx.loan_id).unwrap();
        let ts: Vec<i64> = list.iter().map(|p| p.paid_at).collect();
        assert_eq!(ts, vec![1700000300, 1700000200, 1700000100]);
    }

    #[test]
    fn delete_payment_soft_deletes_admin_only() {
        let s = state();
        let fx = fixture(&s);
        let p = do_create_debtor_payment(&s, fx.loan_id, 5000, 1700000100, None).unwrap();
        // non-admin can't delete
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "alice", "password123").unwrap();
        assert_eq!(
            do_delete_debtor_payment(&s, p.id).unwrap_err(),
            "forbidden".to_string()
        );
        // admin back, can delete
        do_logout(&s);
        do_login(&s, "root", "password123").unwrap();
        do_delete_debtor_payment(&s, p.id).unwrap();
        // Payment no longer listed for the loan.
        assert_eq!(do_list_loan_payments(&s, fx.loan_id).unwrap().len(), 0);
        // Splits remain physically (audit/history), but soft-delete on the
        // parent payment filters them out of any aggregate.
        let conn = s.conn.lock().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM debtor_payment_splits WHERE payment_id = ?1",
                rusqlite::params![p.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
        // The payment row keeps its data with deleted_at set.
        let deleted_at: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM debtor_payments WHERE id = ?1",
                rusqlite::params![p.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn cannot_set_lenders_when_payments_exist() {
        let s = state();
        let fx = fixture(&s);
        do_create_debtor_payment(&s, fx.loan_id, 5000, 1700000100, None).unwrap();
        let err = crate::loans::do_set_loan_lenders(
            &s,
            fx.loan_id,
            vec![LoanLenderInput {
                lender_id: 2, // Alice
                amount_lent_cents: 100_000,
            }],
        )
        .unwrap_err();
        assert!(err.contains("payments"), "got: {err}");
    }

    #[test]
    fn cannot_delete_loan_when_payments_exist() {
        let s = state();
        let fx = fixture(&s);
        do_create_debtor_payment(&s, fx.loan_id, 5000, 1700000100, None).unwrap();
        let err = crate::loans::do_delete_loan(&s, fx.loan_id).unwrap_err();
        assert!(err.contains("payments"), "got: {err}");
    }

    #[test]
    fn audit_log_records_payment_mutations() {
        let s = state();
        let fx = fixture(&s);
        let p = do_create_debtor_payment(&s, fx.loan_id, 5000, 1700000100, None).unwrap();
        do_delete_debtor_payment(&s, p.id).unwrap();
        let conn = s.conn.lock().unwrap();
        let actions: Vec<String> = conn
            .prepare("SELECT action FROM audit_log WHERE entity_type='payment' ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions, vec!["payment.create", "payment.delete"]);
        let _ = fx.admin_id; // keep field used
    }
}
