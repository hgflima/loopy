/**
 * PROTOTYPE — throwaway. Variant C: "Documento primeiro, agente na margem".
 *
 * Structure: the document IS the screen — you write markdown directly. The
 * agent never asks anything; it annotates. A narrow right margin lists the
 * gaps it found ("falta critério de aceite"), each with a one-click fix that
 * writes the missing block into the doc. Bottom bar derives the next document.
 * Primary affordance = escrever o documento; o agente reage.
 */
import { useState } from "react";
import {
  QUESTIONS,
  GAPS,
  DOC_CHUNKS,
  SEED_IDEA,
  DRAFT_TASKS,
  renderTodoMd,
} from "./fixtures";

type DocId = "spec" | "plan" | "todo";

const INITIAL: Record<DocId, string> = {
  spec: `# Spec — Histórico de runs\n\n${SEED_IDEA}\n`,
  plan: `# Plan — Histórico de runs\n`,
  todo: "",
};

export function VariantC_Copilot() {
  const [doc, setDoc] = useState<DocId>("spec");
  const [text, setText] = useState<Record<DocId, string>>(INITIAL);
  const [fixed, setFixed] = useState<string[]>([]);

  const openGaps = GAPS.filter(
    (g) =>
      !fixed.includes(g.questionId) && DOC_CHUNKS[g.questionId]!.doc === doc,
  );
  const gapsElsewhere = GAPS.filter(
    (g) =>
      !fixed.includes(g.questionId) && DOC_CHUNKS[g.questionId]!.doc !== doc,
  );

  function applyFix(questionId: string) {
    const chunk = DOC_CHUNKS[questionId]!;
    const target = chunk.doc as DocId;
    setText((t) => ({
      ...t,
      [target]: `${t[target].trimEnd()}\n\n${chunk.text}\n`,
    }));
    setFixed((f) => [...f, questionId]);
    setDoc(target);
  }

  function derive() {
    if (doc === "spec") {
      const missing = QUESTIONS.filter(
        (q) => q.doc === "plan" && !fixed.includes(q.id),
      );
      setText((t) => ({
        ...t,
        plan: missing.reduce(
          (acc, q) =>
            `${acc}\n\n## ${q.label}\n\n_(rascunho do agente — revise)_`,
          t.plan,
        ),
      }));
      setDoc("plan");
    } else {
      setText((t) => ({ ...t, todo: renderTodoMd(DRAFT_TASKS) }));
      setDoc("todo");
    }
  }

  return (
    <div className="pc-canvas">
      <div className="pc-canvas__bar">
        <div className="pc-files">
          {(["spec", "plan", "todo"] as const).map((d) => (
            <button
              key={d}
              className={"pc-file" + (doc === d ? " is-active" : "")}
              onClick={() => setDoc(d)}
            >
              {d}.md
            </button>
          ))}
        </div>
        <span className="pc-canvas__status">
          {GAPS.length - fixed.length === 0
            ? "Sem lacunas — pronto pra rodar"
            : `${GAPS.length - fixed.length} lacunas`}
        </span>
      </div>

      <div className="pc-canvas__main">
        <textarea
          className="pc-editor"
          value={text[doc]}
          spellCheck={false}
          placeholder={
            doc === "todo" ? "Derive as tasks a partir do plan…" : "Escreva…"
          }
          onChange={(e) => setText((t) => ({ ...t, [doc]: e.target.value }))}
        />

        <aside className="pc-margin" aria-label="Sugestões do agente">
          <h3 className="pc-margin__title">Agente</h3>
          {openGaps.length === 0 && gapsElsewhere.length === 0 && (
            <p className="pc-margin__empty">Nada a apontar neste arquivo.</p>
          )}
          {openGaps.map((g) => (
            <div className="pc-note" key={g.questionId}>
              <p className="pc-note__text">{g.note}</p>
              <button
                className="pc-note__fix"
                onClick={() => applyFix(g.questionId)}
              >
                Escrever isso pra mim
              </button>
            </div>
          ))}
          {gapsElsewhere.length > 0 && (
            <p className="pc-margin__elsewhere">
              +{gapsElsewhere.length} em outro arquivo
            </p>
          )}
        </aside>
      </div>

      <footer className="pc-canvas__footer">
        <span className="pc-canvas__hint">
          Nada é salvo até você clicar. O agente só escreve onde você mandar.
        </span>
        <button className="pa-btn pa-btn--ghost" onClick={derive}>
          {doc === "spec"
            ? "Derivar o plan a partir daqui"
            : "Derivar as tasks"}
        </button>
        <button className="pa-btn pa-btn--primary" disabled={!text.todo}>
          Salvar os 3 arquivos
        </button>
      </footer>
    </div>
  );
}
