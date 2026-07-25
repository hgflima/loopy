//! Listing and discarding devy Changes for the Specs tab (C-0018 / T-007).
//!
//! A Change is the `.harn/devy/changes/<id>-<slug>/` folder produced by the devy
//! harness (spec/plan/todo authoring). This bridge lets the GUI enumerate them
//! and discard partial ones — **without ever destroying a file**: a discard is a
//! `rename` into `.loopy/trash/`, mirroring how `write_loopy_yml` backs the yml
//! up before overwriting. The boundary of this change is "no Rust command
//! destroys" (D21).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::project_fs::resolve_within;

/// The devy changes directory, relative to the project dir. This constant is
/// declared here and in the engine (`src/interview/phases.ts`) and nowhere else
/// — the explicit price of the harness being addressable only where devy is
/// installed (plan AD-4). It is not loop behaviour, it's the harness's address.
const CHANGES_SUBDIR: &str = ".harn/devy/changes";

/// A one-line summary of a devy Change, for the Specs list.
///
/// Serialized with serde's default (snake_case) field names, like the rest of
/// `project_fs.rs` — the frontend consumes `has_spec`, `task_count`, etc.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChangeSummary {
    /// `C-0018` — the folder-name prefix.
    pub id: String,
    /// `specs-authoring` — the folder name past the id.
    pub slug: String,
    pub has_spec: bool,
    pub has_plan: bool,
    pub has_todo: bool,
    /// Total `- [ ]` / `- [x]` lines in `todo.md` (0 when absent).
    pub task_count: usize,
    /// The `- [x]` subset of `task_count`.
    pub done_count: usize,
}

/// List the Changes under `<dir>/.harn/devy/changes/`, newest id first.
///
/// Only directories are considered — a loose `index.md` lives there too. A
/// missing changes dir yields `Ok(vec![])`, **not** an error: that's how the app
/// decides the empty state (same discipline as `read_optional`).
#[tauri::command]
pub fn read_changes(dir: String) -> Result<Vec<ChangeSummary>, String> {
    let changes_dir = Path::new(&dir).join(CHANGES_SUBDIR);

    let mut summaries: Vec<ChangeSummary> = change_dirs(&changes_dir)?
        .into_iter()
        .map(|(path, name)| summarize_change(&path, &name))
        .collect();

    // Newest first. Ids are zero-padded `C-NNNN`, so lexicographic descending is
    // numeric descending.
    summaries.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(summaries)
}

/// Discard a Change by moving its folder into `<dir>/.loopy/trash/` (D21).
///
/// **Never deletes.** A discard is a `rename` to
/// `.loopy/trash/<id>-<slug>-<epoch>/`, reversible with a `mv`, gitignored, and
/// with a direct precedent in `write_loopy_yml`'s backup. `id` comes from the
/// webview, so it is confined by [`resolve_within`] — rejecting `..` and
/// absolute paths — before any FS work.
#[tauri::command]
pub fn discard_change(dir: String, id: String) -> Result<(), String> {
    let base = Path::new(&dir);
    // Confine the webview-supplied id exactly like `read_backlog` confines its
    // path: reject `..` and absolute ids before touching the filesystem.
    resolve_within(base, &id)?;

    let changes_dir = base.join(CHANGES_SUBDIR);
    let folder =
        find_change_folder(&changes_dir, &id)?.ok_or_else(|| format!("Change not found: {id}"))?;
    let folder_name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Change folder has no name".to_string())?;

    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get epoch: {e}"))?
        .as_secs();

    let trash_dir = base.join(".loopy").join("trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("Failed to create trash dir: {e}"))?;

    let target = trash_dir.join(format!("{folder_name}-{epoch}"));
    fs::rename(&folder, &target).map_err(|e| format!("Failed to discard change: {e}"))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// The change directories under `changes_dir`, as `(path, folder_name)` pairs.
///
/// A missing changes dir yields an empty vec (**not** an error — that's how the
/// app decides the empty state); non-dir entries like the loose `index.md` are
/// skipped. Shared by [`read_changes`] and [`find_change_folder`] so both agree
/// on what counts as a Change.
fn change_dirs(changes_dir: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    if !changes_dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(changes_dir).map_err(|e| format!("Failed to list changes: {e}"))?;
    Ok(entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| (e.path(), e.file_name().to_string_lossy().to_string()))
        .collect())
}

/// Summarize one change folder: derive id/slug, probe the three `.md`, and count
/// the `todo.md` tasks (best-effort — an unreadable `todo.md` counts as 0).
fn summarize_change(path: &Path, folder_name: &str) -> ChangeSummary {
    let (id, slug) = parse_change_folder(folder_name);
    let todo_path = path.join("todo.md");
    // A missing (or unreadable) todo.md counts as 0 — `read_to_string` errors
    // on both, so no separate existence check is needed here.
    let (task_count, done_count) = fs::read_to_string(&todo_path)
        .map(|c| count_tasks(&c))
        .unwrap_or((0, 0));
    ChangeSummary {
        id,
        slug,
        has_spec: path.join("spec.md").exists(),
        has_plan: path.join("plan.md").exists(),
        has_todo: todo_path.exists(),
        task_count,
        done_count,
    }
}

/// Split `C-0018-specs-authoring` into (`C-0018`, `specs-authoring`).
///
/// The id is the `C-<num>` prefix (the first two `-`-separated parts); the slug
/// is everything after. A name with no second `-` yields an empty slug.
fn parse_change_folder(name: &str) -> (String, String) {
    let mut parts = name.splitn(3, '-');
    let first = parts.next().unwrap_or("");
    match parts.next() {
        // `first-num` is the id whenever there's a num; the slug is whatever
        // remains (everything past the second `-`), or empty.
        Some(num) => (
            format!("{first}-{num}"),
            parts.next().unwrap_or("").to_string(),
        ),
        None => (first.to_string(), String::new()),
    }
}

/// Count the task checkbox lines in a `todo.md`, returning `(total, done)`.
///
/// A task is a line (ignoring leading whitespace) starting with `- [ ]`, `- [x]`
/// or `- [X]`. `done` counts only the checked ones.
fn count_tasks(todo: &str) -> (usize, usize) {
    let mut total = 0;
    let mut done = 0;
    for line in todo.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("- [ ]") {
            total += 1;
        } else if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
            total += 1;
            done += 1;
        }
    }
    (total, done)
}

/// Locate the change directory whose derived id matches `id` (`None` when the
/// changes dir is absent or nothing matches).
fn find_change_folder(changes_dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    Ok(change_dirs(changes_dir)?
        .into_iter()
        .find(|(_, name)| parse_change_folder(name).0 == id)
        .map(|(path, _)| path))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, empty scratch dir under the OS temp dir.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn parse_change_folder_splits_id_and_slug() {
        assert_eq!(
            parse_change_folder("C-0018-specs-authoring"),
            ("C-0018".to_string(), "specs-authoring".to_string())
        );
        // Slug keeps its own hyphens.
        assert_eq!(
            parse_change_folder("C-0006-parallel-dag-scheduler"),
            ("C-0006".to_string(), "parallel-dag-scheduler".to_string())
        );
        // A one-word slug.
        assert_eq!(
            parse_change_folder("C-0001-MVP"),
            ("C-0001".to_string(), "MVP".to_string())
        );
        // No slug at all.
        assert_eq!(
            parse_change_folder("C-0002"),
            ("C-0002".to_string(), String::new())
        );
    }

    #[test]
    fn count_tasks_counts_open_and_done() {
        let todo = "\
- [ ] T-001: a
- [x] T-002: b
- [ ] T-003: c
- [x] T-004: d
some prose that is not a task
  - [ ] T-005: an indented task still counts
";
        assert_eq!(count_tasks(todo), (5, 2));
    }

    #[test]
    fn count_tasks_empty_when_no_checkboxes() {
        assert_eq!(count_tasks("# Title\n\njust prose\n"), (0, 0));
        assert_eq!(count_tasks(""), (0, 0));
    }

    /// A missing `.harn/devy/changes/` yields an empty list, not an error —
    /// that's how the app decides the empty state.
    #[test]
    fn read_changes_missing_dir_returns_empty() {
        let tmp = scratch("loopy_test_changes_missing");
        fs::create_dir_all(&tmp).unwrap(); // dir exists, but no .harn/devy/changes
        let out = read_changes(tmp.to_string_lossy().to_string()).unwrap();
        assert!(out.is_empty());
        let _ = fs::remove_dir_all(&tmp);
    }

    /// The loose `index.md` is ignored, partial changes get the right flags,
    /// tasks are counted, and the list is ordered by id descending.
    #[test]
    fn read_changes_lists_dirs_ignores_index_and_orders_desc() {
        let tmp = scratch("loopy_test_changes_list");
        let changes = tmp.join(CHANGES_SUBDIR);
        fs::create_dir_all(&changes).unwrap();
        // A loose index.md — must not be treated as a Change.
        fs::write(changes.join("index.md"), "# index\n").unwrap();

        // C-0001: partial — only spec.md.
        fs::create_dir_all(changes.join("C-0001-alpha")).unwrap();
        fs::write(changes.join("C-0001-alpha/spec.md"), "x").unwrap();

        // C-0002: full, with a todo.md of 3 tasks (1 done).
        let c2 = changes.join("C-0002-beta");
        fs::create_dir_all(&c2).unwrap();
        fs::write(c2.join("spec.md"), "x").unwrap();
        fs::write(c2.join("plan.md"), "x").unwrap();
        fs::write(
            c2.join("todo.md"),
            "- [ ] T-001: a\n- [x] T-002: b\n- [ ] T-003: c\n",
        )
        .unwrap();

        let out = read_changes(tmp.to_string_lossy().to_string()).unwrap();
        assert_eq!(out.len(), 2, "index.md must not be a Change");

        // Descending id order: C-0002 before C-0001.
        assert_eq!(out[0].id, "C-0002");
        assert_eq!(out[1].id, "C-0001");

        // Partial change: only has_spec, no tasks.
        let alpha = &out[1];
        assert_eq!(alpha.slug, "alpha");
        assert!(alpha.has_spec);
        assert!(!alpha.has_plan);
        assert!(!alpha.has_todo);
        assert_eq!(alpha.task_count, 0);
        assert_eq!(alpha.done_count, 0);

        // Full change: all three flags, correct counts.
        let beta = &out[0];
        assert_eq!(beta.slug, "beta");
        assert!(beta.has_spec && beta.has_plan && beta.has_todo);
        assert_eq!(beta.task_count, 3);
        assert_eq!(beta.done_count, 1);

        let _ = fs::remove_dir_all(&tmp);
    }

    /// Discarding moves the folder into `.loopy/trash/` — source gone, contents
    /// preserved at the destination.
    #[test]
    fn discard_change_moves_folder_to_trash() {
        let tmp = scratch("loopy_test_discard_move");
        let changes = tmp.join(CHANGES_SUBDIR);
        let folder = changes.join("C-0009-gamma");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("spec.md"), "keep me").unwrap();

        discard_change(tmp.to_string_lossy().to_string(), "C-0009".into()).unwrap();

        // Source is gone.
        assert!(!folder.exists(), "discarded folder must be moved out");

        // Exactly one trashed folder, named `<id>-<slug>-<epoch>`, with contents.
        let trash = tmp.join(".loopy").join("trash");
        let moved: Vec<_> = fs::read_dir(&trash)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("C-0009-gamma-"))
            .collect();
        assert_eq!(moved.len(), 1, "exactly one trashed folder");
        assert!(
            moved[0].path().join("spec.md").exists(),
            "contents must be preserved"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    /// A `..` or absolute id is refused before any FS work.
    #[test]
    fn discard_change_rejects_escapes() {
        let tmp = scratch("loopy_test_discard_escape");
        fs::create_dir_all(tmp.join(CHANGES_SUBDIR)).unwrap();
        let dir = tmp.to_string_lossy().to_string();
        assert!(discard_change(dir.clone(), "..".into()).is_err());
        assert!(discard_change(dir.clone(), "../../etc".into()).is_err());
        assert!(discard_change(dir, "/etc/passwd".into()).is_err());
        let _ = fs::remove_dir_all(&tmp);
    }

    /// An unknown id is an error, not a silent no-op.
    #[test]
    fn discard_change_unknown_id_errors() {
        let tmp = scratch("loopy_test_discard_unknown");
        fs::create_dir_all(tmp.join(CHANGES_SUBDIR)).unwrap();
        let dir = tmp.to_string_lossy().to_string();
        assert!(discard_change(dir, "C-9999".into()).is_err());
        let _ = fs::remove_dir_all(&tmp);
    }
}
