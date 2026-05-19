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

use std::path::Path;
use std::sync::Mutex;

use base64::Engine;
use rusqlite::{
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use tauri::State;

/// Tauri-managed state wrapping the single rusqlite `Connection`.
pub struct SqlState {
    conn: Mutex<Connection>,
}

impl SqlState {
    /// Open (or create) a SQLite database at `path` and configure
    /// pragmas matching the libsql / sqlocal defaults used on the
    /// other shapes (WAL, foreign keys on, NORMAL synchronous).
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory open, used by the test suite.
    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self {
            conn: Mutex::new(conn),
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
