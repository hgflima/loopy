/**
 * Verdict parsing for the `audit` step (T-013).
 *
 * The `audit` step (see the example `loopy.yml`) runs the agent read-only and
 * asks it to answer, on the LAST line, exactly `AUDIT: PASS` or
 * `AUDIT: FAIL: <motivo>`. This module turns that free-form agent text into a
 * structured verdict that gates the commit.
 *
 * Design:
 * - **Pure.** No I/O; a plain function of its input string (AD-6).
 * - **Turn-scoped source (OQ3).** It is meant to run over the audit turn's own
 *   text buffer — the per-turn accumulation of `agent_message_chunk` — NOT a
 *   cumulative `readText()`, so a verdict from an earlier turn can never leak.
 * - **Last occurrence wins.** Agents narrate before concluding; only the final
 *   marker is the verdict. Everything before it is noise.
 * - **Fail-closed.** Absence of any verdict is a FAIL — it must never silently
 *   let a commit through (SPEC "Fazer merge com checks falhando ou AUDIT: FAIL").
 * - **Tolerant.** Case-insensitive; tolerates markdown emphasis (`**`, `` ` ``,
 *   `_`, `~`) and extra whitespace around the marker; extracts the reason after
 *   `FAIL` regardless of how the agent separated it.
 *
 * The marker `label` is configurable (default `"AUDIT"`) so the token stays
 * config-driven rather than hardcoded in the engine (AD-1). It pairs with the
 * `expect:` field of the `audit` step in `loopy.yml`.
 */

/** Structured outcome of parsing an agent audit turn. */
export interface Verdict {
  /** `true` only when a PASS verdict was found. FAIL or absence → `false`. */
  readonly pass: boolean;
  /** `true` when any verdict marker was found (distinguishes FAIL vs absence). */
  readonly found: boolean;
  /** Reason from `FAIL: <motivo>` (agent text) or a synthesized absence note. */
  readonly reason?: string;
}

/** Options for {@link parseVerdict}. */
export interface ParseVerdictOptions {
  /** Marker label preceding `PASS`/`FAIL` (default `"AUDIT"`). */
  readonly label?: string;
}

const DEFAULT_LABEL = "AUDIT";

/** Markdown emphasis / spacing tolerated around the marker and the reason. */
const NOISE = " \\t*_`~";

/** Escape a user-supplied label so it is matched literally inside a RegExp. */
function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip leading separators/markdown and trailing markdown from a FAIL reason. */
function cleanReason(raw: string): string {
  return raw
    .replace(/^[\s:*_`~\-–—]+/, "")
    .replace(/[\s*_`~]+$/, "")
    .trim();
}

/**
 * Parse the last `AUDIT: PASS` / `AUDIT: FAIL: <motivo>` verdict from agent text.
 *
 * @param text  The audit turn's text buffer (OQ3), not a cumulative readText.
 * @param opts  Optional `label` override (default `"AUDIT"`).
 * @returns A {@link Verdict}; absence of any marker yields a fail-closed result.
 */
export function parseVerdict(
  text: string,
  opts: ParseVerdictOptions = {},
): Verdict {
  const label = opts.label ?? DEFAULT_LABEL;

  // Match only the marker + keyword (not the trailing reason) so that a second
  // marker on the same line is still seen — the instruction line
  // "'AUDIT: PASS' ou 'AUDIT: FAIL: <motivo>'" must resolve to its LAST marker.
  const marker = new RegExp(
    `\\b${escapeRegExp(label)}\\b[${NOISE}]*:[${NOISE}]*(PASS|FAIL)\\b`,
    "gi",
  );

  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(marker)) {
    last = match;
  }

  if (last === null) {
    return {
      pass: false,
      found: false,
      reason: `veredito "${label}: PASS" ou "${label}: FAIL: <motivo>" ausente`,
    };
  }

  const keyword = last[1]?.toUpperCase(); // the matched "PASS" or "FAIL"
  if (keyword === "PASS") {
    return { pass: true, found: true };
  }

  // FAIL: the reason is the remainder of the marker's line.
  const afterKeyword = last.index + last[0].length;
  const restOfLine = text.slice(afterKeyword).split(/\r?\n/, 1)[0] ?? "";
  const reason = cleanReason(restOfLine) || undefined;
  return { pass: false, found: true, reason };
}
