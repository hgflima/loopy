/**
 * Pure, I/O-free backlog parser for `todo.md` — the input the outer loop
 * iterates over.
 *
 * The engine dogfoods its own format (AD-7): `- [ ] T-NNN: title` at column 0,
 * with the task's `${task.body}` as the indented block beneath it (up to the
 * next column-0 line). This module turns that text into ordered {@link Task}s
 * and rewrites `- [ ]` → `- [x]` idempotently while preserving the rest of the
 * file byte-for-byte (only the one marker changes), so `require_clean_parent`
 * stays satisfied after a mark-done commit.
 *
 * This module is **browser-safe**: it never imports `node:fs`. The `load*` /
 * `*InFile` disk wrappers live in `./todo`, which imports from here. The
 * browser barrel (`./index.ts`) re-exports this module's pure API.
 *
 * Invariant (AD-1): this is mechanics only. Markers, the id pattern, and body
 * mode come from `inputs.backlog` in `loopy.yml` — never hardcoded policy.
 */
import type { BacklogConfig, Task } from "../types";

/** Raised when the backlog cannot be read or a requested task id is absent. */
export class BacklogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BacklogError";
  }
}

/** Identifies a task within a title. */
export interface BranchParts {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

/** Knobs for parsing/marking a backlog; every field has a sensible default. */
export interface BacklogOptions {
  /** Column-0 prefix of a pending task line. Default `"- [ ]"`. */
  readonly pendingMarker?: string;
  /** Column-0 prefix of a completed task line. Default `"- [x]"`. */
  readonly doneMarker?: string;
  /** Regex source used to extract the task id. Default `"T-\\d+"`. */
  readonly taskIdPattern?: string;
  /** Prefix of the deps line in task body (case-insensitive). Default `"Deps:"`. */
  readonly depsPattern?: string;
  /** Build `${task.branch}` from a task. Default `"${id}-${slug}"`. */
  readonly branchFor?: (parts: BranchParts) => string;
}

const DEFAULT_PENDING = "- [ ]";
const DEFAULT_DONE = "- [x]";
const DEFAULT_ID_PATTERN = "T-\\d+";
const DEFAULT_DEPS_PATTERN = "Deps:";

/** Translate a validated {@link BacklogConfig} into {@link BacklogOptions}. */
export function backlogOptionsFrom(config: BacklogConfig): BacklogOptions {
  return {
    pendingMarker: config.pending_marker,
    doneMarker: config.done_marker,
    taskIdPattern: config.task_id_pattern,
    depsPattern: config.deps_pattern,
  };
}

/** Resolved options with defaults applied and the id regex compiled once. */
interface ResolvedOptions {
  readonly pendingMarker: string;
  readonly doneMarker: string;
  readonly idRegex: RegExp;
  /** Case-insensitive prefix for the deps line (e.g. `"Deps:"`). */
  readonly depsPattern: string;
  /** Full id regex (not anchored) used to validate dep ids. */
  readonly idValidationRegex: RegExp;
  readonly branchFor: (parts: BranchParts) => string;
}

function defaultBranch({ id, slug }: BranchParts): string {
  return slug ? `${id}-${slug}` : id;
}

function resolveOptions(options: BacklogOptions): ResolvedOptions {
  const pattern = options.taskIdPattern ?? DEFAULT_ID_PATTERN;
  return {
    pendingMarker: options.pendingMarker ?? DEFAULT_PENDING,
    doneMarker: options.doneMarker ?? DEFAULT_DONE,
    // Anchor at the start of the checkbox content so the id is the first token.
    idRegex: new RegExp(`^(?:${pattern})`),
    depsPattern: options.depsPattern ?? DEFAULT_DEPS_PATTERN,
    idValidationRegex: new RegExp(`^(?:${pattern})$`),
    branchFor: options.branchFor ?? defaultBranch,
  };
}

/**
 * Derive a branch/URL-safe slug from a title: lowercase, strip diacritics, and
 * collapse every run of non-alphanumeric characters into a single dash.
 */
function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A parsed task plus the source-line index of its checkbox (for `markDone`). */
interface RawTask extends Task {
  readonly lineIndex: number;
}

/** Leading-whitespace length of a line (`0` for a column-0 line). */
function indentWidth(line: string): number {
  return line.length - line.replace(/^\s+/, "").length;
}

/** `true` for an empty or whitespace-only line. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * Extract the body: blank and indented lines beneath the checkbox, up to the
 * next column-0 non-blank line. The result is dedented by the common indent and
 * trimmed of surrounding blank lines (internal blanks are kept).
 */
function extractBody(lines: readonly string[], startIndex: number): string {
  const collected: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    // Stop at the next column-0 non-blank line (task / heading / quote).
    if (!isBlank(line) && indentWidth(line) === 0) break;
    collected.push(line);
  }

  // Drop surrounding blank lines.
  while (collected.length > 0 && isBlank(collected[0]!)) collected.shift();
  while (collected.length > 0 && isBlank(collected[collected.length - 1]!)) {
    collected.pop();
  }
  if (collected.length === 0) return "";

  const indent = Math.min(
    ...collected.filter((line) => !isBlank(line)).map(indentWidth),
  );
  return collected.map((line) => line.slice(indent)).join("\n");
}

/**
 * Extract dep ids from the first `Deps:` line in the body.
 * `"nenhuma"` (case-insensitive) or absent line → `[]`.
 * Ids that don't match `task_id_pattern` are silently dropped.
 */
function parseDeps(body: string, opts: ResolvedOptions): string[] {
  const prefix = opts.depsPattern.toLowerCase();

  for (const line of body.split("\n")) {
    if (!line.trim().toLowerCase().startsWith(prefix)) continue;

    const raw = line.trim().slice(opts.depsPattern.length).trim();
    if (!raw || /^nenhuma$/i.test(raw)) return [];

    return raw
      .split(",")
      .map((t) => t.trim())
      .filter((id) => id && opts.idValidationRegex.test(id));
  }
  return [];
}

/** Parse one column-0 checkbox line into a task, or `null` if it isn't one. */
function parseTaskLine(
  line: string,
  lineIndex: number,
  lines: readonly string[],
  opts: ResolvedOptions,
): RawTask | null {
  let done: boolean;
  let content: string;
  if (line.startsWith(opts.pendingMarker)) {
    done = false;
    content = line.slice(opts.pendingMarker.length);
  } else if (line.startsWith(opts.doneMarker)) {
    done = true;
    content = line.slice(opts.doneMarker.length);
  } else {
    return null;
  }

  const trimmed = content.trim();
  const idMatch = opts.idRegex.exec(trimmed);
  if (!idMatch) return null; // checkbox without a task id — not a backlog task

  const id = idMatch[0];
  // Title is what follows the id, minus a leading separator (`:`, `-`, spaces).
  const title = trimmed
    .slice(id.length)
    .replace(/^[\s:–—-]+/, "")
    .trimEnd();
  const slug = slugify(title);
  const branch = opts.branchFor({ id, slug, title });
  const body = extractBody(lines, lineIndex + 1);
  const deps = parseDeps(body, opts);

  return { id, slug, title, body, branch, done, deps, lineIndex };
}

/**
 * Parse every task, tagging each with its checkbox's source-line index (used by
 * {@link markDone}). {@link parseBacklog} is the public, index-free view of this.
 */
function parseRaw(source: string, options: BacklogOptions): RawTask[] {
  const opts = resolveOptions(options);
  const lines = source.split("\n");
  const tasks: RawTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const task = parseTaskLine(lines[i]!, i, lines, opts);
    if (task) tasks.push(task);
  }
  return tasks;
}

/** Parse `todo.md` text into every task it declares, in file order. */
export function parseBacklog(
  source: string,
  options: BacklogOptions = {},
): Task[] {
  return parseRaw(source, options).map((t) => ({
    id: t.id,
    slug: t.slug,
    title: t.title,
    body: t.body,
    branch: t.branch,
    done: t.done,
    deps: t.deps,
  }));
}

/** Keep only the not-yet-done tasks, preserving file order. */
export function pendingTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => !task.done);
}

/** The outcome of a `--task T-NNN` selection (OQ6). */
export interface TaskSelection {
  /** The requested task, or `undefined` when it is not in the pending list. */
  readonly task?: Task;
  /** Pending tasks that precede the requested one (for the non-blocking warning). */
  readonly priorPending: readonly Task[];
}

/**
 * Select a single pending task by id (the `--task` escape hatch, OQ6). Returns
 * the task plus the pending tasks that come before it in file order, so the CLI
 * can warn — without blocking — that earlier work is still open. When `id` is not
 * pending, `task` is `undefined` and there is nothing to warn about.
 */
export function selectTask(
  pending: readonly Task[],
  id: string,
): TaskSelection {
  const index = pending.findIndex((task) => task.id === id);
  if (index < 0) return { priorPending: [] };
  return { task: pending[index], priorPending: pending.slice(0, index) };
}

/**
 * Idempotently mark task `id` done: rewrite its `- [ ]` to `- [x]`, touching
 * nothing else. Returns the source unchanged when the task is already done, and
 * throws {@link BacklogError} when `id` is not in the backlog.
 */
export function markDone(
  source: string,
  id: string,
  options: BacklogOptions = {},
): string {
  const opts = resolveOptions(options);
  const tasks = parseRaw(source, options);
  const target = tasks.find((task) => task.id === id);
  if (!target) {
    throw new BacklogError(
      `Task "${id}" não encontrada no backlog (nenhum checkbox "${opts.pendingMarker}"/"${opts.doneMarker}" com esse id).`,
    );
  }
  if (target.done) return source; // already done — no-op

  const lines = source.split("\n");
  const line = lines[target.lineIndex]!;
  lines[target.lineIndex] = line.replace(opts.pendingMarker, opts.doneMarker);
  return lines.join("\n");
}
