/**
 * PROTOTYPE — throwaway. Variant E: "Roteiro devy, uma pergunta por vez".
 *
 * Spine of D (one question filling the screen, nothing else competing) driving
 * the REAL devy roteiro:
 *
 *   Triagem → Demanda → ┬ feature: /devy:spec → /devy:refine → /devy:plan → salvar
 *                       └ bug|débito: /devy:debug
 *
 * Every question is an AskUserQuestion-shaped card: options with a one-line
 * consequence, exactly one flagged **Recomendada** with the reason spelled out
 * inline, plus a free-text escape hatch. `/devy:refine` also shows what it
 * decided WITHOUT asking, by reading the repo — that is in the real command.
 */
import { useState, useEffect } from "react";
import { Attachable, type Attachment } from "./Attachable";
import {
  PICK_FOLDER,
  RECENT_PROJECTS,
  TRIAGE,
  DESCRIBE,
  FEATURE_SCRIPT,
  DEBUG_SCRIPT,
  TRACK_PHASES,
  PHASE_LABEL,
  CHANGE_DIR,
  SAVED_FILE_NAMES,
  type Node,
  type Track,
} from "./devy-script";

/** Maps the triage answer onto a track. Anything else walks the debug trail. */
function trackOf(label: string | undefined): Track | null {
  if (!label) return null;
  if (label.startsWith("Nova feature")) return "feature";
  if (label.startsWith("Bug")) return "bug";
  if (label.startsWith("Débito")) return "debt";
  return "debt"; // "Outro…" — investigate before planning
}

interface Props {
  /** Lifts the chosen directory so the app header can show it. */
  readonly onProjectChange?: (dir: string) => void;
}

export function VariantE_DevyFlow({ onProjectChange }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [other, setOther] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Attachments per question id — pasted, dropped or picked. */
  const [attached, setAttached] = useState<
    Record<string, readonly Attachment[]>
  >({});
  const [saved, setSaved] = useState(false);

  const track = trackOf(answers["track"]);
  const sequence: readonly Node[] = [
    // The folder comes first: without a target directory there is nowhere to
    // write, and the recents list is only useful before any typing happens.
    PICK_FOLDER,
    ...(answers["project"] ? [TRIAGE] : []),
    ...(track ? [DESCRIBE[track]] : []),
    ...(track === "feature" ? FEATURE_SCRIPT : track ? DEBUG_SCRIPT : []),
  ];
  const node = sequence[Math.min(cursor, sequence.length - 1)]!;
  const phases = TRACK_PHASES[track ?? "unknown"];

  function commit(id: string, value: string) {
    if (!value.trim()) return;
    setAnswers((a) => ({ ...a, [id]: value }));
    setCursor((c) => c + 1);
    setOther(null);
    setDraft("");
  }

  function pickProject(path: string) {
    if (!path.trim()) return;
    onProjectChange?.(path.trim());
    commit("project", path.trim());
  }

  /** Real folder picker where the browser has one; the Tauri app uses its own
   *  dialog. Cancelling or lacking support just leaves the path field. */
  async function browse() {
    const picker = (
      window as { showDirectoryPicker?: () => Promise<{ name: string }> }
    ).showDirectoryPicker;
    if (!picker) return;
    try {
      const handle = await picker();
      pickProject(`~/…/${handle.name}`);
    } catch {
      /* cancelled — the typed path is still there */
    }
  }

  function back() {
    setCursor((c) => Math.max(0, c - 1));
    setOther(null);
    setDraft("");
  }

  // Reaching the save node IS the save: no confirm screen, no preview of the
  // files. (Real code would await the write; here a timer stands in for it.)
  useEffect(() => {
    if (node.kind !== "save") return;
    setSaved(false);
    const id = setTimeout(() => setSaved(true), 1500);
    return () => clearTimeout(id);
  }, [node]);

  // Position within the current phase — the only progress signal on screen.
  const samePhase = sequence.filter((n) => n.phase === node.phase);
  const posInPhase = samePhase.indexOf(node) + 1;

  return (
    <div className="pe-stage">
      <div className="pe-head">
        <span className="pe-command">{node.command}</span>
        {samePhase.length > 1 && (
          <span className="pe-head__pos">
            {posInPhase} de {samePhase.length} em {PHASE_LABEL[node.phase]}
          </span>
        )}
      </div>

      <div className="pe-body">
        {/* The save screen speaks for itself — a heading above the spinner would
            only ask the user to read while they wait. */}
        {node.kind !== "save" && <h2 className="pe-prompt">{node.prompt}</h2>}

        {node.kind === "folder" && (
          <>
            <p className="pe-hint">{node.hint}</p>
            <ul className="pe-recents">
              {RECENT_PROJECTS.map((p) => (
                <li key={p.path}>
                  <button
                    className="pe-recent"
                    onClick={() => pickProject(p.path)}
                  >
                    <span className="pe-recent__path">{p.path}</span>
                    <span className="pe-recent__note">
                      {p.fresh && <span className="pe-recent__tag">novo</span>}
                      {p.note}
                    </span>
                  </button>
                </li>
              ))}
              {/* Browsing is a fourth card, not a stray button: it keeps the
                  vertical rhythm and reads as "one more way to pick". */}
              <li>
                <button
                  className="pe-recent pe-recent--browse"
                  onClick={() => void browse()}
                >
                  <span className="pe-recent__path">Escolher outra pasta…</span>
                  <span className="pe-recent__note">
                    Abre o seletor do sistema
                  </span>
                </button>
              </li>
            </ul>

            {/* Same escape-hatch pattern as every other question. */}
            {other === null ? (
              <button className="pe-escape" onClick={() => setOther("")}>
                Colar um caminho…
              </button>
            ) : (
              <div className="pe-escape-row">
                <input
                  className="pa-input"
                  autoFocus
                  placeholder="/Users/você/dev/projeto"
                  spellCheck={false}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && pickProject(other)}
                />
                <button
                  className="pa-btn pa-btn--primary"
                  onClick={() => pickProject(other)}
                >
                  Usar ⏎
                </button>
              </div>
            )}
          </>
        )}

        {node.kind === "choice" && (
          <>
            <div className="pe-options">
              {node.options.map((o) => (
                <button
                  key={o.label}
                  className={
                    "pe-option" + (o.recommended ? " is-recommended" : "")
                  }
                  onClick={() => commit(node.id, o.label)}
                >
                  <span className="pe-option__head">
                    <span className="pe-option__label">{o.label}</span>
                    {o.recommended && (
                      <span className="pe-option__badge">Recomendada</span>
                    )}
                  </span>
                  <span className="pe-option__detail">{o.detail}</span>
                  {o.why && (
                    <span className="pe-option__why">
                      <strong>Porquê:</strong> {o.why}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {other === null ? (
              <button className="pe-escape" onClick={() => setOther("")}>
                {node.otherLabel ?? "Nenhuma dessas — escrever a minha…"}
              </button>
            ) : (
              <Attachable
                attachments={attached[node.id] ?? []}
                onChange={(next) =>
                  setAttached((m) => ({ ...m, [node.id]: next }))
                }
                hint="Cole ou arraste um print, um trecho de log…"
              >
                <div className="pe-escape-row">
                  <input
                    className="pd-input"
                    autoFocus
                    placeholder="Sua resposta…"
                    value={other}
                    onChange={(e) => setOther(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && commit(node.id, other)
                    }
                  />
                  <button
                    className="pa-btn pa-btn--primary"
                    onClick={() => commit(node.id, other)}
                  >
                    Continuar ⏎
                  </button>
                </div>
              </Attachable>
            )}
          </>
        )}

        {node.kind === "text" && (
          <>
            {node.hint && <p className="pe-hint">{node.hint}</p>}
            <Attachable
              attachments={attached[node.id] ?? []}
              onChange={(next) =>
                setAttached((m) => ({ ...m, [node.id]: next }))
              }
            >
              <textarea
                className="pa-input pa-input--area pe-textarea"
                autoFocus
                rows={node.rows ?? 4}
                placeholder={node.placeholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </Attachable>
            <div className="pe-actions">
              <button
                className="pa-btn pa-btn--primary"
                onClick={() => commit(node.id, draft)}
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {node.kind === "note" && (
          <div className="pe-note">
            <p className="pe-note__finding">{node.finding}</p>
            <p className="pe-note__source">
              Li: <code>{node.source}</code>
            </p>
            <div className="pe-actions">
              <button
                className="pa-btn pa-btn--ghost"
                onClick={() => commit(node.id, "corrigir")}
              >
                Está errado, quero decidir
              </button>
              <button
                className="pa-btn pa-btn--primary"
                onClick={() => commit(node.id, "ok")}
              >
                Seguir
              </button>
            </div>
          </div>
        )}

        {node.kind === "handoff" && (
          <div className="pe-handoff">
            <pre className="pe-handoff__cmd">
              {`/devy:debug ${(answers["describe"] ?? "").trim() || "…"}`}
            </pre>
            <dl className="pe-handoff__ctx">
              <div>
                <dt>Tipo</dt>
                <dd>{answers["track"]}</dd>
              </div>
              <div>
                <dt>Reprodução</dt>
                <dd>{answers["repro"] ?? "—"}</dd>
              </div>
              <div>
                <dt>Evidência</dt>
                <dd>{answers["evidence"] ?? "—"}</dd>
              </div>
            </dl>
            <p className="pe-hint">
              Nenhum arquivo é criado agora. Se a investigação virar trabalho,
              ela volta para a trilha da feature e aí sim vira spec/plan/todo.
            </p>
            <div className="pe-actions">
              <button className="pa-btn pa-btn--ghost" onClick={back}>
                Ajustar contexto
              </button>
              <button className="pa-btn pa-btn--primary">
                Investigar agora
              </button>
            </div>
          </div>
        )}

        {/* No review of the file contents — the last answer commits, and the
            screen only reports progress. */}
        {node.kind === "save" && (
          <div className="pe-saving">
            {saved ? (
              <>
                <span className="pe-saving__check" aria-hidden="true">
                  ✓
                </span>
                <p className="pe-saving__label">Salvo</p>
                <p className="pe-saving__path">
                  <code>{CHANGE_DIR}/</code>
                </p>
                <p className="pe-saving__files">
                  {SAVED_FILE_NAMES.join(" · ")}
                </p>
                <div className="pe-actions pe-saving__actions">
                  <button className="pa-btn pa-btn--primary">
                    Abrir o board
                  </button>
                </div>
              </>
            ) : (
              <>
                <span
                  className="pe-spinner"
                  role="status"
                  aria-label="Salvando"
                />
                <p className="pe-saving__label">Salvando…</p>
                <p className="pe-saving__path">
                  <code>{CHANGE_DIR}/</code>
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <footer className="pe-foot">
        {/* Once the write started there is nothing to go back to. */}
        <button
          className="pe-back"
          onClick={back}
          disabled={cursor === 0 || node.kind === "save"}
        >
          ← Voltar
        </button>
        <ol className="pe-trail">
          {phases.map((p) => {
            // Done only once the LAST node of that phase is behind the cursor.
            const last = sequence.map((n) => n.phase).lastIndexOf(p);
            const state =
              p === node.phase
                ? " is-current"
                : last > -1 && last < cursor
                  ? " is-done"
                  : "";
            return (
              <li className={"pe-trail__item" + state} key={p}>
                {PHASE_LABEL[p]}
              </li>
            );
          })}
          {!track && (
            <li className="pe-trail__item pe-trail__item--pending">…</li>
          )}
        </ol>
      </footer>
    </div>
  );
}
