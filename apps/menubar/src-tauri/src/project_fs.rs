use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Files read from the project directory that the frontend needs.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectFiles {
    /// Contents of `loopy.yml` (None when the file doesn't exist).
    pub loopy_yml: Option<String>,
}

/// Read `loopy.yml` from the given project directory.
/// A missing file yields `None` — only genuine I/O errors are propagated.
///
/// The backlog is **not** read here: its path is declared by the config
/// (`inputs.todo`), so only the frontend — which owns the schema — knows where
/// it lives. It fetches it with [`read_backlog`] once the yml is parsed.
#[tauri::command]
pub fn read_project_files(dir: String) -> Result<ProjectFiles, String> {
    let base = Path::new(&dir);
    Ok(ProjectFiles {
        loopy_yml: read_optional(base.join("loopy.yml"))?,
    })
}

/// Read the backlog file at `path`, relative to the project dir — the same file
/// the engine reads (`inputs.todo` in `loopy.yml`), which is frequently *not*
/// `<dir>/todo.md`.
///
/// `path` is confined to the project dir: absolute paths and any `..` component
/// are rejected. A missing file yields `None`.
#[tauri::command]
pub fn read_backlog(dir: String, path: String) -> Result<Option<String>, String> {
    let target = resolve_within(Path::new(&dir), &path)?;
    read_optional(target)
}

/// Write `loopy.yml` in the project directory. If the file already exists,
/// a timestamped backup is created under `<dir>/.loopy/backups/` and the
/// oldest backups beyond the retention limit (10) are pruned.
#[tauri::command]
pub fn write_loopy_yml(dir: String, contents: String) -> Result<(), String> {
    let base = Path::new(&dir);
    let target = base.join("loopy.yml");

    // Backup existing file before overwriting.
    if target.exists() {
        let backup_dir = base.join(".loopy").join("backups");
        fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {e}"))?;

        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Failed to get epoch: {e}"))?
            .as_secs();

        let backup_name = backup_filename(epoch);
        fs::copy(&target, backup_dir.join(&backup_name))
            .map_err(|e| format!("Failed to create backup: {e}"))?;

        enforce_retention(&backup_dir, RETENTION_LIMIT)?;
    }

    fs::write(&target, contents)
        .map_err(|e| format!("Failed to write loopy.yml: {e}"))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RETENTION_LIMIT: usize = 10;
const BACKUP_PREFIX: &str = "loopy.";
const BACKUP_SUFFIX: &str = ".yml";

/// Join `rel` onto `base`, refusing to leave the project dir.
///
/// The check is **lexical** (no filesystem access): a path is rejected when it
/// is absolute or carries any `..` component. That keeps a hand-edited
/// `inputs.todo` from turning the webview into an arbitrary file reader.
fn resolve_within(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(rel);
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                return Err(format!("Path escapes the project dir: {rel}"))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path must be relative to the project dir: {rel}"))
            }
            _ => {}
        }
    }
    Ok(base.join(candidate))
}

/// Read a file, returning `None` when it doesn't exist.
fn read_optional(path: std::path::PathBuf) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

/// Build the backup filename for a given epoch (seconds).
fn backup_filename(epoch_secs: u64) -> String {
    format!("{BACKUP_PREFIX}{epoch_secs}{BACKUP_SUFFIX}")
}

/// List backup filenames matching the `loopy.<digits>.yml` pattern, sorted
/// ascending by epoch (oldest first).
fn list_backups(backup_dir: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(backup_dir)
        .map_err(|e| format!("Failed to list backups: {e}"))?;

    let mut pairs: Vec<(u64, String)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            extract_epoch(&name).map(|epoch| (epoch, name))
        })
        .collect();

    pairs.sort_by_key(|(epoch, _)| *epoch);
    Ok(pairs.into_iter().map(|(_, name)| name).collect())
}

/// Extract the numeric epoch from a backup filename.
fn extract_epoch(name: &str) -> Option<u64> {
    name.strip_prefix(BACKUP_PREFIX)?
        .strip_suffix(BACKUP_SUFFIX)?
        .parse()
        .ok()
}

/// Remove the oldest backups so that at most `limit` remain.
fn enforce_retention(backup_dir: &Path, limit: usize) -> Result<(), String> {
    let names = list_backups(backup_dir)?;
    if names.len() <= limit {
        return Ok(());
    }
    let to_remove = names.len() - limit;
    for name in names.iter().take(to_remove) {
        fs::remove_file(backup_dir.join(name))
            .map_err(|e| format!("Failed to remove old backup {name}: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_within_accepts_nested_relative_path() {
        let base = Path::new("/proj");
        assert_eq!(
            resolve_within(base, ".harn/devy/changes/C-0015/todo.md").unwrap(),
            base.join(".harn/devy/changes/C-0015/todo.md")
        );
        assert_eq!(
            resolve_within(base, "todo.md").unwrap(),
            base.join("todo.md")
        );
    }

    #[test]
    fn resolve_within_rejects_escapes() {
        let base = Path::new("/proj");
        assert!(resolve_within(base, "../etc/passwd").is_err());
        assert!(resolve_within(base, "docs/../../etc/passwd").is_err());
        assert!(resolve_within(base, "/etc/passwd").is_err());
    }

    #[test]
    fn read_backlog_reads_the_declared_path() {
        let tmp = std::env::temp_dir().join("loopy_test_read_backlog");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("changes/C-1")).unwrap();
        fs::write(tmp.join("changes/C-1/todo.md"), "- [ ] T-001: x\n").unwrap();

        let dir = tmp.to_string_lossy().to_string();
        assert_eq!(
            read_backlog(dir.clone(), "changes/C-1/todo.md".into()).unwrap(),
            Some("- [ ] T-001: x\n".to_string())
        );
        // Missing file → None, not an error (drives the empty state).
        assert_eq!(read_backlog(dir.clone(), "todo.md".into()).unwrap(), None);
        assert!(read_backlog(dir, "../escape.md".into()).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn backup_filename_from_epoch() {
        assert_eq!(backup_filename(1720000000), "loopy.1720000000.yml");
        assert_eq!(backup_filename(0), "loopy.0.yml");
    }

    #[test]
    fn extract_epoch_accepts_valid() {
        assert_eq!(extract_epoch("loopy.1720000000.yml"), Some(1720000000));
        assert_eq!(extract_epoch("loopy.0.yml"), Some(0));
        assert_eq!(extract_epoch("loopy.999.yml"), Some(999));
    }

    #[test]
    fn extract_epoch_rejects_invalid() {
        assert_eq!(extract_epoch("loopy.yml"), None);         // no digits
        assert_eq!(extract_epoch("loopy..yml"), None);        // empty digits
        assert_eq!(extract_epoch("loopy.abc.yml"), None);     // non-digits
        assert_eq!(extract_epoch("other.123.yml"), None);     // wrong prefix
        assert_eq!(extract_epoch("loopy.123.yaml"), None);    // wrong suffix
    }

    /// Given a list of N backup names, `enforce_retention` should keep the
    /// 10 most recent (highest epoch) and remove the rest.
    #[test]
    fn retention_keeps_newest_ten() {
        let tmp = std::env::temp_dir().join("loopy_test_retention");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // Create 13 backup files (epochs 1..=13).
        for i in 1u64..=13 {
            let name = backup_filename(i);
            fs::write(tmp.join(&name), "").unwrap();
        }

        enforce_retention(&tmp, 10).unwrap();

        let remaining = list_backups(&tmp).unwrap();
        assert_eq!(remaining.len(), 10);
        // The 3 oldest (epochs 1, 2, 3) should have been removed.
        assert!(!remaining.contains(&"loopy.1.yml".to_string()));
        assert!(!remaining.contains(&"loopy.2.yml".to_string()));
        assert!(!remaining.contains(&"loopy.3.yml".to_string()));
        // The newest (4..=13) should remain.
        assert_eq!(remaining[0], "loopy.4.yml");
        assert_eq!(remaining[9], "loopy.13.yml");

        // Cleanup
        let _ = fs::remove_dir_all(&tmp);
    }

    /// Retention is a no-op when within the limit.
    #[test]
    fn retention_noop_under_limit() {
        let tmp = std::env::temp_dir().join("loopy_test_retention_noop");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        for i in 1u64..=5 {
            fs::write(tmp.join(backup_filename(i)), "").unwrap();
        }

        enforce_retention(&tmp, 10).unwrap();
        assert_eq!(list_backups(&tmp).unwrap().len(), 5);

        let _ = fs::remove_dir_all(&tmp);
    }

    /// Retention at exactly the limit should not remove anything.
    #[test]
    fn retention_exact_limit_keeps_all() {
        let tmp = std::env::temp_dir().join("loopy_test_retention_exact");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        for i in 1u64..=10 {
            fs::write(tmp.join(backup_filename(i)), "").unwrap();
        }

        enforce_retention(&tmp, 10).unwrap();
        assert_eq!(list_backups(&tmp).unwrap().len(), 10);

        let _ = fs::remove_dir_all(&tmp);
    }
}
