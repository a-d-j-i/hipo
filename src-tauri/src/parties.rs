use crate::audit::write_audit;
use crate::auth::AppState;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Party {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub external_ref: Option<String>,
    pub notes: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub created_by: Option<i64>,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_party(row: &Row) -> rusqlite::Result<Party> {
    Ok(Party {
        id: row.get("id")?,
        name: row.get("name")?,
        external_ref: row.get("external_ref")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        created_by: row.get("created_by")?,
    })
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if name.len() > 200 {
        return Err("name is too long".to_string());
    }
    Ok(())
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

pub fn do_list_parties(state: &AppState) -> Result<Vec<Party>, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, external_ref, notes, created_at, created_by
             FROM parties WHERE deleted_at IS NULL ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_party)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn do_get_party(state: &AppState, id: i64) -> Result<Party, String> {
    state.require_auth()?;
    let conn = state.conn.lock().unwrap();
    conn.query_row(
        "SELECT id, name, external_ref, notes, created_at, created_by
         FROM parties WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
        row_to_party,
    )
    .map_err(|_| "party not found".to_string())
}

pub fn do_create_party(
    state: &AppState,
    name: String,
    external_ref: Option<String>,
    notes: Option<String>,
) -> Result<Party, String> {
    let me = state.require_auth()?;
    validate_name(&name)?;
    let name = name.trim().to_string();
    let external_ref = normalize_opt(external_ref);
    let notes = normalize_opt(notes);
    let now = now_secs();

    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO parties (name, external_ref, notes, created_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&name, &external_ref, &notes, now, me.id],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    let party = Party {
        id,
        name,
        external_ref,
        notes,
        created_at: now,
        created_by: Some(me.id),
    };
    write_audit(
        &tx,
        me.id,
        "party.create",
        "party",
        Some(id),
        &json!({ "after": &party }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(party)
}

pub fn do_update_party(
    state: &AppState,
    id: i64,
    name: String,
    external_ref: Option<String>,
    notes: Option<String>,
) -> Result<Party, String> {
    let me = state.require_auth()?;
    validate_name(&name)?;
    let name = name.trim().to_string();
    let external_ref = normalize_opt(external_ref);
    let notes = normalize_opt(notes);

    let mut conn = state.conn.lock().unwrap();
    let before = conn
        .query_row(
            "SELECT id, name, external_ref, notes, created_at, created_by
             FROM parties WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            row_to_party,
        )
        .map_err(|_| "party not found".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE parties SET name = ?1, external_ref = ?2, notes = ?3 WHERE id = ?4",
        params![&name, &external_ref, &notes, id],
    )
    .map_err(|e| e.to_string())?;
    let after = Party {
        id,
        name,
        external_ref,
        notes,
        created_at: before.created_at,
        created_by: before.created_by,
    };
    write_audit(
        &tx,
        me.id,
        "party.update",
        "party",
        Some(id),
        &json!({ "before": &before, "after": &after }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(after)
}

pub fn do_delete_party(state: &AppState, id: i64) -> Result<(), String> {
    let me = state.require_admin()?;
    let mut conn = state.conn.lock().unwrap();
    let before = conn
        .query_row(
            "SELECT id, name, external_ref, notes, created_at, created_by
             FROM parties WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            row_to_party,
        )
        .map_err(|_| "party not found".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE parties SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "party.delete",
        "party",
        Some(id),
        &json!({ "before": &before }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Tauri command wrappers ----------

#[tauri::command]
pub fn list_parties(state: State<'_, AppState>) -> Result<Vec<Party>, String> {
    do_list_parties(&state)
}

#[tauri::command]
pub fn get_party(state: State<'_, AppState>, id: i64) -> Result<Party, String> {
    do_get_party(&state, id)
}

#[tauri::command]
pub fn create_party(
    state: State<'_, AppState>,
    name: String,
    external_ref: Option<String>,
    notes: Option<String>,
) -> Result<Party, String> {
    do_create_party(&state, name, external_ref, notes)
}

#[tauri::command]
pub fn update_party(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    external_ref: Option<String>,
    notes: Option<String>,
) -> Result<Party, String> {
    do_update_party(&state, id, name, external_ref, notes)
}

#[tauri::command]
pub fn delete_party(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    do_delete_party(&state, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{do_create_user, do_login, do_logout, do_setup_first_admin, Role};
    use crate::db;
    use rusqlite::Connection;

    fn state() -> AppState {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        AppState::new(conn)
    }

    fn with_admin(s: &AppState) {
        do_setup_first_admin(s, "root", "password123").unwrap();
    }

    #[test]
    fn create_list_get_update_delete() {
        let s = state();
        with_admin(&s);

        let p = do_create_party(
            &s,
            "Banco Galicia".into(),
            Some("CUIT-30-50000000-1".into()),
            None,
        )
        .unwrap();
        assert_eq!(p.name, "Banco Galicia");
        assert_eq!(p.external_ref.as_deref(), Some("CUIT-30-50000000-1"));

        let got = do_get_party(&s, p.id).unwrap();
        assert_eq!(got.id, p.id);

        let updated = do_update_party(
            &s,
            p.id,
            "Banco Galicia SA".into(),
            None,
            Some("changed".into()),
        )
        .unwrap();
        assert_eq!(updated.name, "Banco Galicia SA");
        assert_eq!(updated.external_ref, None);
        assert_eq!(updated.notes.as_deref(), Some("changed"));

        let listed = do_list_parties(&s).unwrap();
        assert_eq!(listed.len(), 1);

        do_delete_party(&s, p.id).unwrap();
        assert!(do_get_party(&s, p.id).is_err());
        assert_eq!(do_list_parties(&s).unwrap().len(), 0);
    }

    #[test]
    fn empty_optional_fields_become_null() {
        let s = state();
        with_admin(&s);
        let p = do_create_party(&s, "Juan".into(), Some("   ".into()), Some("".into())).unwrap();
        assert!(p.external_ref.is_none());
        assert!(p.notes.is_none());
    }

    #[test]
    fn validate_rejects_blank_name() {
        let s = state();
        with_admin(&s);
        let err = do_create_party(&s, "   ".into(), None, None).unwrap_err();
        assert!(err.contains("name"), "got: {err}");
    }

    #[test]
    fn delete_requires_admin() {
        let s = state();
        with_admin(&s);
        let p = do_create_party(&s, "X".into(), None, None).unwrap();
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "alice", "password123").unwrap();
        let err = do_delete_party(&s, p.id).unwrap_err();
        assert_eq!(err, "forbidden");
        assert!(do_list_parties(&s).is_ok());
        let p2 = do_create_party(&s, "Y".into(), None, None).unwrap();
        do_update_party(&s, p2.id, "Y2".into(), None, None).unwrap();
    }

    #[test]
    fn audit_log_records_party_mutations() {
        let s = state();
        with_admin(&s);
        let p = do_create_party(&s, "X".into(), None, None).unwrap();
        do_update_party(&s, p.id, "X2".into(), None, None).unwrap();
        do_delete_party(&s, p.id).unwrap();

        let conn = s.conn.lock().unwrap();
        let actions: Vec<String> = conn
            .prepare("SELECT action FROM audit_log WHERE entity_type = 'party' ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            actions,
            vec!["party.create", "party.update", "party.delete"]
        );
    }

    #[test]
    fn unauthenticated_cannot_list() {
        let s = state();
        with_admin(&s);
        do_logout(&s);
        assert_eq!(
            do_list_parties(&s).unwrap_err(),
            "unauthenticated".to_string()
        );
    }
}
