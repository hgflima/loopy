/**
 * Disk I/O wrappers for the backlog: read/parse a `todo.md` and mark a task done
 * on disk. The pure parsing/marking logic lives in `./parse`; this is the
 * **only** backlog module that touches `node:fs`, so the browser-safe barrel
 * (`./index.ts`) re-exports the pure API from `./parse` and never from here.
 *
 * Marking rewrites `- [ ]` → `- [x]` while preserving the rest of the file
 * byte-for-byte, so `require_clean_parent` stays satisfied after a mark-done
 * commit (idempotent: no write when the content is unchanged).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Task } from "../types";
import { parseBacklog, markDone, BacklogError } from "./parse";
import type { BacklogOptions } from "./parse";

// Back-compat re-exports: Node-side consumers (and tests) historically import
// the pure API from `./todo`. The browser barrel imports it from `./parse`
// instead — keeping `node:fs` out of the browser bundle.
export {
  BacklogError,
  backlogOptionsFrom,
  parseBacklog,
  pendingTasks,
  selectTask,
  markDone,
} from "./parse";
export type { BacklogOptions, BranchParts, TaskSelection } from "./parse";

/** Read and parse a `todo.md` from disk. */
export function loadBacklog(
  path: string,
  options: BacklogOptions = {},
): Task[] {
  return parseBacklog(readFile(path), options);
}

/**
 * Mark task `id` done on disk. Writes only when the content actually changes
 * (idempotent runs leave the file — and its mtime — untouched). Returns whether
 * the file was rewritten.
 */
export function markDoneInFile(
  path: string,
  id: string,
  options: BacklogOptions = {},
): boolean {
  const before = readFile(path);
  const after = markDone(before, id, options);
  if (after === before) return false;
  writeFileSync(path, after, "utf8");
  return true;
}

/** Read a file as UTF-8, surfacing failures as {@link BacklogError}. */
function readFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BacklogError(
      `Não foi possível ler o backlog "${path}": ${reason}`,
      {
        cause: err,
      },
    );
  }
}
