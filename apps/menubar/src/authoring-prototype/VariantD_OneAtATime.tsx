/**
 * PROTOTYPE — throwaway. Variant D: "Uma pergunta por vez".
 *
 * Structure: a nearly empty screen — one big question, one field, suggested
 * answers. No document visible, no sidebar, no tabs. The answers already given
 * collapse into a thin strip of chips you can click to revisit. At the end,
 * the three files arrive at once as a single accept/reject diff.
 * Primary affordance = responder uma coisa e seguir.
 */
import { useState } from "react";
import { QUESTIONS, renderDoc, DRAFT_TASKS } from "./fixtures";

export function VariantD_OneAtATime() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");

  const q = QUESTIONS[index];
  const answeredIds = QUESTIONS.filter((x) => answers[x.id]).map((x) => x.id);
  const allDone = answeredIds.length === QUESTIONS.length;

  function commit(text: string) {
    if (!q || !text.trim()) return;
    setAnswers((a) => ({ ...a, [q.id]: text }));
    const nextUnanswered = QUESTIONS.findIndex(
      (x, i) => i > index && !answers[x.id],
    );
    setIndex(nextUnanswered === -1 ? QUESTIONS.length : nextUnanswered);
    setDraft("");
  }

  function revisit(i: number) {
    setIndex(i);
    setDraft(answers[QUESTIONS[i]!.id] ?? "");
  }

  if (!q || (allDone && index >= QUESTIONS.length)) {
    return (
      <div className="pd-stage pd-stage--result">
        <h2 className="pd-result__title">Pronto. Três arquivos.</h2>
        <div className="pd-result__grid">
          <div className="pd-result__file">
            <h3>spec.md</h3>
            <pre className="pa-doc">{renderDoc("spec", answeredIds)}</pre>
          </div>
          <div className="pd-result__file">
            <h3>plan.md</h3>
            <pre className="pa-doc">{renderDoc("plan", answeredIds)}</pre>
          </div>
          <div className="pd-result__file">
            <h3>todo.md</h3>
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
          </div>
        </div>
        <div className="pd-result__actions">
          <button className="pa-btn pa-btn--ghost" onClick={() => revisit(0)}>
            Rever respostas
          </button>
          <button className="pa-btn pa-btn--primary">Aceitar tudo</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pd-stage">
      <div className="pd-question">
        <span className="pd-question__doc">{q.doc}.md</span>
        <h2 className="pd-question__prompt">{q.prompt}</h2>
        <input
          className="pd-input"
          autoFocus
          placeholder={q.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit(draft)}
        />
        <div className="pd-suggestions">
          {q.suggestions.map((s) => (
            <button key={s} className="pd-suggestion" onClick={() => commit(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="pd-question__actions">
          <button className="pa-btn pa-btn--ghost" onClick={() => commit("—")}>
            Pular
          </button>
          <button
            className="pa-btn pa-btn--primary"
            onClick={() => commit(draft)}
          >
            Continuar ⏎
          </button>
        </div>
      </div>

      <footer className="pd-footer">
        <div
          className="pd-progress"
          aria-label={`${answeredIds.length} de ${QUESTIONS.length}`}
        >
          {QUESTIONS.map((x, i) => (
            <button
              key={x.id}
              className={
                "pd-pip" +
                (answers[x.id] ? " is-answered" : "") +
                (i === index ? " is-current" : "")
              }
              title={answers[x.id] ? `${x.label}: ${answers[x.id]}` : x.label}
              onClick={() => revisit(i)}
            >
              <span className="pd-pip__label">{x.label}</span>
            </button>
          ))}
        </div>
        <span className="pd-footer__count">
          {answeredIds.length} de {QUESTIONS.length}
        </span>
      </footer>
    </div>
  );
}
