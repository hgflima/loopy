/**
 * `${...}` interpolation resolver — the mechanism that turns the templated
 * prompts/commands in `loopy.yml` into concrete strings, once per task/attempt
 * (AD-4). It performs *simple substitution* (a `${key}` placeholder is replaced
 * by the scope value at that dotted key) and is intentionally split into three
 * concerns so the pieces stay pure and testable:
 *
 *   1. {@link createScope} — flattens the domain values (task/worktree/iteration/
 *      attempt/checks.report/inputs/workspace) into a lookup keyed by dotted path.
 *      A key that was populated (even with `""`) is *known*; anything else is not.
 *   2. {@link resolve} — walks a template's `${...}` placeholders and substitutes
 *      via the scope; {@link createResolver} binds a scope + step for reuse.
 *   3. {@link selectPrompt} — picks `retry_prompt` vs `prompt` for an attempt.
 *
 * Unknown-vs-empty (OQ1). A *truly unknown* key (typo, undeclared variable)
 * aborts fail-fast with a clear {@link InterpolationError} naming the variable
 * and the step, before any side effect. A *known-but-empty* value — e.g.
 * `${checks.report}` on the first prompt, or `${worktree.diff}` with no diff —
 * renders as the empty string; that is a legitimate value, not an error.
 *
 * Extensibility (AD-4). The seam for growing beyond plain variables into
 * expressions later is the {@link Scope} interface: `resolve` hands the raw
 * inner text of each placeholder to `scope.lookup`. Today that is an exact map
 * lookup; a future `Scope` could parse `lookup("iteration + 1")` as an
 * expression without touching the substitution loop. The engine hardcodes no
 * variable values — they all come from `loopy.yml` + runtime state (AD-1).
 */
import type { Task } from "../types";

/**
 * Raised when a template references a variable that is not part of the scope.
 * Carries the offending `variable` and the `stepId` (when known) so callers and
 * tests can assert on the cause, not just the message.
 */
export class InterpolationError extends Error {
  /** The unknown dotted key, e.g. `"task.nope"`. */
  readonly variable: string;
  /** Id of the step whose template referenced it, when provided. */
  readonly stepId?: string;

  constructor(
    variable: string,
    stepId: string | undefined,
    knownKeys: readonly string[],
  ) {
    const where = stepId ? ` no step "${stepId}"` : "";
    const available =
      knownKeys.length > 0
        ? ` Variáveis disponíveis: ${knownKeys.join(", ")}.`
        : "";
    super(
      `Variável de interpolação desconhecida "\${${variable}}"${where}.` +
        available,
    );
    this.name = "InterpolationError";
    this.variable = variable;
    this.stepId = stepId;
  }
}

/**
 * A key → value lookup over the interpolation variables. This is the extension
 * seam (AD-4): simple substitution is today's implementation, but the interface
 * leaves room for an expression-aware scope later.
 */
export interface Scope {
  /** Value for `key`, or `undefined` when the key is unknown (not empty). */
  lookup(key: string): string | undefined;
  /** Every known key, sorted — used for clear error messages. */
  keys(): readonly string[];
}

/**
 * The documented interpolation variables, shaped exactly as they appear in
 * `loopy.yml` (`${task.id}`, `${worktree.diff}`, `${iteration}`, …). Every field
 * is required: the caller passes `""` for values that are legitimately empty
 * (e.g. `checks.report` before the first checks run), which keeps them *known*.
 */
export interface ScopeVars {
  readonly task: Pick<Task, "id" | "slug" | "title" | "body" | "branch">;
  readonly worktree: { readonly path: string; readonly diff: string };
  /** Outer-loop index (`${iteration}`). */
  readonly iteration: number;
  /** Inner-loop attempt index (`${attempt}`). */
  readonly attempt: number;
  readonly checks: { readonly report: string };
  readonly inputs: {
    readonly spec: string;
    readonly plan: string;
    readonly todo: string;
  };
  readonly workspace: {
    readonly root: string;
    readonly parent_branch: string;
    readonly worktrees_dir: string;
  };
  readonly change: {
    readonly id: string;
    readonly dir: string;
  };
}

/**
 * Flatten a (possibly nested) value into `map` under dotted keys. Leaves become
 * strings (numbers/booleans via `String`); `null`/`undefined` become `""` so a
 * declared-but-absent value stays *known-but-empty* rather than unknown.
 */
function flatten(
  map: Map<string, string>,
  prefix: string,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    map.set(prefix, "");
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(map, prefix === "" ? key : `${prefix}.${key}`, child);
    }
    return;
  }
  map.set(prefix, String(value));
}

/**
 * Build a {@link Scope} from the documented variables. Only leaf keys are
 * registered, so referencing a namespace object (e.g. `${task}` or `${checks}`)
 * is an unknown key by construction.
 */
export function createScope(vars: ScopeVars): Scope {
  const map = new Map<string, string>();
  flatten(map, "", vars);
  return {
    lookup: (key) => map.get(key),
    keys: () => [...map.keys()].sort(),
  };
}

/** Options for {@link resolve} / {@link createResolver}. */
export interface ResolveOptions {
  /** Step id, woven into {@link InterpolationError} for clear attribution. */
  readonly stepId?: string;
}

/** Matches a single `${ ... }` placeholder (inner text captured, braces excluded). */
const PLACEHOLDER = /\$\{([^}]*)\}/g;

/**
 * Substitute every `${...}` in `template` using `scope`. Fails fast with an
 * {@link InterpolationError} on the first unknown key (before returning, so no
 * partial output leaks); known-but-empty keys render as `""`.
 */
export function resolve(
  template: string,
  scope: Scope,
  options: ResolveOptions = {},
): string {
  return template.replace(PLACEHOLDER, (_match, rawExpr: string) => {
    const key = rawExpr.trim();
    const value = scope.lookup(key);
    if (value === undefined) {
      throw new InterpolationError(key, options.stepId, scope.keys());
    }
    return value;
  });
}

/**
 * Bind a `scope` (built once per task/attempt) and `options` into a
 * `(template) => string` resolver — the shape consumed by `StepContext.resolve`.
 */
export function createResolver(
  scope: Scope,
  options: ResolveOptions = {},
): (template: string) => string {
  return (template) => resolve(template, scope, options);
}

/** The prompt fields an `agent` step exposes for attempt-based selection. */
export interface PromptSelectable {
  readonly prompt: string;
  readonly retry_prompt?: string;
}

/**
 * Choose which template to send for a given 1-based `attempt`: `prompt` on the
 * first attempt, `retry_prompt` on retries — falling back to `prompt` when no
 * `retry_prompt` is configured. Selection is separate from {@link resolve}, so
 * the caller resolves the chosen template against that attempt's scope.
 */
export function selectPrompt(step: PromptSelectable, attempt: number): string {
  if (attempt <= 1) return step.prompt;
  return step.retry_prompt ?? step.prompt;
}
