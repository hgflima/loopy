/**
 * PROTOTYPE — throwaway. Variant B: "Chat + artefato ao vivo".
 *
 * Structure: split. Left = conversation with the agent (it asks, you answer
 * freely or click a suggestion). Right = the three documents materializing in
 * real time, with the just-written block flashing. Nothing is hidden: you
 * watch the spec grow as you talk.
 * Primary affordance = escrever uma resposta.
 */
import { useState, useRef, useEffect } from "react";
import {
  QUESTIONS,
  SEED_IDEA,
  renderDoc,
  DRAFT_TASKS,
  renderTodoMd,
} from "./fixtures";

type DocId = "spec" | "plan" | "todo";

interface Turn {
  readonly role: "agent" | "user";
  readonly text: string;
}

export function VariantB_Chat() {
  const [turns, setTurns] = useState<Turn[]>([
    { role: "user", text: SEED_IDEA },
    { role: "agent", text: `Boa. ${QUESTIONS[0]!.prompt}` },
  ]);
  const [answered, setAnswered] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [doc, setDoc] = useState<DocId>("spec");
  const [flash, setFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const qIndex = answered.length;
  const currentQ = QUESTIONS[qIndex];
  const done = !currentQ;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  function answer(text: string) {
    if (!currentQ || !text.trim()) return;
    const nextAnswered = [...answered, currentQ.id];
    const nextQ = QUESTIONS[nextAnswered.length];
    setTurns((t) => [
      ...t,
      { role: "user", text },
      {
        role: "agent",
        text: nextQ
          ? `Anotei no ${currentQ.doc}.md. ${nextQ.prompt}`
          : "Tenho o suficiente. Derivei 5 tasks com dependências — dá uma olhada no todo.md à direita.",
      },
    ]);
    setAnswered(nextAnswered);
    setInput("");
    setDoc(nextQ ? nextQ.doc : "todo");
    setFlash(true);
    setTimeout(() => setFlash(false), 900);
  }

  const body =
    doc === "todo"
      ? done
        ? renderTodoMd(DRAFT_TASKS)
        : "— as tasks são derivadas no fim da conversa"
      : renderDoc(doc, answered) || "— ainda vazio";

  return (
    <div className="pb-split">
      <section className="pb-chat" aria-label="Conversa">
        <div className="pb-chat__scroll" ref={scrollRef}>
          {turns.map((t, i) => (
            <div key={i} className={`pb-turn pb-turn--${t.role}`}>
              {t.role === "agent" && (
                <span className="pb-turn__who">agente</span>
              )}
              <p className="pb-turn__text">{t.text}</p>
            </div>
          ))}
        </div>

        <div className="pb-compose">
          {currentQ && (
            <div className="pa-chips pb-compose__chips">
              {currentQ.suggestions.map((s) => (
                <button key={s} className="pa-chip" onClick={() => answer(s)}>
                  {s}
                </button>
              ))}
              <button
                className="pa-chip pa-chip--muted"
                onClick={() => answer(currentQ.cannedAnswer)}
              >
                ↩︎ deixa o agente propor
              </button>
            </div>
          )}
          <div className="pb-compose__row">
            <input
              className="pa-input"
              placeholder={
                currentQ
                  ? currentQ.placeholder
                  : "Tudo respondido — peça um ajuste"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && answer(input)}
            />
            <button
              className="pa-btn pa-btn--primary"
              onClick={() => answer(input)}
              disabled={done}
            >
              Enviar
            </button>
          </div>
        </div>
      </section>

      <section className="pb-artifact" aria-label="Artefatos">
        <div className="pb-artifact__tabs">
          {(["spec", "plan", "todo"] as const).map((d) => {
            const filled =
              d === "todo" ? done : renderDoc(d, answered).length > 0;
            return (
              <button
                key={d}
                className={"pb-tab" + (doc === d ? " is-active" : "")}
                onClick={() => setDoc(d)}
              >
                {d}.md
                <span
                  className={"pb-tab__dot" + (filled ? " is-filled" : "")}
                />
              </button>
            );
          })}
          <span className="pb-artifact__progress">
            {answered.length}/{QUESTIONS.length} respondidas
          </span>
        </div>
        <pre
          className={"pa-doc pb-artifact__body" + (flash ? " is-flash" : "")}
        >
          {body}
        </pre>
        <footer className="pb-artifact__footer">
          <button className="pa-btn pa-btn--ghost">Editar à mão</button>
          <button className="pa-btn pa-btn--primary" disabled={!done}>
            Aceitar e criar os arquivos
          </button>
        </footer>
      </section>
    </div>
  );
}
