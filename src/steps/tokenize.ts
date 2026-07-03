/**
 * Quote-aware command tokenizer — splits a `loopy.yml` command line into an
 * `argv[]` the way a POSIX shell would *for word-splitting and quote removal*,
 * but WITHOUT any variable or command expansion.
 *
 * Why this exists (the bug it fixes). The `shell`/`approval` steps used to hand
 * the fully-interpolated command line to `/bin/sh -c` (execa `shell: true`).
 * That let the shell perform a SECOND round of `$`-expansion — this time on the
 * interpolated DATA (`${task.title}`, `${worktree.diff}`, …), which is arbitrary
 * text from the backlog/agent, not trusted config. A task titled
 *   Resolver de interpolação ${...}
 * produced the literal command
 *   git commit -m "feat(T-004): Resolver de interpolação ${...}"
 * and `/bin/sh` tried to expand `${...}` → `bad substitution`, exit 1. Worse, a
 * title like `$(rm -rf ~)` would have been a *silent* command injection.
 *
 * The fix. Tokenize the RAW template here (honoring the yml's quotes so a quoted
 * argument with spaces stays one arg), THEN resolve `${...}` inside each token,
 * THEN pass argv straight to execa with NO shell. The interpolated data lands as
 * literal argv entries the shell never sees. `${...}` placeholders are opaque to
 * this tokenizer: `$` carries no special meaning here, so `"${task.title}"`
 * tokenizes to the single token `${task.title}` for the loopy resolver to fill.
 * This is the same argv-not-shell model `git.commitPaths` already uses.
 *
 * Quoting rules (POSIX-flavored, with expansion stripped):
 *  - Whitespace outside quotes separates tokens; runs collapse.
 *  - Single quotes: everything literal until the next `'` (no escapes inside).
 *  - Double quotes: literal until the next `"`, except `\` escapes one of
 *    `"` `\` `$` `` ` `` — every other char, INCLUDING `$`, stays literal.
 *  - Outside quotes, `\` escapes the next char (so `\ ` is a literal space).
 *  - Adjacent quoted/unquoted runs concatenate into one token (`a"b"c` → `abc`),
 *    so an empty `""`/`''` still yields a present (empty) token.
 *  - Shell operators (`| & ; < > ( )`) are NOT special — they are ordinary
 *    characters, since each `run:` entry is exactly one command (no pipelines,
 *    no redirection). This is a deliberate capability trade for safety.
 *
 * An unterminated quote is a config error → {@link CommandParseError}, mirroring
 * how an unknown interpolation var fails fast before any command runs.
 */

const SPECIAL_IN_DQUOTE = new Set(['"', "\\", "$", "`"]);

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Raised when a command line cannot be tokenized (today: an unterminated quote).
 * Carries the offending `command` so callers/tests can attribute the failure.
 */
export class CommandParseError extends Error {
  /** The raw command line that failed to parse. */
  readonly command: string;

  constructor(command: string, detail: string) {
    super(`Comando mal formado (${detail}): ${command}`);
    this.name = "CommandParseError";
    this.command = command;
  }
}

/**
 * Split `line` into an argv array honoring single/double quotes and backslash
 * escapes, performing NO `$`/backtick expansion. Throws {@link CommandParseError}
 * on an unterminated quote.
 */
export function tokenizeCommand(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  // Distinguishes an explicit empty token (from `""`) from "no token started".
  let hasToken = false;
  let i = 0;
  const n = line.length;

  const flush = (): void => {
    if (hasToken) {
      tokens.push(current);
      current = "";
      hasToken = false;
    }
  };

  while (i < n) {
    const ch = line[i];

    if (isWhitespace(ch)) {
      flush();
      i++;
      continue;
    }

    if (ch === "'") {
      hasToken = true;
      i++;
      let closed = false;
      while (i < n) {
        if (line[i] === "'") {
          closed = true;
          i++;
          break;
        }
        current += line[i++];
      }
      if (!closed) {
        throw new CommandParseError(line, "aspas simples não fechadas");
      }
      continue;
    }

    if (ch === '"') {
      hasToken = true;
      i++;
      let closed = false;
      while (i < n) {
        const c = line[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        // Inside double quotes `\` escapes only " \ $ ` — otherwise it is literal.
        const next = line[i + 1];
        if (c === "\\" && next !== undefined && SPECIAL_IN_DQUOTE.has(next)) {
          current += next;
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) {
        throw new CommandParseError(line, "aspas duplas não fechadas");
      }
      continue;
    }

    if (ch === "\\") {
      hasToken = true;
      // Outside quotes `\` escapes the next char; a trailing `\` stays literal.
      const next = line[i + 1];
      if (next !== undefined) {
        current += next;
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    current += ch;
    hasToken = true;
    i++;
  }

  flush();
  return tokens;
}

/**
 * Render an argv back to a readable, single-line string for logs and failure
 * reasons — NOT meant to round-trip through a shell. Tokens with whitespace,
 * embedded quotes, or that are empty get wrapped in double quotes (with `"`/`\`
 * backslash-escaped); everything else is left as-is so `${...}`/`$()` in a title
 * stay visible in the message instead of being mangled by escaping.
 */
export function displayCommand(argv: readonly string[]): string {
  return argv.map(quoteForDisplay).join(" ");
}

function quoteForDisplay(token: string): string {
  if (token === "") return '""';
  if (/[\s"\\]/.test(token)) {
    return `"${token.replace(/(["\\])/g, "\\$1")}"`;
  }
  return token;
}
