/**
 * The Interview's **envelope** — the one instruction the engine prepends to the
 * delegated `/devy:*` prompt (C-0018, ADR-0012). It speaks about **form**, never
 * about content (AD-1): how to end a turn, one question at a time, in a parseable
 * block. The engine writes no script; the questions are the harness's (D1).
 *
 * Everything here is **pure** (no I/O, no Date.now) and deterministic, so the
 * exact strings are testable char-for-char (AD-6, D15). The literal text is the
 * "O envelope" section of `spec.md`.
 *
 * Turn budget (D15): the first turn of a phase carries {@link fullEnvelope}; every
 * later turn carries only {@link reminder}, a one-liner that fights turn-10 drift
 * without stuffing the context with copies. {@link wrapUp} is the final turn the
 * "Chega, grave o que temos" button (D17) sends.
 */

import type { Phase } from "../tui/transport";

// The form rules — identical across all three phases. Only the "where to write"
// paragraph between these rules and the terminator differs by phase (D10).
const RULES = `Você conduz uma entrevista dentro de uma GUI: o humano vê UMA pergunta por vez,
como cartões clicáveis. Não há terminal.

Quando precisar de uma decisão, ENCERRE O TURNO emitindo exatamente um bloco:

<loopy-ask>
{"id":"objetivo",
 "prompt":"Qual o objetivo desta feature?",
 "options":[{"label":"…","detail":"…","recommended":true,"why":"…"}],
 "otherLabel":"Nenhuma dessas — escrever a minha…"}
</loopy-ask>

Regras: uma pergunta por turno; exatamente uma opção com "recommended": true,
e o "why" diz por que ela.

Se a resposta estiver no código, LEIA O CÓDIGO em vez de perguntar — e me conte
no MESMO bloco, acrescentando "finding" (o que você descobriu) e "source"
(arquivo:linha), com opções para eu seguir ou decidir à mão.`;

// Spec phase: the Agent creates the Change folder and reports it back (D10). The
// dir does not exist yet, so it is NOT injected here.
const CREATE_CHANGE_PARAGRAPH = `Ao criar a pasta da Change, informe-a ANTES de gravar qualquer arquivo:
<loopy-change dir=".harn/devy/changes/C-XXXX-slug"/>`;

// The terminator instruction, closing every full envelope.
const DONE_INSTRUCTION = `Quando esta fase estiver completa, grave e encerre com <loopy-done/>.`;

/**
 * The complete envelope for the first turn of a phase (D15).
 *
 * The spec phase carries the {@link CREATE_CHANGE_PARAGRAPH} — it asks the Agent
 * to report the Change dir before writing, because the engine does not know it
 * yet (D10). The refine/plan phases replace that paragraph with a literal
 * `Grave os arquivos em: <changeDir>`, correcting the `tasks/plan.md` that
 * `/devy:plan` names without editing the harness command.
 *
 * @throws if a non-spec phase is called without a `changeDir` — that is a
 * programming fault (the engine always resolves the dir before refine/plan, D13),
 * not user data, so it fails loud rather than emitting "…em: undefined" (AD-5).
 */
export function fullEnvelope(phase: Phase, changeDir?: string): string {
  if (phase !== "spec" && !changeDir) {
    throw new Error(
      `fullEnvelope: the "${phase}" phase requires a changeDir (D10/D13)`,
    );
  }
  const whereToWrite =
    phase === "spec"
      ? CREATE_CHANGE_PARAGRAPH
      : `Grave os arquivos em: ${changeDir}`;
  return `${RULES}\n\n${whereToWrite}\n\n${DONE_INSTRUCTION}`;
}

/** The one-line reminder for every turn after the first (D15). */
export function reminder(): string {
  return `Lembre: uma pergunta por turno, no bloco <loopy-ask>; <loopy-done/> ao terminar.`;
}

/** The final turn the "Chega, grave o que temos" button sends (D17). */
export function wrapUp(): string {
  return `Pare de perguntar. Grave os arquivos desta fase com o que você já tem e encerre
com <loopy-done/>.`;
}
