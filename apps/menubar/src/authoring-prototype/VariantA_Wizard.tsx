/**
 * PROTOTYPE — throwaway. Variant A: "Wizard de etapas".
 *
 * Structure: a numbered rail across the top, a form body, a Voltar/Avançar
 * footer. Several fields per step. The documents are NOT visible while you
 * fill them in — you only see the result at the end, as a review screen.
 * Primary affordance = preencher um formulário.
 */
import { useState } from "react";
import { QUESTIONS, SEED_IDEA, renderDoc, DRAFT_TASKS } from "./fixtures";

const STAGES = [
  { id: "ideia", label: "Ideia", questionIds: [] as string[] },
  { id: "problema", label: "Problema", questionIds: ["problem", "users"] },
  { id: "escopo", label: "Escopo", questionIds: ["scope-out", "accept"] },
  { id: "plano", label: "Plano", questionIds: ["where", "data", "risk"] },
  { id: "revisao", label: "Revisão", questionIds: [] as string[] },
];

export function VariantA_Wizard() {
  const [stage, setStage] = useState(0);
  const [idea, setIdea] = useState(SEED_IDEA);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const current = STAGES[stage]!;
  const isLast = stage === STAGES.length - 1;
  const answered = QUESTIONS.filter((q) => (answers[q.id] ?? "").trim()).map(
    (q) => q.id,
  );

  return (
    <div className="pa-wizard">
      <ol className="pa-wizard__rail">
        {STAGES.map((s, i) => (
          <li
            key={s.id}
            className={
              "pa-wizard__rail-item" +
              (i === stage ? " is-current" : "") +
              (i < stage ? " is-done" : "")
            }
          >
            <span className="pa-wizard__rail-num">
              {i < stage ? "✓" : i + 1}
            </span>
            <span className="pa-wizard__rail-label">{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="pa-wizard__body">
        {current.id === "ideia" && (
          <div className="pa-field">
            <label className="pa-field__label" htmlFor="pa-idea">
              Em uma frase, o que você quer construir?
            </label>
            <textarea
              id="pa-idea"
              className="pa-input pa-input--area"
              rows={4}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
            <p className="pa-field__hint">
              Isso vira o cabeçalho do <code>spec.md</code>. Dá pra editar tudo
              depois.
            </p>
          </div>
        )}

        {current.questionIds.map((qid) => {
          const q = QUESTIONS.find((x) => x.id === qid)!;
          return (
            <div className="pa-field" key={q.id}>
              <label className="pa-field__label" htmlFor={`pa-${q.id}`}>
                {q.prompt}
              </label>
              <textarea
                id={`pa-${q.id}`}
                className="pa-input pa-input--area"
                rows={3}
                placeholder={q.placeholder}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                }
              />
              <div className="pa-chips">
                {q.suggestions.map((s) => (
                  <button
                    key={s}
                    className="pa-chip"
                    onClick={() =>
                      setAnswers((a) => ({
                        ...a,
                        [q.id]: a[q.id] ? `${a[q.id]} ${s}` : s,
                      }))
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {current.id === "revisao" && (
          <div className="pa-review">
            <p className="pa-review__intro">
              Três arquivos serão criados em{" "}
              <code>.harn/devy/changes/C-0018/</code>.
            </p>
            {(["spec", "plan"] as const).map((doc) => (
              <details
                key={doc}
                className="pa-review__file"
                open={doc === "spec"}
              >
                <summary>
                  {doc}.md{" "}
                  <span className="pa-review__size">
                    {renderDoc(doc, answered).split("\n").length} linhas
                  </span>
                </summary>
                <pre className="pa-doc">
                  {renderDoc(doc, answered) || "— vazio (nenhuma resposta)"}
                </pre>
              </details>
            ))}
            <details className="pa-review__file">
              <summary>
                todo.md{" "}
                <span className="pa-review__size">
                  {DRAFT_TASKS.length} tasks
                </span>
              </summary>
              <ul className="pa-tasklist">
                {DRAFT_TASKS.map((t) => (
                  <li key={t.id}>
                    <code>{t.id}</code> {t.title}
                    {t.deps.length > 0 && (
                      <em className="pa-deps"> ← {t.deps.join(", ")}</em>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>

      <footer className="pa-wizard__footer">
        <button
          className="pa-btn pa-btn--ghost"
          disabled={stage === 0}
          onClick={() => setStage((s) => s - 1)}
        >
          Voltar
        </button>
        <span className="pa-wizard__count">
          Etapa {stage + 1} de {STAGES.length}
        </span>
        <button
          className="pa-btn pa-btn--primary"
          onClick={() => !isLast && setStage((s) => s + 1)}
        >
          {isLast ? "Criar os 3 arquivos" : "Avançar"}
        </button>
      </footer>
    </div>
  );
}
