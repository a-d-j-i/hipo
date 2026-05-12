use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        r#"
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        username      TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        role          TEXT    NOT NULL CHECK(role IN ('admin', 'user')),
        created_at    INTEGER NOT NULL
    );
    "#,
    ),
    (
        2,
        r#"
    CREATE TABLE parties (
        id           INTEGER PRIMARY KEY,
        kind         TEXT    NOT NULL CHECK(kind IN ('lender', 'debtor', 'both')),
        name         TEXT    NOT NULL,
        external_ref TEXT,
        notes        TEXT,
        created_at   INTEGER NOT NULL,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_parties_name ON parties(name);
    CREATE INDEX idx_parties_kind ON parties(kind);

    CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY,
        at          INTEGER NOT NULL,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT    NOT NULL,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER,
        payload     TEXT
    );
    CREATE INDEX idx_audit_log_at ON audit_log(at DESC);
    CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
    "#,
    ),
    (
        3,
        r#"
    CREATE TABLE loans (
        id              INTEGER PRIMARY KEY,
        reference       TEXT,
        debtor_id       INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        currency_code   TEXT    NOT NULL CHECK(length(currency_code) = 3),
        principal_cents INTEGER NOT NULL CHECK(principal_cents > 0),
        interest_cents  INTEGER NOT NULL DEFAULT 0 CHECK(interest_cents >= 0),
        issued_at       INTEGER NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
        notes           TEXT,
        created_at      INTEGER NOT NULL,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_loans_debtor ON loans(debtor_id);
    CREATE INDEX idx_loans_status ON loans(status);

    CREATE TABLE loan_lenders (
        loan_id           INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
        lender_id         INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        amount_lent_cents INTEGER NOT NULL CHECK(amount_lent_cents > 0),
        PRIMARY KEY (loan_id, lender_id)
    );
    CREATE INDEX idx_loan_lenders_lender ON loan_lenders(lender_id);
    "#,
    ),
    (
        4,
        r#"
    CREATE TABLE debtor_payments (
        id            INTEGER PRIMARY KEY,
        loan_id       INTEGER NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
        amount_cents  INTEGER NOT NULL CHECK(amount_cents > 0),
        paid_at       INTEGER NOT NULL,
        notes         TEXT,
        created_at    INTEGER NOT NULL,
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_debtor_payments_loan ON debtor_payments(loan_id);
    CREATE INDEX idx_debtor_payments_paid_at ON debtor_payments(paid_at DESC);

    CREATE TABLE debtor_payment_splits (
        payment_id    INTEGER NOT NULL REFERENCES debtor_payments(id) ON DELETE CASCADE,
        lender_id     INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        amount_cents  INTEGER NOT NULL CHECK(amount_cents > 0),
        PRIMARY KEY (payment_id, lender_id)
    );
    CREATE INDEX idx_payment_splits_lender ON debtor_payment_splits(lender_id);
    "#,
    ),
    (
        5,
        r#"
    CREATE TABLE lender_payouts (
        id            INTEGER PRIMARY KEY,
        lender_id     INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        currency_code TEXT    NOT NULL CHECK(length(currency_code) = 3),
        amount_cents  INTEGER NOT NULL CHECK(amount_cents > 0),
        paid_at       INTEGER NOT NULL,
        notes         TEXT,
        created_at    INTEGER NOT NULL,
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_lender_payouts_lender ON lender_payouts(lender_id);
    CREATE INDEX idx_lender_payouts_paid_at ON lender_payouts(paid_at DESC);
    CREATE INDEX idx_lender_payouts_currency ON lender_payouts(currency_code);
    "#,
    ),
    (
        6,
        r#"
    DROP INDEX IF EXISTS idx_parties_kind;
    ALTER TABLE parties DROP COLUMN kind;
    "#,
    ),
    (
        7,
        r#"
    ALTER TABLE users           ADD COLUMN deleted_at INTEGER;
    ALTER TABLE parties         ADD COLUMN deleted_at INTEGER;
    ALTER TABLE loans           ADD COLUMN deleted_at INTEGER;
    ALTER TABLE debtor_payments ADD COLUMN deleted_at INTEGER;
    ALTER TABLE lender_payouts  ADD COLUMN deleted_at INTEGER;
    CREATE INDEX idx_debtor_payments_deleted ON debtor_payments(deleted_at);
    CREATE INDEX idx_lender_payouts_deleted ON lender_payouts(deleted_at);
    "#,
    ),
];

pub fn open_and_migrate(path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;

    let applied: HashSet<i64> = {
        let mut stmt = conn
            .prepare("SELECT version FROM migrations")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for (version, sql) in MIGRATIONS {
        if applied.contains(version) {
            continue;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    Ok(())
}
