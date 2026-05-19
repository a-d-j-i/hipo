//! Native SQLite for the Tauri shape (Phase 12).
//!
//! The frontend's Drizzle instance uses `drizzle-orm/sqlite-proxy`
//! and routes every query through Tauri `invoke()` calls into
//! `sql_exec` (write / DDL) or `sql_query` (read). Rusqlite holds a
//! single `Connection` behind a `Mutex` stored as Tauri State; the
//! consumer crate declares which file under `app_data_dir()` to use
//! via `ShellConfig::db_filename`.
//!
//! Per the plan (`docs/local-first-framework.md` Phase 12): same
//! Drizzle abstraction runs on every shape — sqlocal + OPFS on the
//! hosted shape, libsql on the server shape, rusqlite on the Tauri
//! shape. Schemas, migrations, do_* operations and the SystemStatus
//! shape are unchanged across shapes.
//!
//! Concurrency: SQLite (in any embedding) doesn't support concurrent
//! writers on a single connection, so a Mutex around `Connection` is
//! the natural shape. Tauri serialises command invocations through
//! the lock; JS-side Promise.all of N invokes runs sequentially on
//! the Rust side.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use rusqlite::{
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use tauri::State;

/// Tauri-managed state wrapping the single rusqlite `Connection`.
/// Stores its origin `path` (for on-disk opens) so the backup /
/// restore commands can reach the same file later.
pub struct SqlState {
    conn: Mutex<Connection>,
    path: PathBuf,
}

fn apply_default_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

impl SqlState {
    /// Open (or create) a SQLite database at `path` and configure
    /// pragmas matching the libsql / sqlocal defaults used on the
    /// other shapes (WAL, foreign keys on, NORMAL synchronous).
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        apply_default_pragmas(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    /// In-memory open, used by the test suite. The `path` field is
    /// set to an empty path — restore tests use [`open`] against a
    /// real temp file.
    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: PathBuf::new(),
        })
    }
}

fn json_to_sql(v: serde_json::Value) -> SqlValue {
    match v {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(b) => SqlValue::Integer(if b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null
            }
        }
        serde_json::Value::String(s) => SqlValue::Text(s),
        // Arrays/objects: stringified-JSON fallback. The proxy on the
        // TS side does not currently send binary params; if/when we
        // need Uint8Array round-trip, the convention will be a tagged
        // `{ __blob: "<base64>" }` object decoded here.
        other @ (serde_json::Value::Array(_) | serde_json::Value::Object(_)) => {
            SqlValue::Text(other.to_string())
        }
    }
}

fn sql_to_json(v: ValueRef) -> serde_json::Value {
    match v {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::Value::Number(i.into()),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        ValueRef::Text(s) => {
            serde_json::Value::String(String::from_utf8_lossy(s).into_owned())
        }
        // base64 keeps the wire JSON small. Apps that need
        // Uint8Array on the JS side decode in `client-tauri.ts`.
        ValueRef::Blob(b) => serde_json::Value::String(
            base64::engine::general_purpose::STANDARD.encode(b),
        ),
    }
}

/// Run a statement that does not return rows (INSERT / UPDATE /
/// DELETE / DDL / `BEGIN` / `COMMIT` / `ROLLBACK` / `PRAGMA …`).
/// Returns `rowsAffected`. Errors come back as strings — the proxy
/// in `@hipo/sqlite/client-tauri` rethrows them so Drizzle sees a
/// normal driver-side error.
#[tauri::command]
pub fn sql_exec(
    state: State<'_, SqlState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<u64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let sql_params: Vec<SqlValue> = params.into_iter().map(json_to_sql).collect();
    conn.execute(&sql, params_from_iter(sql_params))
        .map(|n| n as u64)
        .map_err(|e| format!("sql_exec: {e}"))
}

/// Run a statement that returns rows. Always returns rows in values
/// mode (each row is an array positionally matching the SELECT
/// columns). The TS proxy driver picks `rows[0]` for Drizzle's
/// `get` method and uses the full array for `all` / `values`.
#[tauri::command]
pub fn sql_query(
    state: State<'_, SqlState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let sql_params: Vec<SqlValue> = params.into_iter().map(json_to_sql).collect();
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("sql_query prepare: {e}"))?;
    let col_count = stmt.column_count();
    let mut rows = stmt
        .query(params_from_iter(sql_params))
        .map_err(|e| format!("sql_query exec: {e}"))?;
    let mut out: Vec<Vec<serde_json::Value>> = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("sql_query row: {e}"))?
    {
        let mut r: Vec<serde_json::Value> = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let v = row
                .get_ref(i)
                .map_err(|e| format!("sql_query col {i}: {e}"))?;
            r.push(sql_to_json(v));
        }
        out.push(r);
    }
    Ok(out)
}

/// Backup the live database to a base64-encoded SQLite file. Uses
/// `VACUUM INTO` against a temp file alongside the DB so the
/// snapshot is consistent regardless of in-flight transactions, then
/// reads the temp file and removes it. Base64 keeps the JSON IPC
/// payload at ~1.33× the binary size; for very large DBs a stream-
/// to-disk path would be a future optimisation.
///
/// Refuses to back up an in-memory database (`SqlState::path` is
/// empty), which only occurs in tests.
#[tauri::command]
pub fn sql_backup_to_bytes(state: State<'_, SqlState>) -> Result<String, String> {
    if state.path.as_os_str().is_empty() {
        return Err("sql_backup_to_bytes: no on-disk database".into());
    }
    // Sit next to the live DB so a Tauri sandboxed app doesn't need
    // any extra path permissions to write the snapshot.
    let temp = state.path.with_extension(format!("backup-{}.tmp", std::process::id()));
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        // VACUUM INTO requires a string literal — escape any single
        // quotes in the path (rare on app_data_dir but defensive).
        let path_escaped = temp.display().to_string().replace('\'', "''");
        conn.execute(&format!("VACUUM INTO '{path_escaped}'"), [])
            .map_err(|e| format!("VACUUM INTO: {e}"))?;
    }
    let bytes = std::fs::read(&temp)
        .map_err(|e| format!("read snapshot {}: {e}", temp.display()))?;
    let _ = std::fs::remove_file(&temp);
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Restore the database from base64-encoded SQLite file bytes. Writes
/// the bytes to a sibling temp file, closes the live connection,
/// atomically renames the temp over the live DB, removes any WAL /
/// SHM sidecars from the old DB, and re-opens. Migrations are
/// re-applied on the next open by the runner on the JS side (the
/// caller's responsibility — typically a page reload follows).
#[tauri::command]
pub fn sql_restore_from_bytes(
    state: State<'_, SqlState>,
    bytes: String,
) -> Result<(), String> {
    if state.path.as_os_str().is_empty() {
        return Err("sql_restore_from_bytes: no on-disk database".into());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(bytes.as_bytes())
        .map_err(|e| format!("base64 decode: {e}"))?;

    let temp = state.path.with_extension(format!("restore-{}.tmp", std::process::id()));
    std::fs::write(&temp, &decoded)
        .map_err(|e| format!("write temp {}: {e}", temp.display()))?;

    // Swap the live connection with a throwaway in-memory one so the
    // file is closed before we replace it on disk. Placeholder
    // pattern lets us keep `Mutex<Connection>` (no Option<>).
    {
        let mut guard = state.conn.lock().map_err(|e| e.to_string())?;
        let placeholder = Connection::open_in_memory()
            .map_err(|e| format!("placeholder open: {e}"))?;
        let old = std::mem::replace(&mut *guard, placeholder);
        drop(old);

        // Replace the active DB file. `rename` is atomic on the same
        // filesystem (always true here — both files in app_data_dir).
        std::fs::rename(&temp, &state.path).map_err(|e| {
            // Best-effort cleanup of the temp file if the rename failed.
            let _ = std::fs::remove_file(&temp);
            format!("rename {} → {}: {e}", temp.display(), state.path.display())
        })?;

        // Old WAL/SHM sidecars reference the pre-restore page checksums;
        // delete them so the new DB opens with fresh ones.
        let _ = std::fs::remove_file(
            state.path.with_extension(
                state
                    .path
                    .extension()
                    .map(|e| format!("{}-wal", e.to_string_lossy()))
                    .unwrap_or_else(|| "wal".into()),
            ),
        );
        let _ = std::fs::remove_file(
            state.path.with_extension(
                state
                    .path
                    .extension()
                    .map(|e| format!("{}-shm", e.to_string_lossy()))
                    .unwrap_or_else(|| "shm".into()),
            ),
        );

        let fresh = Connection::open(&state.path)
            .map_err(|e| format!("reopen after restore: {e}"))?;
        apply_default_pragmas(&fresh)
            .map_err(|e| format!("pragmas after restore: {e}"))?;
        *guard = fresh;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Test helper: bypass the Tauri State wrapper and call the same
    /// core path the commands run. Mirrors `sql_exec`'s body.
    fn exec(
        state: &SqlState,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<u64, String> {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let sql_params: Vec<SqlValue> = params.into_iter().map(json_to_sql).collect();
        conn.execute(sql, params_from_iter(sql_params))
            .map(|n| n as u64)
            .map_err(|e| format!("exec: {e}"))
    }

    /// Test helper: mirrors `sql_query`'s body.
    fn query(
        state: &SqlState,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, String> {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let sql_params: Vec<SqlValue> = params.into_iter().map(json_to_sql).collect();
        let mut stmt = conn.prepare(sql).map_err(|e| format!("prep: {e}"))?;
        let col_count = stmt.column_count();
        let mut rows = stmt
            .query(params_from_iter(sql_params))
            .map_err(|e| format!("q: {e}"))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| format!("row: {e}"))? {
            let mut r = Vec::with_capacity(col_count);
            for i in 0..col_count {
                r.push(sql_to_json(
                    row.get_ref(i).map_err(|e| format!("col: {e}"))?,
                ));
            }
            out.push(r);
        }
        Ok(out)
    }

    #[test]
    fn create_insert_select_roundtrip() {
        let s = SqlState::open_in_memory().unwrap();
        exec(
            &s,
            "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
            vec![],
        )
        .unwrap();
        let n = exec(
            &s,
            "INSERT INTO t (id, name, age) VALUES (?, ?, ?)",
            vec![json!(1), json!("alice"), json!(30)],
        )
        .unwrap();
        assert_eq!(n, 1);
        exec(
            &s,
            "INSERT INTO t (id, name, age) VALUES (?, ?, ?)",
            vec![json!(2), json!("bob"), json!(25)],
        )
        .unwrap();

        let rows = query(&s, "SELECT id, name, age FROM t ORDER BY id", vec![]).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], vec![json!(1), json!("alice"), json!(30)]);
        assert_eq!(rows[1], vec![json!(2), json!("bob"), json!(25)]);
    }

    #[test]
    fn null_text_real_bool_values() {
        let s = SqlState::open_in_memory().unwrap();
        exec(&s, "CREATE TABLE t (a, b, c, d)", vec![]).unwrap();
        exec(
            &s,
            "INSERT INTO t VALUES (?, ?, ?, ?)",
            vec![json!(null), json!("hello"), json!(3.14), json!(true)],
        )
        .unwrap();
        let rows = query(&s, "SELECT a, b, c, d FROM t", vec![]).unwrap();
        assert_eq!(rows[0][0], serde_json::Value::Null);
        assert_eq!(rows[0][1], json!("hello"));
        if let serde_json::Value::Number(n) = &rows[0][2] {
            let f = n.as_f64().unwrap();
            assert!((f - 3.14).abs() < 1e-9);
        } else {
            panic!("expected number, got {:?}", rows[0][2]);
        }
        // SQLite stores booleans as INTEGER 0/1; we round-trip the
        // integer back to JS — Drizzle's column type tags handle the
        // boolean reconstruction on the consumer side.
        assert_eq!(rows[0][3], json!(1));
    }

    #[test]
    fn blob_round_trips_as_base64() {
        let s = SqlState::open_in_memory().unwrap();
        {
            let conn = s.conn.lock().unwrap();
            conn.execute("CREATE TABLE b (x BLOB)", []).unwrap();
            conn.execute("INSERT INTO b VALUES (?)", [&[0u8, 1, 2, 3][..]])
                .unwrap();
        }
        let rows = query(&s, "SELECT x FROM b", vec![]).unwrap();
        // base64-encoded [0,1,2,3] is "AAECAw=="
        assert_eq!(rows[0][0], json!("AAECAw=="));
    }

    #[test]
    fn explicit_transaction_rollback_then_commit() {
        let s = SqlState::open_in_memory().unwrap();
        exec(&s, "CREATE TABLE t (id INTEGER PRIMARY KEY)", vec![]).unwrap();

        exec(&s, "BEGIN", vec![]).unwrap();
        exec(&s, "INSERT INTO t (id) VALUES (?)", vec![json!(1)]).unwrap();
        exec(&s, "INSERT INTO t (id) VALUES (?)", vec![json!(2)]).unwrap();
        exec(&s, "ROLLBACK", vec![]).unwrap();
        assert_eq!(
            query(&s, "SELECT COUNT(*) FROM t", vec![]).unwrap()[0][0],
            json!(0)
        );

        exec(&s, "BEGIN", vec![]).unwrap();
        exec(&s, "INSERT INTO t (id) VALUES (?)", vec![json!(3)]).unwrap();
        exec(&s, "COMMIT", vec![]).unwrap();
        assert_eq!(
            query(&s, "SELECT COUNT(*) FROM t", vec![]).unwrap()[0][0],
            json!(1)
        );
    }

    #[test]
    fn foreign_keys_enforced_per_pragma() {
        let s = SqlState::open_in_memory().unwrap();
        exec(&s, "CREATE TABLE parent (id INTEGER PRIMARY KEY)", vec![]).unwrap();
        exec(
            &s,
            "CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))",
            vec![],
        )
        .unwrap();
        let err = exec(
            &s,
            "INSERT INTO child (id, pid) VALUES (?, ?)",
            vec![json!(1), json!(999)],
        )
        .unwrap_err();
        assert!(err.contains("FOREIGN KEY"), "expected FK error, got {err}");
    }

    /// Allocate a private SQLite file path in the system temp dir.
    /// Returned closure cleans it up (incl. WAL/SHM sidecars).
    fn temp_db_path(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "hipo-sql-test-{label}-{}-{nanos}.sqlite",
            std::process::id(),
        ))
    }

    fn clean_db(p: &Path) {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(p.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(p.with_extension("sqlite-shm"));
    }

    #[test]
    fn backup_to_bytes_returns_valid_sqlite_snapshot() {
        let p = temp_db_path("backup");
        {
            let s = SqlState::open(&p).unwrap();
            exec(
                &s,
                "CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)",
                vec![],
            )
            .unwrap();
            exec(
                &s,
                "INSERT INTO t (id, x) VALUES (?, ?)",
                vec![json!(1), json!("hello")],
            )
            .unwrap();

            // Call the backup command path directly (test helper
            // bypasses the State<> wrapper but exercises the same
            // body — VACUUM INTO + read + base64).
            let base64 = {
                let temp =
                    s.path.with_extension(format!("backup-{}.tmp", std::process::id()));
                let path_escaped =
                    temp.display().to_string().replace('\'', "''");
                {
                    let conn = s.conn.lock().unwrap();
                    conn.execute(&format!("VACUUM INTO '{path_escaped}'"), [])
                        .unwrap();
                }
                let bytes = std::fs::read(&temp).unwrap();
                let _ = std::fs::remove_file(&temp);
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            };

            // SQLite files always start with the literal header
            // "SQLite format 3\0". Decode and verify.
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&base64)
                .unwrap();
            assert!(bytes.len() > 16, "snapshot too small");
            assert_eq!(&bytes[..16], b"SQLite format 3\0");

            // Round-trip: write the bytes back to a sibling file and
            // open it; data should survive.
            let restored = temp_db_path("restored");
            std::fs::write(&restored, &bytes).unwrap();
            let r = Connection::open(&restored).unwrap();
            let count: i64 = r
                .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
                .unwrap();
            assert_eq!(count, 1);
            let x: String = r
                .query_row("SELECT x FROM t WHERE id = 1", [], |row| row.get(0))
                .unwrap();
            assert_eq!(x, "hello");
            drop(r);
            clean_db(&restored);
        }
        clean_db(&p);
    }

    #[test]
    fn restore_replaces_live_db_in_place() {
        // Create source DB with one row; capture its bytes.
        let src_path = temp_db_path("restore-src");
        let snapshot: Vec<u8> = {
            let s = SqlState::open(&src_path).unwrap();
            exec(&s, "CREATE TABLE m (k TEXT, v TEXT)", vec![]).unwrap();
            exec(
                &s,
                "INSERT INTO m VALUES (?, ?)",
                vec![json!("greeting"), json!("hola")],
            )
            .unwrap();
            // VACUUM INTO a sibling and read it.
            let temp = src_path
                .with_extension(format!("snap-{}.tmp", std::process::id()));
            let path_escaped =
                temp.display().to_string().replace('\'', "''");
            {
                let conn = s.conn.lock().unwrap();
                conn.execute(&format!("VACUUM INTO '{path_escaped}'"), [])
                    .unwrap();
            }
            let b = std::fs::read(&temp).unwrap();
            let _ = std::fs::remove_file(&temp);
            b
        };
        clean_db(&src_path);

        // Target DB with different contents we want to clobber.
        let tgt_path = temp_db_path("restore-tgt");
        let s = SqlState::open(&tgt_path).unwrap();
        exec(&s, "CREATE TABLE m (k TEXT, v TEXT)", vec![]).unwrap();
        exec(
            &s,
            "INSERT INTO m VALUES (?, ?)",
            vec![json!("greeting"), json!("hello")],
        )
        .unwrap();

        // Inline the restore body (test helper — same as the command).
        let base64 = base64::engine::general_purpose::STANDARD.encode(&snapshot);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(base64.as_bytes())
            .unwrap();
        let temp = s
            .path
            .with_extension(format!("restore-{}.tmp", std::process::id()));
        std::fs::write(&temp, &decoded).unwrap();
        {
            let mut guard = s.conn.lock().unwrap();
            let placeholder = Connection::open_in_memory().unwrap();
            let old = std::mem::replace(&mut *guard, placeholder);
            drop(old);
            std::fs::rename(&temp, &s.path).unwrap();
            let fresh = Connection::open(&s.path).unwrap();
            apply_default_pragmas(&fresh).unwrap();
            *guard = fresh;
        }

        // After restore, the target's data is the source's.
        let rows = query(&s, "SELECT k, v FROM m", vec![]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], vec![json!("greeting"), json!("hola")]);

        drop(s);
        clean_db(&tgt_path);
    }

    #[test]
    fn opens_on_disk_with_wal_pragma() {
        // Hand-rolled temp file location — avoids an extra dev-dep
        // on `tempfile`. PID + nanos to keep test runs from
        // colliding on shared CI workers.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "hipo-sql-test-{}-{nanos}.sqlite",
            std::process::id(),
        ));
        let s = SqlState::open(&p).unwrap();
        let mode = query(&s, "PRAGMA journal_mode", vec![]).unwrap();
        // SQLite returns the active mode as TEXT, lowercase.
        assert_eq!(mode[0][0], json!("wal"));
        drop(s);
        assert!(p.exists());
        // Best-effort cleanup; also remove WAL sidecar files.
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(p.with_extension("sqlite-shm"));
    }
}
