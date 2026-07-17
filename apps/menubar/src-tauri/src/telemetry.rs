//! The GUI's window onto the engine's telemetry SQLite (C-0017).
//!
//! Two halves, split exactly the way D6/D19/D20 mandate:
//!
//! * **Reads** are SELECT-only over the engine's *views* (`v_change`, `v_task`,
//!   `v_change_baseline`), served straight to the webview as JSON rows by
//!   `rusqlite`. The Insights pane owns the shape, so each command is a thin
//!   view→JSON pipe rather than a typed projection — a new view column reaches
//!   React without touching Rust. A missing `.db` degrades to an **empty**
//!   response (OQ3): a change recorded before C-0017 — or a run without
//!   `metrics:` — simply has no telemetry, and that must never crash the tab.
//!
//! * **Writes** never touch this connection. Verdicts, bugs and change-status
//!   changes are one-shot `loopy` CLI invocations (the same subprocess pattern
//!   as [`crate::project_fs::probe_agent`]), so the engine/CLI stays the single
//!   writer of the `.db` and the webview is never handed a raw SQL surface.
//!
//! The connection is opened **read-write without CREATE**, not `READ_ONLY`, on
//! purpose: a WAL database has a live writer (the running engine), and a WAL
//! reader must be able to write the `-shm` shared-memory index to register its
//! read-mark. `SQLITE_OPEN_READ_ONLY` forbids that and fails against an active
//! writer — which is exactly when the tab shows the in-flight change. SELECT-only
//! is enforced by *what we execute* (only `SELECT`s), not by the open flag.

use rusqlite::functions::FunctionFlags;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::sidecar;

// ---------------------------------------------------------------------------
// Read side — SELECT-only over the telemetry views (D6/D19)
// ---------------------------------------------------------------------------

/// The engine writes telemetry to `<dir>/.db/telemetry.db` (mirrors
/// `telemetryDbPath` in `src/index.ts`). This is the only place the path is built.
fn telemetry_db_path(dir: &str) -> PathBuf {
    Path::new(dir).join(".db").join("telemetry.db")
}

/// Open the telemetry `.db` for reading, or `None` when it doesn't exist yet.
///
/// A missing file is **not** an error (OQ3): the caller returns an empty result
/// so the Insights tab shows "no telemetry" instead of crashing. Only a genuine
/// open failure (permissions, corruption) propagates as `Err`. Opened
/// read-write-without-CREATE so a WAL reader can map the `-shm` index while the
/// engine is still writing (see the module docs).
fn open_readonly(dir: &str) -> Result<Option<Connection>, String> {
    let path = telemetry_db_path(dir);
    if !path.exists() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open telemetry db: {e}"))?;
    // Safety net for the concurrent engine writer (D9): wait rather than fail
    // with SQLITE_BUSY if a checkpoint is briefly holding the file.
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;
    register_math_functions(&conn)?;
    Ok(Some(conn))
}

/// Register the math functions the views need but the bundled SQLite lacks.
///
/// `v_change_baseline` computes the population std-dev as
/// `sqrt(avg(x*x) - avg(x)*avg(x))` (D17), yet this crate's bundled SQLite is
/// built without `SQLITE_ENABLE_MATH_FUNCTIONS`, so `sqrt()` is missing. The
/// engine's writers (node:sqlite / bun:sqlite) have it natively; the Rust reader
/// is the sole reader of the views (D19), so it supplies `sqrt` here to keep the
/// same result. NULL passes through as NULL (SQLite `max`/`avg` yield NULL when a
/// metric has no rows), so the aggregate stays well-defined with zero merged
/// changes.
fn register_math_functions(conn: &Connection) -> Result<(), String> {
    conn.create_scalar_function(
        "sqrt",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let x: Option<f64> = ctx.get(0)?;
            Ok(x.map(f64::sqrt))
        },
    )
    .map_err(|e| format!("Failed to register sqrt(): {e}"))
}

/// Run `sql` and return every row as a JSON object (`column name → value`),
/// driven entirely by the statement's own column set — no column is enumerated
/// in Rust, so the view is the single source of shape.
fn query_rows<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Failed to prepare query: {e}"))?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows = stmt
        .query(params)
        .map_err(|e| format!("Failed to run query: {e}"))?;

    let mut out = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to read row: {e}"))?
    {
        let mut obj = Map::with_capacity(columns.len());
        for (i, name) in columns.iter().enumerate() {
            let value = row
                .get_ref(i)
                .map_err(|e| format!("Failed to read column {name}: {e}"))?;
            obj.insert(name.clone(), value_ref_to_json(value));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

/// Map a raw SQLite value onto JSON. The views return only NULL/INTEGER/REAL/TEXT;
/// BLOB is handled defensively (byte array) though no view column produces one.
fn value_ref_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Value::Array(bytes.iter().map(|&b| Value::from(b)).collect()),
    }
}

/// Open the telemetry `.db`, run `sql`, and return its rows — or an empty vec
/// when the `.db` doesn't exist yet. Every read command funnels through here, so
/// the "missing db degrades to empty" rule (OQ3) lives in exactly one place.
fn query_view<P: rusqlite::Params>(
    dir: &str,
    sql: &str,
    params: P,
) -> Result<Vec<Value>, String> {
    let Some(conn) = open_readonly(dir)? else {
        return Ok(Vec::new());
    };
    query_rows(&conn, sql, params)
}

/// Every change known to the telemetry `.db`, newest first — the source for the
/// tab's "this change" selection and the comparison-target dropdown (D22).
#[tauri::command]
pub fn read_change_list(dir: String) -> Result<Vec<Value>, String> {
    query_view(
        &dir,
        "SELECT * FROM v_change ORDER BY created_at DESC, change_id DESC",
        [],
    )
}

/// The aggregated row for one change (`v_change`) — the header column for either
/// "this change" or the comparison target. Zero rows when the id is unknown.
#[tauri::command]
pub fn read_change_insights(dir: String, change_id: String) -> Result<Vec<Value>, String> {
    query_view(
        &dir,
        "SELECT * FROM v_change WHERE change_id = ?1",
        [change_id.as_str()],
    )
}

/// The per-task rows of a change (`v_task`), ordered by task number — the tab's
/// task list, including the escaped-defect signal (`status='merged'` +
/// `human_verdict='fail'`, D23).
#[tauri::command]
pub fn read_task_insights(dir: String, change_id: String) -> Result<Vec<Value>, String> {
    query_view(
        &dir,
        "SELECT * FROM v_task WHERE change_id = ?1 ORDER BY task_number",
        [change_id.as_str()],
    )
}

/// The per-attempt rows of a task (`v_step`), ordered by `seq` — the timeline the
/// task list expands into (SC1: per-attempt cost). Each row is one Tentativa (D3),
/// carrying its own tokens/cost/duration plus the resolved preset/model/mode/effort.
#[tauri::command]
pub fn read_step_insights(dir: String, task_id: String) -> Result<Vec<Value>, String> {
    query_view(
        &dir,
        "SELECT * FROM v_step WHERE task_id = ?1 ORDER BY seq",
        [task_id.as_str()],
    )
}

/// The historical baseline over merged changes (`v_change_baseline`): mean and
/// population std-dev per metric (D17). Always a single row (an ungrouped
/// aggregate: `n=0` with NULL means when no change has merged yet).
#[tauri::command]
pub fn read_baseline(dir: String) -> Result<Vec<Value>, String> {
    query_view(&dir, "SELECT * FROM v_change_baseline", [])
}

/// Whether `<dir>/.db/telemetry.db` exists. The read commands degrade a missing
/// file AND an empty `v_change` to the same empty response (OQ3), so the tab
/// needs this to tell them apart: "no telemetry file yet" and "a `.db` with no
/// recorded change" get different empty-state messages — the second must never
/// claim the file is absent when it is not.
#[tauri::command]
pub fn telemetry_db_exists(dir: String) -> bool {
    telemetry_db_path(&dir).exists()
}

// ---------------------------------------------------------------------------
// Write side — one-shot `loopy` CLI invocations (D6/D20)
// ---------------------------------------------------------------------------

/// Spawn `loopy <args>` one-shot and return its trimmed stdout, mirroring
/// [`crate::project_fs::probe_agent`]: the same sidecar-binary resolution and
/// login-shell PATH recovery so the CLI resolves inside a `.app` bundle. The CLI
/// is the single writer of the `.db` (D6) — the GUI never mutates it directly.
fn run_annotation(args: &[String]) -> Result<String, String> {
    let bin = sidecar::resolve_sidecar_path()?;

    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Recover the login-shell PATH so the CLI resolves inside a `.app` bundle,
    // which otherwise runs with launchd's minimal PATH — same as `probe_agent`.
    if let Some(path) = sidecar::login_shell_path() {
        cmd.env("PATH", path);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to spawn loopy: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let verb = args.first().map(String::as_str).unwrap_or("loopy");
        Err(format!("loopy {verb} failed: {}", stderr.trim()))
    }
}

/// Append `--flag value` to `args` when `value` is present and non-empty; a
/// `None` or empty string contributes nothing. The argv builders share this for
/// their optional flags (`--note`/`--by`/`--detail`/`--found-in`/`--change`).
fn push_optional(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|v| !v.is_empty()) {
        args.push(flag.into());
        args.push(value.into());
    }
}

/// Build the argv for a verdict mutation. `pass`/`fail` upsert via `verdict set`;
/// `clear` deletes the row via `verdict clear` (the tri-state's "not rated", D20)
/// and ignores `note`/`by`, which have no meaning there.
fn verdict_args(
    dir: &str,
    task: &str,
    verdict: &str,
    note: Option<&str>,
    by: Option<&str>,
) -> Result<Vec<String>, String> {
    if verdict == "clear" {
        return Ok(vec![
            "verdict".into(),
            "clear".into(),
            dir.into(),
            "--task".into(),
            task.into(),
        ]);
    }
    let flag = match verdict {
        "pass" => "--pass",
        "fail" => "--fail",
        other => return Err(format!("unknown verdict '{other}' (expected pass|fail|clear)")),
    };
    let mut args: Vec<String> = vec![
        "verdict".into(),
        "set".into(),
        dir.into(),
        "--task".into(),
        task.into(),
        flag.into(),
    ];
    push_optional(&mut args, "--note", note);
    push_optional(&mut args, "--by", by);
    Ok(args)
}

/// Build the argv for `bug add`. Severity/title validation lives in the CLI; the
/// bridge only forwards. Optional `--detail`/`--found-in` are appended when set.
fn bug_args(
    dir: &str,
    task: &str,
    severity: &str,
    title: &str,
    detail: Option<&str>,
    found_in: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "bug".into(),
        "add".into(),
        dir.into(),
        "--task".into(),
        task.into(),
        "--severity".into(),
        severity.into(),
        "--title".into(),
        title.into(),
    ];
    push_optional(&mut args, "--detail", detail);
    push_optional(&mut args, "--found-in", found_in);
    args
}

/// Build the argv for closing a change dimension out of the `merged` path (D2/D20).
fn change_status_args(
    dir: &str,
    status: &str,
    change_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let flag = match status {
        "abandoned" => "--abandoned",
        "failed" => "--failed",
        other => {
            return Err(format!(
                "unknown change status '{other}' (expected abandoned|failed)"
            ))
        }
    };
    let mut args: Vec<String> = vec!["change".into(), dir.into(), flag.into()];
    push_optional(&mut args, "--change", change_id);
    Ok(args)
}

/// Set (or clear) a task's human verdict via the CLI. `verdict` is
/// `"pass"`/`"fail"`/`"clear"`; the tri-state reverter passes `"clear"`.
#[tauri::command]
pub async fn insights_set_verdict(
    dir: String,
    task: String,
    verdict: String,
    note: Option<String>,
    by: Option<String>,
) -> Result<String, String> {
    let args = verdict_args(&dir, &task, &verdict, note.as_deref(), by.as_deref())?;
    run_annotation(&args)
}

/// Add a bug linked to a task via the CLI (a bug of a prior change is normal, D14).
#[tauri::command]
pub async fn insights_add_bug(
    dir: String,
    task: String,
    severity: String,
    title: String,
    detail: Option<String>,
    found_in: Option<String>,
) -> Result<String, String> {
    let args = bug_args(
        &dir,
        &task,
        &severity,
        &title,
        detail.as_deref(),
        found_in.as_deref(),
    );
    run_annotation(&args)
}

/// Close a change as `abandoned`/`failed` via the CLI (the non-`merged` path, D2).
#[tauri::command]
pub async fn insights_set_change_status(
    dir: String,
    status: String,
    change_id: Option<String>,
) -> Result<String, String> {
    let args = change_status_args(&dir, &status, change_id.as_deref())?;
    run_annotation(&args)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    // The real DDL — seeding with it proves the views (and `sqrt()` in
    // `v_change_baseline`) work against the *bundled* SQLite this crate links,
    // not just against node:sqlite. `include_str!` is compile-time and confined
    // to tests, so production never embeds the schema.
    const SCHEMA: &str = include_str!("../../../../src/telemetry/schema.sql");

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("loopy-telemetry-{}-{name}", std::process::id()))
    }

    /// Create `<dir>/.db/telemetry.db`, apply the schema, and seed one merged
    /// change / task / passing step so every view returns rows.
    fn seed_db(dir: &Path) {
        let db_dir = dir.join(".db");
        fs::create_dir_all(&db_dir).unwrap();
        let conn = Connection::open(db_dir.join("telemetry.db")).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(
            "INSERT INTO change
               (change_id,name,repo,base_sha,pipeline_version,created_at,ended_at,status)
             VALUES
               ('C-0017','telemetry','loopy',NULL,'pv1',
                '2026-07-15T00:00:00Z','2026-07-15T01:00:00Z','merged');
             INSERT INTO task
               (task_id,change_id,task_number,name,created_at,ended_at,status,
                size_files,size_added,size_removed)
             VALUES
               ('C-0017/T-001','C-0017','T-001','seed task',
                '2026-07-15T00:00:00Z','2026-07-15T00:30:00Z','merged',1,10,2);
             INSERT INTO step
               (step_id,task_id,change_id,seq,name,kind,visit_no,attempt_no,
                started_at,ended_at,status,cost_usd)
             VALUES
               ('s1','C-0017/T-001','C-0017',1,'build','agent',1,1,
                '2026-07-15T00:00:00Z','2026-07-15T00:10:00Z','pass',0.5);",
        )
        .unwrap();
        drop(conn);
    }

    // -- read side ----------------------------------------------------------

    #[test]
    fn db_path_lives_under_dot_db() {
        assert_eq!(
            telemetry_db_path("/proj"),
            Path::new("/proj/.db/telemetry.db")
        );
    }

    /// OQ3: a directory without a telemetry `.db` yields empty responses, never
    /// an error — the Insights tab must degrade to "no telemetry" without crashing.
    #[test]
    fn missing_db_degrades_to_empty() {
        let dir = temp_dir("missing");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();

        assert_eq!(read_change_list(d.clone()).unwrap(), Vec::<Value>::new());
        assert_eq!(
            read_change_insights(d.clone(), "C-0017".into()).unwrap(),
            Vec::<Value>::new()
        );
        assert_eq!(
            read_task_insights(d.clone(), "C-0017".into()).unwrap(),
            Vec::<Value>::new()
        );
        assert_eq!(read_baseline(d).unwrap(), Vec::<Value>::new());

        let _ = fs::remove_dir_all(&dir);
    }

    /// `telemetry_db_exists` is what lets the tab distinguish "no `.db` file"
    /// from "a `.db` whose views return zero rows" — the reads alone cannot.
    #[test]
    fn db_exists_tells_missing_file_from_empty_views() {
        let dir = temp_dir("exists");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();

        assert!(!telemetry_db_exists(d.clone()));

        // Schema-only db (the stale-engine / killed-run case): file exists,
        // v_change is empty — reads stay empty but existence flips to true.
        let db_dir = dir.join(".db");
        fs::create_dir_all(&db_dir).unwrap();
        let conn = Connection::open(db_dir.join("telemetry.db")).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        drop(conn);

        assert!(telemetry_db_exists(d.clone()));
        assert_eq!(read_change_list(d).unwrap(), Vec::<Value>::new());

        let _ = fs::remove_dir_all(&dir);
    }

    /// A seeded `.db` returns rows from every view, with types mapped onto JSON
    /// (TEXT→string, REAL→number, NULL→null, INTEGER→number).
    #[test]
    fn reads_seeded_rows() {
        let dir = temp_dir("seeded");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        seed_db(&dir);
        let d = dir.to_string_lossy().to_string();

        let changes = read_change_list(d.clone()).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["change_id"].as_str(), Some("C-0017"));

        let insights = read_change_insights(d.clone(), "C-0017".into()).unwrap();
        assert_eq!(insights.len(), 1);
        assert_eq!(insights[0]["cost_usd"].as_f64(), Some(0.5)); // REAL → number
        assert!(insights[0]["base_sha"].is_null()); // NULL → null

        let tasks = read_task_insights(d.clone(), "C-0017".into()).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["task_id"].as_str(), Some("C-0017/T-001"));
        assert_eq!(tasks[0]["first_pass"].as_i64(), Some(1)); // INTEGER → number

        // Exercises sqrt() in v_change_baseline — proves the `sqrt` we register
        // in `register_math_functions` stands in for the bundled SQLite's missing
        // SQLITE_ENABLE_MATH_FUNCTIONS.
        let baseline = read_baseline(d).unwrap();
        assert_eq!(baseline.len(), 1);
        assert_eq!(baseline[0]["n"].as_i64(), Some(1));

        let _ = fs::remove_dir_all(&dir);
    }

    /// A task's `v_step` rows are read per-attempt (SC1), ordered by `seq`, with the
    /// step's own cost mapped onto JSON — the timeline the task list expands into.
    #[test]
    fn reads_step_rows_for_a_task() {
        let dir = temp_dir("steps");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        seed_db(&dir);
        let d = dir.to_string_lossy().to_string();

        let steps = read_step_insights(d.clone(), "C-0017/T-001".into()).unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0]["step_id"].as_str(), Some("s1"));
        assert_eq!(steps[0]["attempt_no"].as_i64(), Some(1));
        assert_eq!(steps[0]["cost_usd"].as_f64(), Some(0.5)); // REAL → number

        // An unknown task reads empty, never errors.
        assert!(read_step_insights(d, "C-9999/T-404".into())
            .unwrap()
            .is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    /// An unknown change id reads empty (not an error) for the per-change views.
    #[test]
    fn unknown_change_reads_empty() {
        let dir = temp_dir("unknown");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        seed_db(&dir);
        let d = dir.to_string_lossy().to_string();

        assert!(read_change_insights(d.clone(), "C-9999".into())
            .unwrap()
            .is_empty());
        assert!(read_task_insights(d, "C-9999".into()).unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    // -- write side (argv builders) -----------------------------------------

    #[test]
    fn verdict_args_pass_fail_clear() {
        assert_eq!(
            verdict_args("/p", "C/T-1", "pass", None, None).unwrap(),
            vec!["verdict", "set", "/p", "--task", "C/T-1", "--pass"]
        );
        assert_eq!(
            verdict_args("/p", "C/T-1", "fail", Some("bad"), Some("me")).unwrap(),
            vec!["verdict", "set", "/p", "--task", "C/T-1", "--fail", "--note", "bad", "--by", "me"]
        );
        // clear ignores note/by and takes the `verdict clear` path.
        assert_eq!(
            verdict_args("/p", "C/T-1", "clear", Some("ignored"), Some("ignored")).unwrap(),
            vec!["verdict", "clear", "/p", "--task", "C/T-1"]
        );
        assert!(verdict_args("/p", "C/T-1", "bogus", None, None).is_err());
    }

    #[test]
    fn bug_args_appends_optionals() {
        assert_eq!(
            bug_args("/p", "C/T-1", "high", "title", None, None),
            vec!["bug", "add", "/p", "--task", "C/T-1", "--severity", "high", "--title", "title"]
        );
        assert_eq!(
            bug_args("/p", "C/T-1", "low", "t", Some("d"), Some("C-0001")),
            vec![
                "bug", "add", "/p", "--task", "C/T-1", "--severity", "low", "--title", "t",
                "--detail", "d", "--found-in", "C-0001"
            ]
        );
    }

    #[test]
    fn change_status_args_maps_flags() {
        assert_eq!(
            change_status_args("/p", "abandoned", None).unwrap(),
            vec!["change", "/p", "--abandoned"]
        );
        assert_eq!(
            change_status_args("/p", "failed", Some("C-0017")).unwrap(),
            vec!["change", "/p", "--failed", "--change", "C-0017"]
        );
        assert!(change_status_args("/p", "bogus", None).is_err());
    }
}
