use crate::auth::AppState;
use rusqlite::{params_from_iter, types::Value as SqlValue, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AuditEntry {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub at: i64,
    #[ts(type = "number | null")]
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    pub action: String,
    pub entity_type: String,
    #[ts(type = "number | null")]
    pub entity_id: Option<i64>,
    pub payload: Option<String>,
}

pub fn write_audit(
    tx: &Transaction,
    user_id: i64,
    action: &str,
    entity_type: &str,
    entity_id: Option<i64>,
    payload: &Value,
) -> Result<(), String> {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    tx.execute(
        "INSERT INTO audit_log (at, user_id, action, entity_type, entity_id, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params_from_iter([
            SqlValue::Integer(at),
            SqlValue::Integer(user_id),
            SqlValue::Text(action.to_string()),
            SqlValue::Text(entity_type.to_string()),
            match entity_id {
                Some(v) => SqlValue::Integer(v),
                None => SqlValue::Null,
            },
            SqlValue::Text(payload.to_string()),
        ]),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn do_list_audit_log(
    state: &AppState,
    entity_type: Option<String>,
    user_id: Option<i64>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditEntry>, String> {
    state.require_admin()?;
    let limit = limit.clamp(1, 500);
    let offset = offset.max(0);

    let mut conditions: Vec<&'static str> = vec![];
    let mut values: Vec<SqlValue> = vec![];
    if let Some(et) = entity_type.as_ref().filter(|s| !s.is_empty()) {
        conditions.push("al.entity_type = ?");
        values.push(SqlValue::Text(et.clone()));
    }
    if let Some(uid) = user_id {
        conditions.push("al.user_id = ?");
        values.push(SqlValue::Integer(uid));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!(
        "SELECT al.id, al.at, al.user_id, u.username AS user_name,
                al.action, al.entity_type, al.entity_id, al.payload
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         {where_clause}
         ORDER BY al.at DESC, al.id DESC
         LIMIT ? OFFSET ?"
    );
    values.push(SqlValue::Integer(limit));
    values.push(SqlValue::Integer(offset));

    let conn = state.conn.lock().unwrap();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                at: row.get("at")?,
                user_id: row.get("user_id")?,
                user_name: row.get("user_name")?,
                action: row.get("action")?,
                entity_type: row.get("entity_type")?,
                entity_id: row.get("entity_id")?,
                payload: row.get("payload")?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_audit_log(
    state: State<'_, AppState>,
    entity_type: Option<String>,
    user_id: Option<i64>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditEntry>, String> {
    do_list_audit_log(&state, entity_type, user_id, limit, offset)
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

    #[test]
    fn requires_admin() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "alice", "password123").unwrap();
        assert_eq!(
            do_list_audit_log(&s, None, None, 50, 0).unwrap_err(),
            "forbidden".to_string()
        );
    }

    #[test]
    fn returns_newest_first() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        // Generate a few entries.
        do_create_party(&s, "A".into(), None, None).unwrap();
        do_create_party(&s, "B".into(), None, None).unwrap();
        let log = do_list_audit_log(&s, None, None, 50, 0).unwrap();
        assert!(!log.is_empty());
        // IDs should be strictly decreasing.
        for w in log.windows(2) {
            assert!(w[0].id >= w[1].id);
        }
    }

    #[test]
    fn filter_by_entity_type() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_create_party(&s, "A".into(), None, None).unwrap();
        do_create_user(&s, "bob", "password123", Role::User).unwrap();
        let only_parties = do_list_audit_log(&s, Some("party".into()), None, 50, 0).unwrap();
        assert!(only_parties.iter().all(|e| e.entity_type == "party"));
        let only_users = do_list_audit_log(&s, Some("user".into()), None, 50, 0).unwrap();
        assert!(only_users.iter().all(|e| e.entity_type == "user"));
    }

    #[test]
    fn filter_by_user_id() {
        let s = state();
        let admin = do_setup_first_admin(&s, "root", "password123").unwrap();
        do_create_party(&s, "A".into(), None, None).unwrap();
        let mine = do_list_audit_log(&s, None, Some(admin.id), 50, 0).unwrap();
        assert!(mine.iter().all(|e| e.user_id == Some(admin.id)));
        // Filter by a non-existent user → empty.
        let none = do_list_audit_log(&s, None, Some(99999), 50, 0).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn paginates() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        for i in 0..5 {
            do_create_party(&s, format!("L{i}"), None, None).unwrap();
        }
        let page1 = do_list_audit_log(&s, None, None, 2, 0).unwrap();
        let page2 = do_list_audit_log(&s, None, None, 2, 2).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 2);
        // Pages must be disjoint.
        let ids1: std::collections::HashSet<_> = page1.iter().map(|e| e.id).collect();
        for e in &page2 {
            assert!(!ids1.contains(&e.id));
        }
    }

    #[test]
    fn user_name_preserved_after_soft_delete() {
        // With soft delete, the users row is preserved; the audit log JOIN
        // still resolves the username even after the user is "deleted".
        // That's actually a desirable audit property — historical attribution
        // doesn't get lost when an account is removed.
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        let bob = do_create_user(&s, "bob", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "bob", "password123").unwrap();
        do_create_party(&s, "B-party".into(), None, None).unwrap();
        do_logout(&s);
        do_login(&s, "root", "password123").unwrap();
        crate::auth::do_delete_user(&s, bob.id).unwrap();
        let log = do_list_audit_log(&s, Some("party".into()), None, 100, 0).unwrap();
        let party_entry = log
            .iter()
            .find(|e| e.action == "party.create")
            .expect("party.create entry");
        assert_eq!(party_entry.user_id, Some(bob.id));
        assert_eq!(party_entry.user_name.as_deref(), Some("bob"));
    }
}

