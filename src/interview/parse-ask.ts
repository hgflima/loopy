/**
 * Turn parsing for the Interview (C-0018, ADR-0012).
 *
 * The Interview delegates the *script* to `/devy:*` but imposes the *form* of
 * the reply through the Envelope (D1 + D2): the Agent ends a turn by emitting a
 * delimited block — `<loopy-ask>{json}</loopy-ask>` for a structured question,
 * `<loopy-change dir="…"/>` to report the Change folder it created (D10), or
 * `<loopy-done/>` when the phase is complete. This module turns one turn's text
 * buffer into what it asks for, exactly by the spec's parsing table.
 *
 * Design:
 * - **Pure.** No I/O; a plain function of its input string (AD-6). Same path
 *   `parseVerdict` already uses to read a turn (`src/steps/verdict.ts`).
 * - **Turn-scoped source.** Meant to run over the turn's own text buffer (the
 *   per-turn accumulation of `agent_message_chunk`), not a cumulative read.
 * - **Never throws (AD-5).** Malformed JSON, a wrong-shape block, an unclosed
 *   block, or empty input all degrade to an open question — never an exception.
 * - **`change` is orthogonal.** A `<loopy-change>` may accompany any directive
 *   (D10), so it is a common field, not a mutually-exclusive `kind`.
 * - **Prose survives (D25).** Whatever the Agent writes outside the blocks is
 *   returned as `prose`, bound for the transcript — never for the card.
 *
 * The spec's parsing table:
 *
 * | Turn text contains                     | Result                              |
 * |----------------------------------------|-------------------------------------|
 * | `<loopy-ask>{valid json}</loopy-ask>`  | `{ kind: "ask", question }`         |
 * | `<loopy-change dir="…"/>`              | `change` — coexists with ask/done   |
 * | `<loopy-done/>`                        | `{ kind: "done" }`                  |
 * | none of the above, non-empty text      | `{ kind: "open", text }` (D3)       |
 * | malformed JSON inside the block        | `{ kind: "open", text }` + warning  |
 * | two or more `ask` blocks               | the **first** + warning (D25)       |
 */

import type { AskOption } from "../tui/transport";

/**
 * A question parsed from a `<loopy-ask>` block (D2).
 *
 * Mirrors the `question_asked` control frame minus the fields the motor injects:
 * it keeps the block's own `id` (the frame maps it to `questionId`) and never
 * carries `phase` (that is the motor's, not the turn's).
 */
export interface AskQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options?: readonly AskOption[];
  readonly otherLabel?: string;
  /** What the Agent discovered by reading the code instead of asking (D10). */
  readonly finding?: string;
  /** `file:line` backing the `finding` (D10 / SC14). */
  readonly source?: string;
}

/**
 * Everything one Interview turn yields.
 *
 * `kind` is the flow-control directive (spec table). `change`, `prose` and
 * `warning` are common to every directive: `change` because it coexists (D10),
 * `prose` because it always goes to the transcript (D25), `warning` because a
 * degraded parse is a value, not a throw (AD-5).
 */
export type ParsedTurn = {
  /** Change folder reported this turn (D10). Orthogonal to `kind`. */
  readonly change?: string;
  /** Text outside the blocks — for the transcript, not the card (D25). */
  readonly prose: string;
  /** Non-fatal parse note (malformed JSON, duplicate `ask` block). */
  readonly warning?: string;
} & (
  | { readonly kind: "ask"; readonly question: AskQuestion }
  | { readonly kind: "done" }
  | { readonly kind: "open"; readonly text: string }
);

// ---------------------------------------------------------------------------
// Block matchers. Tolerant on the tag surface (self-closing or not, either
// quote), strict on nothing else — the JSON body is validated separately.
// ---------------------------------------------------------------------------

/** A complete `<loopy-ask>…</loopy-ask>` block; global for counting duplicates. */
const ASK_BLOCK = /<loopy-ask\b[^>]*>([\s\S]*?)<\/loopy-ask>/gi;
/** A `<loopy-change … dir="…" …/>` tag, capturing the quoted dir in group 2. */
const CHANGE_TAG =
  /<loopy-change\b[^>]*?\bdir\s*=\s*(["'])([\s\S]*?)\1[^>]*?\/?>/i;
/** A `<loopy-done/>` marker (self-closing slash optional). */
const DONE_TAG = /<loopy-done\s*\/?>/i;

/** Strip every known block/tag so only the prose (D25) is left. */
function stripBlocks(text: string): string {
  return text
    .replace(/<loopy-ask\b[^>]*>[\s\S]*?<\/loopy-ask>/gi, "")
    .replace(/<loopy-change\b[^>]*?\/?>/gi, "")
    .replace(/<loopy-done\s*\/?>/gi, "")
    .trim();
}

// ---------------------------------------------------------------------------
// JSON body → AskQuestion (tolerant coercion, never throws)
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `{ [key]: raw[key] }` when `raw[key]` is a string, else `{}` — the envelope's
 * optional string fields are carried only when present, never as `undefined`.
 * Meant to be spread into the coerced object.
 */
function optString<K extends string>(
  raw: Record<string, unknown>,
  key: K,
): Partial<Record<K, string>> {
  const value = raw[key];
  return typeof value === "string"
    ? ({ [key]: value } as Partial<Record<K, string>>)
    : {};
}

/** Coerce one raw option; returns null for anything without a string `label`. */
function coerceOption(raw: unknown): AskOption | null {
  if (!isObject(raw)) return null;
  if (typeof raw["label"] !== "string") return null;
  return {
    label: raw["label"],
    ...optString(raw, "detail"),
    ...(typeof raw["recommended"] === "boolean"
      ? { recommended: raw["recommended"] }
      : {}),
    ...optString(raw, "why"),
  };
}

/**
 * Coerce a parsed JSON body into an {@link AskQuestion}.
 *
 * Requires a non-empty string `id` and `prompt` — without both, the question
 * cannot be shown or routed, so it degrades to an open question (returns null).
 * Every other field is tolerated: unusable options are dropped, not fatal.
 */
function coerceQuestion(raw: unknown): AskQuestion | null {
  if (!isObject(raw)) return null;
  const id = raw["id"];
  const prompt = raw["prompt"];
  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof prompt !== "string" || prompt.trim() === "") return null;

  const options = Array.isArray(raw["options"])
    ? raw["options"].map(coerceOption).filter((o): o is AskOption => o !== null)
    : [];

  return {
    id,
    prompt,
    ...(options.length > 0 ? { options } : {}),
    ...optString(raw, "otherLabel"),
    ...optString(raw, "finding"),
    ...optString(raw, "source"),
  };
}

/** Parse JSON without throwing; `undefined` signals a malformed body. */
function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse one Interview turn into a {@link ParsedTurn} (spec's parsing table).
 *
 * Precedence for the directive: a well-formed `ask` outranks a `done` in the
 * same turn — a pending question means the Agent still wants input, and the
 * human keeps the "Chega" wrap-up button (D17) to force the end. Absent both,
 * the turn is an open question carrying the prose (D3). `change` is resolved
 * independently and returned alongside whichever directive won (D10).
 *
 * @param text The turn's text buffer. Never throws (AD-5).
 */
export function parseAsk(text: string): ParsedTurn {
  const source = text ?? "";

  // --- change (D10): the dir of the first well-formed <loopy-change …/> ---
  const change = CHANGE_TAG.exec(source)?.[2]?.trim() || undefined;

  const prose = stripBlocks(source);

  // --- ask: first block wins (D25); its body decides ask vs degraded open ---
  const askBlocks = [...source.matchAll(ASK_BLOCK)];
  let question: AskQuestion | null = null;
  let warning: string | undefined;
  if (askBlocks.length > 0) {
    const body = askBlocks[0]?.[1] ?? "";
    question = coerceQuestion(safeParse(body));
    if (question === null) {
      warning =
        "bloco <loopy-ask> inválido — tratado como pergunta aberta (D3)";
    } else if (askBlocks.length > 1) {
      warning = `${askBlocks.length} blocos <loopy-ask> no turno — usando o primeiro (D25)`;
    }
  }

  const common = {
    prose,
    ...(change !== undefined ? { change } : {}),
    ...(warning !== undefined ? { warning } : {}),
  };

  if (question !== null) {
    return { ...common, kind: "ask", question };
  }
  if (DONE_TAG.test(source)) {
    return { ...common, kind: "done" };
  }
  return { ...common, kind: "open", text: prose };
}
