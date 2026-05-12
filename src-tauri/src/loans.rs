use crate::audit::write_audit;
use crate::auth::AppState;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Copy, PartialEq, Eq, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum LoanStatus {
    Active,
    Closed,
}

impl LoanStatus {
    fn as_str(&self) -> &'static str {
        match self {
            LoanStatus::Active => "active",
            LoanStatus::Closed => "closed",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(LoanStatus::Active),
            "closed" => Some(LoanStatus::Closed),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LoanLender {
    #[ts(type = "number")]
    pub lender_id: i64,
    pub lender_name: String,
    #[ts(type = "number")]
    pub amount_lent_cents: i64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Loan {
    #[ts(type = "number")]
    pub id: i64,
    pub reference: Option<String>,
    #[ts(type = "number")]
    pub debtor_id: i64,
    pub debtor_name: String,
    pub currency_code: String,
    #[ts(type = "number")]
    pub principal_cents: i64,
    #[ts(type = "number")]
    pub interest_cents: i64,
    #[ts(type = "number")]
    pub issued_at: i64,
    pub status: LoanStatus,
    pub notes: Option<String>,
    pub lenders: Vec<LoanLender>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub created_by: Option<i64>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LoanLenderInput {
    #[ts(type = "number")]
    pub lender_id: i64,
    #[ts(type = "number")]
    pub amount_lent_cents: i64,
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
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn validate_currency_code(code: &str) -> Result<(), String> {
    if code.len() != 3 || !code.chars().all(|c| c.is_ascii_uppercase()) {
        return Err("currency_code must be 3 uppercase letters (ISO 4217)".to_string());
    }
    Ok(())
}

/// Validates the lender list and returns the principal (sum of contributions)
/// in cents. The principal is derived — not provided separately.
fn validate_lenders(lenders: &[LoanLenderInput]) -> Result<i64, String> {
    if lenders.is_empty() {
        return Err("loan needs at least one lender".to_string());
    }
    let mut seen: HashSet<i64> = HashSet::new();
    let mut sum: i64 = 0;
    for l in lenders {
        if l.amount_lent_cents <= 0 {
            return Err("each lender amount must be > 0".to_string());
        }
        if !seen.insert(l.lender_id) {
            return Err(format!("lender {} appears more than once", l.lender_id));
        }
        sum = sum
            .checked_add(l.amount_lent_cents)
            .ok_or_else(|| "lender amounts overflow".to_string())?;
    }
    Ok(sum)
}

fn party_exists(conn: &Connection, id: i64) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM parties WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("party {id} not found"));
    }
    Ok(())
}

fn row_to_loan_head(row: &Row) -> rusqlite::Result<(Loan, ())> {
    let status_str: String = row.get("status")?;
    let status = LoanStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "status".into(), rusqlite::types::Type::Text)
    })?;
    Ok((
        Loan {
            id: row.get("id")?,
            reference: row.get("reference")?,
            debtor_id: row.get("debtor_id")?,
            debtor_name: row.get("debtor_name")?,
            currency_code: row.get("currency_code")?,
            principal_cents: row.get("principal_cents")?,
            interest_cents: row.get("interest_cents")?,
            issued_at: row.get("issued_at")?,
            status,
            notes: row.get("notes")?,
            lenders: Vec::new(),
            created_at: row.get("created_at")?,
            created_by: row.get("created_by")?,
        },
        (),
    ))
}

fn fetch_lenders(conn: &Connection, loan_id: i64) -> Result<Vec<LoanLender>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT ll.lender_id, p.name AS lender_name, ll.amount_lent_cents
             FROM loan_lenders ll
             JOIN parties p ON p.id = ll.lender_id
             WHERE ll.loan_id = ?1
             ORDER BY p.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![loan_id], |row| {
            Ok(LoanLender {
                lender_id: row.get("lender_id")?,
                lender_name: row.get("lender_name")?,
                amount_lent_cents: row.get("amount_lent_cents")?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn fetch_loan(conn: &Connection, id: i64) -> Result<Loan, String> {
    let (mut loan, _) = conn
        .query_row(
            "SELECT l.id, l.reference, l.debtor_id, d.name AS debtor_name,
                    l.currency_code, l.principal_cents, l.interest_cents,
                    l.issued_at, l.status, l.notes, l.created_at, l.created_by
             FROM loans l
             JOIN parties d ON d.id = l.debtor_id
             WHERE l.id = ?1 AND l.deleted_at IS NULL",
            params![id],
            row_to_loan_head,
        )
        .map_err(|_| "loan not found".to_string())?;
    loan.lenders = fetch_lenders(conn, id)?;
    Ok(loan)
}

fn insert_lenders(
    tx: &rusqlite::Transaction,
    loan_id: i64,
    lenders: &[LoanLenderInput],
) -> Result<(), String> {
    for l in lenders {
        party_exists(tx, l.lender_id)?;
        tx.execute(
            "INSERT INTO loan_lenders (loan_id, lender_id, amount_lent_cents)
             VALUES (?1, ?2, ?3)",
            params![loan_id, l.lender_id, l.amount_lent_cents],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Core operations ----------

pub fn do_list_loans(state: &AppState) -> Result<Vec<Loan>, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.reference, l.debtor_id, d.name AS debtor_name,
                    l.currency_code, l.principal_cents, l.interest_cents,
                    l.issued_at, l.status, l.notes, l.created_at, l.created_by
             FROM loans l
             JOIN parties d ON d.id = l.debtor_id
             WHERE l.deleted_at IS NULL
             ORDER BY l.issued_at DESC, l.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_loan_head)
        .map_err(|e| e.to_string())?;
    let mut loans: Vec<Loan> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(l, _)| l)
        .collect();
    for loan in &mut loans {
        loan.lenders = fetch_lenders(&conn, loan.id)?;
    }
    Ok(loans)
}

pub fn do_get_loan(state: &AppState, id: i64) -> Result<Loan, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    fetch_loan(&conn, id)
}

pub fn do_create_loan(
    state: &AppState,
    reference: Option<String>,
    debtor_id: i64,
    currency_code: String,
    interest_cents: i64,
    issued_at: i64,
    notes: Option<String>,
    lenders: Vec<LoanLenderInput>,
) -> Result<Loan, String> {
    let me = state.require_auth()?;
    let currency_code = currency_code.trim().to_uppercase();
    validate_currency_code(&currency_code)?;
    if interest_cents < 0 {
        return Err("interest must be >= 0".to_string());
    }
    let principal_cents = validate_lenders(&lenders)?;
    let reference = normalize_opt(reference);
    let notes = normalize_opt(notes);
    let now = now_secs();

    let mut conn = state.conn.lock().unwrap();
    party_exists(&conn, debtor_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO loans (reference, debtor_id, currency_code, principal_cents,
                            interest_cents, issued_at, status, notes, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9)",
        params![
            &reference,
            debtor_id,
            &currency_code,
            principal_cents,
            interest_cents,
            issued_at,
            &notes,
            now,
            me.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    insert_lenders(&tx, id, &lenders)?;

    let loan = fetch_loan(&tx, id)?;
    write_audit(
        &tx,
        me.id,
        "loan.create",
        "loan",
        Some(id),
        &json!({ "after": &loan }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(loan)
}

pub fn do_update_loan(
    state: &AppState,
    id: i64,
    reference: Option<String>,
    interest_cents: i64,
    issued_at: i64,
    status: LoanStatus,
    notes: Option<String>,
) -> Result<Loan, String> {
    let me = state.require_auth()?;
    if interest_cents < 0 {
        return Err("interest must be >= 0".to_string());
    }
    let reference = normalize_opt(reference);
    let notes = normalize_opt(notes);

    let mut conn = state.conn.lock().unwrap();
    let before = fetch_loan(&conn, id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE loans SET reference = ?1, interest_cents = ?2, issued_at = ?3,
                          status = ?4, notes = ?5
         WHERE id = ?6",
        params![
            &reference,
            interest_cents,
            issued_at,
            status.as_str(),
            &notes,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    let after = fetch_loan(&tx, id)?;
    write_audit(
        &tx,
        me.id,
        "loan.update",
        "loan",
        Some(id),
        &json!({ "before": &before, "after": &after }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(after)
}

pub fn do_set_loan_lenders(
    state: &AppState,
    loan_id: i64,
    lenders: Vec<LoanLenderInput>,
) -> Result<Loan, String> {
    let me = state.require_auth()?;
    let mut conn = state.conn.lock().unwrap();
    let before = fetch_loan(&conn, loan_id)?;
    if crate::payments::loan_has_payments(&conn, loan_id)? {
        return Err("cannot change lenders: loan has payments".to_string());
    }
    let new_principal = validate_lenders(&lenders)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM loan_lenders WHERE loan_id = ?1",
        params![loan_id],
    )
    .map_err(|e| e.to_string())?;
    insert_lenders(&tx, loan_id, &lenders)?;
    // Principal is derived from the lender contributions; keep them in sync.
    tx.execute(
        "UPDATE loans SET principal_cents = ?1 WHERE id = ?2",
        params![new_principal, loan_id],
    )
    .map_err(|e| e.to_string())?;
    let after = fetch_loan(&tx, loan_id)?;
    write_audit(
        &tx,
        me.id,
        "loan.set_lenders",
        "loan",
        Some(loan_id),
        &json!({
            "before": { "principal_cents": before.principal_cents, "lenders": before.lenders },
            "after": { "principal_cents": after.principal_cents, "lenders": after.lenders }
        }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(after)
}

pub fn do_delete_loan(state: &AppState, id: i64) -> Result<(), String> {
    let me = state.require_admin()?;
    let mut conn = state.conn.lock().unwrap();
    let before = fetch_loan(&conn, id)?;
    if crate::payments::loan_has_payments(&conn, id)? {
        return Err("cannot delete loan with payments: close it instead".to_string());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE loans SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "loan.delete",
        "loan",
        Some(id),
        &json!({ "before": &before }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Tauri command wrappers ----------

#[tauri::command]
pub fn list_loans(state: State<'_, AppState>) -> Result<Vec<Loan>, String> {
    do_list_loans(&state)
}

#[tauri::command]
pub fn get_loan(state: State<'_, AppState>, id: i64) -> Result<Loan, String> {
    do_get_loan(&state, id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_loan(
    state: State<'_, AppState>,
    reference: Option<String>,
    debtor_id: i64,
    currency_code: String,
    interest_cents: i64,
    issued_at: i64,
    notes: Option<String>,
    lenders: Vec<LoanLenderInput>,
) -> Result<Loan, String> {
    do_create_loan(
        &state,
        reference,
        debtor_id,
        currency_code,
        interest_cents,
        issued_at,
        notes,
        lenders,
    )
}

#[tauri::command]
pub fn update_loan(
    state: State<'_, AppState>,
    id: i64,
    reference: Option<String>,
    interest_cents: i64,
    issued_at: i64,
    status: LoanStatus,
    notes: Option<String>,
) -> Result<Loan, String> {
    do_update_loan(&state, id, reference, interest_cents, issued_at, status, notes)
}

#[tauri::command]
pub fn set_loan_lenders(
    state: State<'_, AppState>,
    loan_id: i64,
    lenders: Vec<LoanLenderInput>,
) -> Result<Loan, String> {
    do_set_loan_lenders(&state, loan_id, lenders)
}

#[tauri::command]
pub fn delete_loan(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    do_delete_loan(&state, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{do_create_user, do_login, do_logout, do_setup_first_admin, Role};
    use crate::db;
    use crate::parties::do_create_party;
    use rusqlite::Connection;

    fn state() -> AppState {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        AppState::new(conn)
    }

    struct Fixture {
        debtor_id: i64,
        lender_a: i64,
        lender_b: i64,
    }

    fn with_parties(s: &AppState) -> Fixture {
        do_setup_first_admin(s, "root", "password123").unwrap();
        let debtor = do_create_party(s, "Juan".into(), None, None).unwrap();
        let a = do_create_party(s, "Alice".into(), None, None).unwrap();
        let b = do_create_party(s, "Bob".into(), None, None).unwrap();
        Fixture {
            debtor_id: debtor.id,
            lender_a: a.id,
            lender_b: b.id,
        }
    }

    fn make_loan(s: &AppState, f: &Fixture) -> Loan {
        do_create_loan(
            s,
            Some("LN-001".into()),
            f.debtor_id,
            "USD".into(),
            10_000, // $100.00 interest
            1700000000,
            None,
            vec![
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 60_000,
                },
                LoanLenderInput {
                    lender_id: f.lender_b,
                    amount_lent_cents: 40_000,
                },
            ],
        )
        .unwrap()
    }

    #[test]
    fn create_list_get_loan() {
        let s = state();
        let f = with_parties(&s);
        let loan = make_loan(&s, &f);
        assert_eq!(loan.principal_cents, 100_000);
        assert_eq!(loan.currency_code, "USD");
        assert_eq!(loan.debtor_name, "Juan");
        assert_eq!(loan.lenders.len(), 2);

        let got = do_get_loan(&s, loan.id).unwrap();
        assert_eq!(got.id, loan.id);

        let list = do_list_loans(&s).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].lenders.len(), 2);
    }

    #[test]
    fn principal_is_derived_from_lenders() {
        let s = state();
        let f = with_parties(&s);
        let loan = do_create_loan(
            &s,
            None,
            f.debtor_id,
            "USD".into(),
            0,
            1,
            None,
            vec![
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 70_000,
                },
                LoanLenderInput {
                    lender_id: f.lender_b,
                    amount_lent_cents: 30_000,
                },
            ],
        )
        .unwrap();
        assert_eq!(loan.principal_cents, 100_000);
    }

    #[test]
    fn reject_zero_lender_amount_and_duplicates() {
        let s = state();
        let f = with_parties(&s);
        let err = do_create_loan(
            &s,
            None,
            f.debtor_id,
            "USD".into(),
            0,
            1,
            None,
            vec![LoanLenderInput {
                lender_id: f.lender_a,
                amount_lent_cents: 0,
            }],
        )
        .unwrap_err();
        assert!(err.contains("> 0"), "got: {err}");

        let err = do_create_loan(
            &s,
            None,
            f.debtor_id,
            "USD".into(),
            0,
            1,
            None,
            vec![
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 50_000,
                },
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 50_000,
                },
            ],
        )
        .unwrap_err();
        assert!(err.contains("more than once"), "got: {err}");
    }

    #[test]
    fn reject_empty_lenders() {
        let s = state();
        let f = with_parties(&s);
        let err = do_create_loan(
            &s,
            None,
            f.debtor_id,
            "USD".into(),
            0,
            1,
            None,
            vec![],
        )
        .unwrap_err();
        assert!(err.contains("at least one lender"), "got: {err}");
    }

    #[test]
    fn reject_missing_party() {
        let s = state();
        let f = with_parties(&s);
        let err = do_create_loan(
            &s,
            None,
            99_999, // nonexistent debtor
            "USD".into(),
            0,
            1,
            None,
            vec![LoanLenderInput {
                lender_id: f.lender_a,
                amount_lent_cents: 100_000,
            }],
        )
        .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn reject_bad_currency() {
        let s = state();
        let f = with_parties(&s);
        let err = do_create_loan(
            &s,
            None,
            f.debtor_id,
            "us".into(),
            0,
            1,
            None,
            vec![LoanLenderInput {
                lender_id: f.lender_a,
                amount_lent_cents: 100_000,
            }],
        )
        .unwrap_err();
        assert!(err.contains("currency_code"), "got: {err}");
    }

    #[test]
    fn update_loan_soft_fields_only() {
        let s = state();
        let f = with_parties(&s);
        let loan = make_loan(&s, &f);
        let updated = do_update_loan(
            &s,
            loan.id,
            Some("LN-001-v2".into()),
            20_000,
            1700000001,
            LoanStatus::Closed,
            Some("paid off".into()),
        )
        .unwrap();
        assert_eq!(updated.reference.as_deref(), Some("LN-001-v2"));
        assert_eq!(updated.interest_cents, 20_000);
        assert_eq!(updated.status, LoanStatus::Closed);
        // Immutable fields unchanged
        assert_eq!(updated.principal_cents, loan.principal_cents);
        assert_eq!(updated.debtor_id, loan.debtor_id);
        assert_eq!(updated.currency_code, loan.currency_code);
    }

    #[test]
    fn set_loan_lenders_replaces_and_recomputes_principal() {
        let s = state();
        let f = with_parties(&s);
        let loan = make_loan(&s, &f);
        assert_eq!(loan.principal_cents, 100_000);
        let c = do_create_party(&s, "Carol".into(), None, None).unwrap();
        let after = do_set_loan_lenders(
            &s,
            loan.id,
            vec![
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 30_000,
                },
                LoanLenderInput {
                    lender_id: c.id,
                    amount_lent_cents: 90_000,
                },
            ],
        )
        .unwrap();
        assert_eq!(after.lenders.len(), 2);
        assert_eq!(after.principal_cents, 120_000); // recomputed
        let names: Vec<&str> = after.lenders.iter().map(|l| l.lender_name.as_str()).collect();
        assert!(names.contains(&"Alice"));
        assert!(names.contains(&"Carol"));
        assert!(!names.contains(&"Bob"));
    }

    #[test]
    fn delete_loan_soft_deletes_admin_only() {
        let s = state();
        let f = with_parties(&s);
        let loan = make_loan(&s, &f);
        // Become a non-admin
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "alice", "password123").unwrap();
        let err = do_delete_loan(&s, loan.id).unwrap_err();
        assert_eq!(err, "forbidden");
        // Switch back to admin
        do_logout(&s);
        do_login(&s, "root", "password123").unwrap();
        do_delete_loan(&s, loan.id).unwrap();
        // Loan no longer in list, and get_loan returns "not found".
        assert_eq!(do_list_loans(&s).unwrap().len(), 0);
        assert!(do_get_loan(&s, loan.id).is_err());
        // But the row is preserved in the DB with deleted_at set, and the
        // loan_lenders rows are untouched (no cascade delete).
        let conn = s.conn.lock().unwrap();
        let deleted_at: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM loans WHERE id = ?1",
                rusqlite::params![loan.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
        let n_lenders: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM loan_lenders WHERE loan_id = ?1",
                rusqlite::params![loan.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n_lenders, 2);
    }

    #[test]
    fn audit_log_records_loan_mutations() {
        let s = state();
        let f = with_parties(&s);
        let loan = make_loan(&s, &f);
        do_update_loan(
            &s,
            loan.id,
            None,
            10_000,
            1700000000,
            LoanStatus::Active,
            None,
        )
        .unwrap();
        do_set_loan_lenders(
            &s,
            loan.id,
            vec![
                LoanLenderInput {
                    lender_id: f.lender_a,
                    amount_lent_cents: 50_000,
                },
                LoanLenderInput {
                    lender_id: f.lender_b,
                    amount_lent_cents: 50_000,
                },
            ],
        )
        .unwrap();
        do_delete_loan(&s, loan.id).unwrap();

        let conn = s.conn.lock().unwrap();
        let actions: Vec<String> = conn
            .prepare("SELECT action FROM audit_log WHERE entity_type='loan' ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            actions,
            vec!["loan.create", "loan.update", "loan.set_lenders", "loan.delete"]
        );
    }
}
