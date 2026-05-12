use crate::audit::write_audit;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Copy, PartialEq, Eq, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    User,
}

impl Role {
    fn as_str(&self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::User => "user",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        match s {
            "admin" => Some(Role::Admin),
            "user" => Some(Role::User),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct User {
    #[ts(type = "number")]
    pub id: i64,
    pub username: String,
    pub role: Role,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, TS, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct AuthStatus {
    pub needs_setup: bool,
    pub current_user: Option<User>,
}

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub current: Mutex<Option<User>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
            current: Mutex::new(None),
        }
    }

    pub fn require_auth(&self) -> Result<User, String> {
        self.current
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "unauthenticated".to_string())
    }

    pub fn require_admin(&self) -> Result<User, String> {
        let u = self.require_auth()?;
        if u.role != Role::Admin {
            return Err("forbidden".to_string());
        }
        Ok(u)
    }
}

// ---------- Pure helpers ----------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> Result<(), String> {
    let parsed = PasswordHash::new(hash).map_err(|e| e.to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| "wrong username or password".to_string())
}

fn row_to_user(row: &Row) -> rusqlite::Result<User> {
    let role_str: String = row.get("role")?;
    let role = Role::parse(&role_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "role".into(), rusqlite::types::Type::Text)
    })?;
    Ok(User {
        id: row.get("id")?,
        username: row.get("username")?,
        role,
        created_at: row.get("created_at")?,
    })
}

fn user_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn find_user_by_username(
    conn: &Connection,
    username: &str,
) -> Result<Option<(User, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, username, role, created_at, password_hash
             FROM users WHERE username = ?1 AND deleted_at IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![username]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let user = row_to_user(row).map_err(|e| e.to_string())?;
        let hash: String = row.get("password_hash").map_err(|e| e.to_string())?;
        Ok(Some((user, hash)))
    } else {
        Ok(None)
    }
}

pub fn validate_username(s: &str) -> Result<(), String> {
    if s.trim().is_empty() {
        return Err("username is required".to_string());
    }
    if s.len() > 64 {
        return Err("username is too long".to_string());
    }
    Ok(())
}

pub fn validate_password(s: &str) -> Result<(), String> {
    if s.len() < 8 {
        return Err("password must be at least 8 characters".to_string());
    }
    Ok(())
}

// ---------- Core operations (testable, take &AppState) ----------

pub fn do_auth_status(state: &AppState) -> Result<AuthStatus, String> {
    let conn = state.conn.lock().unwrap();
    let count = user_count(&conn)?;
    let current_user = state.current.lock().unwrap().clone();
    Ok(AuthStatus {
        needs_setup: count == 0,
        current_user,
    })
}

pub fn do_setup_first_admin(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<User, String> {
    validate_username(username)?;
    validate_password(password)?;
    let mut conn = state.conn.lock().unwrap();
    if user_count(&conn)? > 0 {
        return Err("setup already completed".to_string());
    }
    let hash = hash_password(password)?;
    let now = now_secs();
    let trimmed = username.trim();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, 'admin', ?3)",
        params![trimmed, hash, now],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    let user = User {
        id,
        username: trimmed.to_string(),
        role: Role::Admin,
        created_at: now,
    };
    write_audit(
        &tx,
        id,
        "user.setup_first_admin",
        "user",
        Some(id),
        &json!({ "after": &user }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    *state.current.lock().unwrap() = Some(user.clone());
    Ok(user)
}

pub fn do_login(state: &AppState, username: &str, password: &str) -> Result<User, String> {
    let conn = state.conn.lock().unwrap();
    let (user, hash) = find_user_by_username(&conn, username.trim())?
        .ok_or_else(|| "wrong username or password".to_string())?;
    verify_password(password, &hash)?;
    *state.current.lock().unwrap() = Some(user.clone());
    Ok(user)
}

pub fn do_logout(state: &AppState) {
    *state.current.lock().unwrap() = None;
}

pub fn do_current_user(state: &AppState) -> Option<User> {
    state.current.lock().unwrap().clone()
}

pub fn do_change_password(
    state: &AppState,
    old_password: &str,
    new_password: &str,
) -> Result<(), String> {
    let me = state.require_auth()?;
    validate_password(new_password)?;
    let mut conn = state.conn.lock().unwrap();
    let hash: String = conn
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            params![me.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    verify_password(old_password, &hash)?;
    let new_hash = hash_password(new_password)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![new_hash, me.id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(&tx, me.id, "user.change_password", "user", Some(me.id), &json!({}))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn do_list_users(state: &AppState) -> Result<Vec<User>, String> {
    state.require_admin()?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, username, role, created_at FROM users
             WHERE deleted_at IS NULL ORDER BY username",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_user).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn do_create_user(
    state: &AppState,
    username: &str,
    password: &str,
    role: Role,
) -> Result<User, String> {
    let me = state.require_admin()?;
    validate_username(username)?;
    validate_password(password)?;
    let mut conn = state.conn.lock().unwrap();
    let hash = hash_password(password)?;
    let now = now_secs();
    let trimmed = username.trim();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![trimmed, hash, role.as_str(), now],
    )
    .map_err(|e| {
        let s = e.to_string();
        if s.contains("UNIQUE") {
            "username already exists".to_string()
        } else {
            s
        }
    })?;
    let id = tx.last_insert_rowid();
    let user = User {
        id,
        username: trimmed.to_string(),
        role,
        created_at: now,
    };
    write_audit(
        &tx,
        me.id,
        "user.create",
        "user",
        Some(id),
        &json!({ "after": &user }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(user)
}

pub fn do_delete_user(state: &AppState, id: i64) -> Result<(), String> {
    let me = state.require_admin()?;
    if me.id == id {
        return Err("you cannot delete yourself".to_string());
    }
    let mut conn = state.conn.lock().unwrap();
    let before = conn
        .query_row(
            "SELECT id, username, role, created_at FROM users
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            row_to_user,
        )
        .map_err(|_| "user not found".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE users SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "user.delete",
        "user",
        Some(id),
        &json!({ "before": &before }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn do_reset_user_password(
    state: &AppState,
    id: i64,
    new_password: &str,
) -> Result<(), String> {
    let me = state.require_admin()?;
    validate_password(new_password)?;
    let mut conn = state.conn.lock().unwrap();
    let hash = hash_password(new_password)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let affected = tx
        .execute(
            "UPDATE users SET password_hash = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![hash, id],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("user not found".to_string());
    }
    write_audit(&tx, me.id, "user.password_reset", "user", Some(id), &json!({}))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn do_change_user_role(state: &AppState, id: i64, role: Role) -> Result<(), String> {
    let me = state.require_admin()?;
    if me.id == id {
        return Err("you cannot change your own role".to_string());
    }
    let mut conn = state.conn.lock().unwrap();
    let before_role: String = conn
        .query_row(
            "SELECT role FROM users WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "user not found".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE users SET role = ?1 WHERE id = ?2",
        params![role.as_str(), id],
    )
    .map_err(|e| e.to_string())?;
    write_audit(
        &tx,
        me.id,
        "user.change_role",
        "user",
        Some(id),
        &json!({ "before": { "role": before_role }, "after": { "role": role.as_str() } }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Tauri command wrappers ----------

#[tauri::command]
pub fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus, String> {
    do_auth_status(&state)
}

#[tauri::command]
pub fn setup_first_admin(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<User, String> {
    do_setup_first_admin(&state, &username, &password)
}

#[tauri::command]
pub fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<User, String> {
    do_login(&state, &username, &password)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> Result<(), String> {
    do_logout(&state);
    Ok(())
}

#[tauri::command]
pub fn current_user(state: State<'_, AppState>) -> Result<Option<User>, String> {
    Ok(do_current_user(&state))
}

#[tauri::command]
pub fn change_password(
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    do_change_password(&state, &old_password, &new_password)
}

#[tauri::command]
pub fn list_users(state: State<'_, AppState>) -> Result<Vec<User>, String> {
    do_list_users(&state)
}

#[tauri::command]
pub fn create_user(
    state: State<'_, AppState>,
    username: String,
    password: String,
    role: Role,
) -> Result<User, String> {
    do_create_user(&state, &username, &password, role)
}

#[tauri::command]
pub fn delete_user(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    do_delete_user(&state, id)
}

#[tauri::command]
pub fn reset_user_password(
    state: State<'_, AppState>,
    id: i64,
    new_password: String,
) -> Result<(), String> {
    do_reset_user_password(&state, id, &new_password)
}

#[tauri::command]
pub fn change_user_role(state: State<'_, AppState>, id: i64, role: Role) -> Result<(), String> {
    do_change_user_role(&state, id, role)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;

    fn state() -> AppState {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        AppState::new(conn)
    }

    #[test]
    fn hash_verify_roundtrip() {
        let hash = hash_password("hunter2hunter2").unwrap();
        assert!(verify_password("hunter2hunter2", &hash).is_ok());
        assert!(verify_password("wrong", &hash).is_err());
    }

    #[test]
    fn validate_username_rules() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("").is_err());
        assert!(validate_username("   ").is_err());
        assert!(validate_username(&"a".repeat(65)).is_err());
    }

    #[test]
    fn validate_password_min_length() {
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password("1234567").is_err());
    }

    #[test]
    fn setup_then_login() {
        let s = state();
        assert!(do_auth_status(&s).unwrap().needs_setup);
        let admin = do_setup_first_admin(&s, "root", "password123").unwrap();
        assert_eq!(admin.role, Role::Admin);
        assert!(!do_auth_status(&s).unwrap().needs_setup);
        do_logout(&s);
        assert!(do_current_user(&s).is_none());
        let again = do_login(&s, "root", "password123").unwrap();
        assert_eq!(again.id, admin.id);
    }

    #[test]
    fn setup_twice_blocked() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        let err = do_setup_first_admin(&s, "other", "password123").unwrap_err();
        assert!(err.contains("already"), "got: {err}");
    }

    #[test]
    fn login_with_wrong_password() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_logout(&s);
        let err = do_login(&s, "root", "wrong").unwrap_err();
        assert!(err.contains("wrong"), "got: {err}");
    }

    #[test]
    fn audit_log_records_user_mutations() {
        let s = state();
        let admin = do_setup_first_admin(&s, "root", "password123").unwrap();
        let bob = do_create_user(&s, "bob", "password123", Role::User).unwrap();
        do_change_user_role(&s, bob.id, Role::Admin).unwrap();
        do_reset_user_password(&s, bob.id, "newpasspass").unwrap();
        do_delete_user(&s, bob.id).unwrap();

        let conn = s.conn.lock().unwrap();
        let actions: Vec<String> = conn
            .prepare("SELECT action FROM audit_log ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            actions,
            vec![
                "user.setup_first_admin",
                "user.create",
                "user.change_role",
                "user.password_reset",
                "user.delete",
            ]
        );
        let admin_actors: Vec<i64> = conn
            .prepare("SELECT user_id FROM audit_log WHERE id > 1")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(admin_actors.iter().all(|&u| u == admin.id));
    }

    #[test]
    fn admin_can_manage_users() {
        let s = state();
        let admin = do_setup_first_admin(&s, "root", "password123").unwrap();
        let u = do_create_user(&s, "alice", "password123", Role::User).unwrap();
        assert_eq!(do_list_users(&s).unwrap().len(), 2);
        do_change_user_role(&s, u.id, Role::Admin).unwrap();
        let err = do_change_user_role(&s, admin.id, Role::User).unwrap_err();
        assert!(err.contains("your own"), "got: {err}");
        let err = do_delete_user(&s, admin.id).unwrap_err();
        assert!(err.contains("yourself"), "got: {err}");
        do_delete_user(&s, u.id).unwrap();
        assert_eq!(do_list_users(&s).unwrap().len(), 1);
    }

    #[test]
    fn duplicate_username_rejected() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        let err = do_create_user(&s, "alice", "password123", Role::User).unwrap_err();
        assert!(err.contains("exists"), "got: {err}");
    }

    #[test]
    fn user_cannot_list_users() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_create_user(&s, "alice", "password123", Role::User).unwrap();
        do_logout(&s);
        do_login(&s, "alice", "password123").unwrap();
        let err = do_list_users(&s).unwrap_err();
        assert_eq!(err, "forbidden");
    }

    #[test]
    fn unauthenticated_blocked() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_logout(&s);
        let err = do_change_password(&s, "password123", "newnewnew").unwrap_err();
        assert_eq!(err, "unauthenticated");
    }

    #[test]
    fn change_password_flow() {
        let s = state();
        do_setup_first_admin(&s, "root", "password123").unwrap();
        do_change_password(&s, "password123", "newnewnew").unwrap();
        do_logout(&s);
        assert!(do_login(&s, "root", "password123").is_err());
        assert!(do_login(&s, "root", "newnewnew").is_ok());
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let first: i64 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        db::migrate(&mut conn).unwrap();
        let second: i64 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(first, second);
        assert!(first > 0);
    }
}
