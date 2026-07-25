/**
 * QuestionCard — one interview question, filling the screen (D2/D3/D10).
 *
 * Renders a `<loopy-ask>` question as clickable cards: each option carries a
 * one-line `detail`, exactly one is flagged **RECOMENDADA** with the `why`
 * spelled out below a hairline, and a free-text **escape hatch** always lets
 * the human write their own answer.
 *
 * When the agent read the code instead of asking (D10) the card also shows the
 * `finding` and its `source` (`file:line`); the escape hatch then reads as
 * "decide by hand", so a wrong reading is one click from being overridden.
 *
 * With no options the card degrades to a plain open question (the D3 fallback):
 * just the prompt and the free-text field.
 *
 * Meant to be keyed by `question.questionId` so a new question mounts fresh.
 */
import { useState } from "react";
import { Button, Pill } from "../ui";
import { Attachable, type Attachment } from "./Attachable";
import type { PendingQuestion } from "./interview-state";
import "./specs.css";

interface QuestionCardProps {
  readonly question: PendingQuestion;
  /** Lifts the chosen/typed answer. Options answer with their label (no files). */
  readonly onAnswer: (
    text: string,
    attachments?: readonly Attachment[],
  ) => void;
  /** True while the previous answer is still in flight — no double-answers. */
  readonly disabled?: boolean;
}

/** The escape-hatch label, tuned to the question shape. */
function escapeLabel(question: PendingQuestion): string {
  if (question.otherLabel) return question.otherLabel;
  // A finding is a claim to accept or reject — the hatch is "I'll decide".
  if (question.finding) return "Está errado — decido à mão";
  return "Nenhuma dessas — escrever a minha…";
}

export function QuestionCard({
  question,
  onAnswer,
  disabled,
}: QuestionCardProps) {
  const options = question.options ?? [];
  const hasOptions = options.length > 0;

  // `null` = the hatch is closed (only when there are options to close it for);
  // a string = the free-text draft. With no options the field is open at once.
  const [draft, setDraft] = useState<string | null>(hasOptions ? null : "");
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);

  function submitFreeText() {
    if (disabled || draft === null) return;
    // An answer needs text or at least an attachment — an empty submit is a no-op.
    if (!draft.trim() && attachments.length === 0) return;
    onAnswer(draft, attachments);
  }

  return (
    <div className="spec-card">
      <h2 className="spec-card__prompt t-headline">{question.prompt}</h2>

      {question.finding && (
        <div className="spec-finding">
          <p className="spec-finding__text">{question.finding}</p>
          {question.source && (
            <p className="spec-finding__source">
              Li: <code className="t-data">{question.source}</code>
            </p>
          )}
        </div>
      )}

      {hasOptions && (
        <div className="spec-options">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`spec-option${o.recommended ? " is-recommended" : ""}`}
              disabled={disabled}
              onClick={() => onAnswer(o.label)}
            >
              <span className="spec-option__head">
                <span className="spec-option__label">{o.label}</span>
                {o.recommended && (
                  <Pill tone="accent" noDot>
                    RECOMENDADA
                  </Pill>
                )}
              </span>
              {o.detail && (
                <span className="spec-option__detail">{o.detail}</span>
              )}
              {o.why && (
                <span className="spec-option__why">
                  <strong>Porquê:</strong> {o.why}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {draft === null ? (
        <button
          type="button"
          className="spec-escape"
          disabled={disabled}
          onClick={() => setDraft("")}
        >
          {escapeLabel(question)}
        </button>
      ) : (
        <Attachable
          attachments={attachments}
          onChange={setAttachments}
          hint="Cole ou arraste um print, um trecho de log…"
        >
          <textarea
            className="spec-textarea"
            autoFocus
            rows={4}
            placeholder="Sua resposta…"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="spec-actions">
            <Button
              variant="primary"
              disabled={disabled}
              onClick={submitFreeText}
            >
              Continuar
            </Button>
          </div>
        </Attachable>
      )}
    </div>
  );
}
