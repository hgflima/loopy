/**
 * InsightsPane — a 4ª aba da Native UI (C-0017, T-011).
 *
 * Lê a telemetria SQLite de uma change (via os comandos Rust SELECT-only, D19) e
 * a apresenta: um **cabeçalho de três colunas** (esta change · média±desvio das
 * merged · change comparada com Δ%, D22), um **toggle absoluto↔normalizado** por
 * churn (nasce absoluto), a marca de custo `estimated`, o contador de `unrated`, o
 * **badge/filtro de defeito escapado** (D23) e a **lista de tasks** com o controle
 * **tri-estado** de veredito que **expande nos passos** (custo por-tentativa, SC1).
 *
 * O write-back (veredito/`clear`/bug) invoca o CLI `loopy` pelos comandos Rust da
 * T-009 (D6/D20) e recarrega. Funciona **em idle** (revisão fria) e **durante o
 * run**; sem `.db` degrada para "sem telemetria" (OQ3). Toda a lógica de projeção
 * é pura (`./metrics`/`./tasks`/`./steps`/`./selection`/`./format`) — este arquivo
 * só orquestra estado e render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl, Button, type Segment } from "../ui";
import {
  buildInsights,
  buildStepViews,
  filterEscapedDefects,
  findChange,
  pickDefaultThisChange,
  pickDefaultCompared,
  type ChangeRow,
  type MetricMode,
  type StepRow,
  type TaskView,
  type Verdict,
} from "./index";
import { fmtValue, fmtBaseline, fmtDelta, deltaTone } from "./format";
import {
  useInsights,
  useTaskSteps,
  invokeSetVerdict,
  invokeAddBug,
  type VerdictAction,
  type NewBug,
} from "./useInsights";
import "./InsightsPane.css";

export interface InsightsPaneProps {
  /** Diretório-alvo — a raiz que contém `.db/telemetry.db`. */
  dir?: string;
}

const MODE_SEGMENTS: readonly Segment<MetricMode>[] = [
  { id: "absolute", label: "Absoluto" },
  { id: "normalized", label: "Normalizado" },
];

const SEVERITIES: readonly NewBug["severity"][] = ["low", "medium", "high", "critical"];

/** Rótulo legível de uma change no dropdown. */
function changeLabel(c: ChangeRow): string {
  return `${c.change_id} · ${c.status ?? "em andamento"}`;
}

export function InsightsPane({ dir }: InsightsPaneProps) {
  const [changeId, setChangeId] = useState<string | null>(null);
  const [comparedId, setComparedId] = useState<string | null>(null);
  const [mode, setMode] = useState<MetricMode>("absolute"); // nasce absoluto (spec §Tela)
  const [escapedOnly, setEscapedOnly] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { status, changeList, baseline, tasks, reload } = useInsights(dir, changeId);
  const { steps: stepRows, loading: stepsLoading } = useTaskSteps(dir, expandedTaskId);

  // Trocar de diretório zera a seleção — os defaults re-derivam do novo `.db`.
  const initializedRef = useRef(false);
  useEffect(() => {
    initializedRef.current = false;
    setChangeId(null);
    setComparedId(null);
    setExpandedTaskId(null);
  }, [dir]);

  // Defaults ao carregar a lista (D22): esta change = a mais recente; comparada =
  // a merged imediatamente anterior. Só na 1ª vez — depois o usuário manda.
  useEffect(() => {
    if (initializedRef.current || changeList.length === 0) return;
    const t = pickDefaultThisChange(changeList);
    setChangeId(t);
    setComparedId(pickDefaultCompared(changeList, t));
    initializedRef.current = true;
  }, [changeList]);

  const handleThisChange = useCallback(
    (id: string) => {
      setChangeId(id);
      // Re-deriva a comparada default para o novo foco (o usuário troca no dropdown).
      setComparedId(pickDefaultCompared(changeList, id));
      setExpandedTaskId(null);
    },
    [changeList],
  );

  // Todo write-back segue o mesmo protocolo: limpa o erro, invoca o CLI (D6/D20) e
  // recarrega; qualquer falha vira a faixa de erro. Um único ponto para os dois.
  const runWriteBack = useCallback(
    (op: () => Promise<unknown>) => {
      setActionError(null);
      void (async () => {
        try {
          await op();
          reload();
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [reload],
  );

  const handleVerdict = useCallback(
    (taskId: string, action: VerdictAction) => {
      if (!dir) return;
      runWriteBack(() => invokeSetVerdict(dir, taskId, action));
    },
    [dir, runWriteBack],
  );

  const handleAddBug = useCallback(
    (taskId: string, bug: NewBug) => {
      if (!dir) return;
      runWriteBack(() => invokeAddBug(dir, taskId, { ...bug, foundIn: changeId ?? undefined }));
    },
    [dir, changeId, runWriteBack],
  );

  // Sem `.db` (ou fora do Tauri): degrada para "sem telemetria" (OQ3).
  if (status === "idle" || status === "empty") {
    return (
      <div className="insights" data-testid="insights-pane">
        <div className="insights__empty" data-testid="insights-empty">
          <p className="insights__empty-title">Sem telemetria</p>
          <p className="insights__empty-hint">
            Esta pasta não tem <code>.db/telemetry.db</code>. Rode uma change com o bloco{" "}
            <code>metrics:</code> no <code>loopy.yml</code> para popular a aba.
          </p>
        </div>
      </div>
    );
  }

  // Enquanto o effect de inicialização (defaults D22) ainda não rodou, `changeId`
  // é `null` mas a lista já chegou — o render já usa os defaults derivados. Sem
  // isso o cabeçalho pisca "—" por um frame (status `ready` + `changeId` null),
  // uma corrida que a suíte concorrente expõe. Uma vez que o usuário escolhe uma
  // change (`changeId` != null), a seleção crua manda — inclusive comparada `null`.
  const effectiveChangeId = changeId ?? pickDefaultThisChange(changeList);
  const effectiveComparedId =
    changeId === null ? pickDefaultCompared(changeList, effectiveChangeId) : comparedId;
  const thisChange = findChange(changeList, effectiveChangeId);
  const comparedChange = findChange(changeList, effectiveComparedId);
  const model = buildInsights({ thisChange, comparedChange, baseline, tasks }, mode);
  const visibleTasks = escapedOnly ? filterEscapedDefects(model.tasks) : model.tasks;
  const comparedHeader = comparedChange ? comparedChange.change_id : "Comparada";

  return (
    <div className="insights" data-testid="insights-pane">
      {/* ---- Toolbar: seleção, toggle, contadores, badge ---- */}
      <div className="insights__toolbar">
        <label className="insights__select">
          <span className="insights__select-label">Esta change</span>
          <select
            className="insights__select-input"
            data-testid="insights-this-change"
            value={effectiveChangeId ?? ""}
            onChange={(e) => handleThisChange(e.target.value)}
          >
            {changeList.map((c) => (
              <option key={c.change_id} value={c.change_id}>
                {changeLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <label className="insights__select">
          <span className="insights__select-label">Comparar com</span>
          <select
            className="insights__select-input"
            data-testid="insights-compared-change"
            value={effectiveComparedId ?? ""}
            onChange={(e) => setComparedId(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">(nenhuma)</option>
            {changeList
              .filter((c) => c.change_id !== effectiveChangeId)
              .map((c) => (
                <option key={c.change_id} value={c.change_id}>
                  {changeLabel(c)}
                </option>
              ))}
          </select>
        </label>

        <SegmentedControl
          segments={MODE_SEGMENTS}
          value={mode}
          onChange={setMode}
          ariaLabel="Modo do cabeçalho"
        />

        <div className="insights__toolbar-spacer" />

        <span className="insights__unrated" data-testid="insights-unrated">
          {model.unrated} não avaliada{model.unrated === 1 ? "" : "s"}
        </span>

        {model.hasEstimated && (
          <span
            className="insights__estimated"
            data-testid="insights-estimated"
            title="Algum custo é aproximado (o dialeto não separou os contadores)"
          >
            ≈ estimado
          </span>
        )}

        {model.escapedDefects > 0 && (
          <button
            type="button"
            className={`insights__escaped${escapedOnly ? " is-active" : ""}`}
            data-testid="insights-escaped-filter"
            aria-pressed={escapedOnly}
            onClick={() => setEscapedOnly((v) => !v)}
            title="Tasks que mergearam mas o humano reprovou (defeito escapado, D23)"
          >
            ⚠ {model.escapedDefects} escapado{model.escapedDefects === 1 ? "" : "s"}
          </button>
        )}

        <Button variant="secondary" onClick={reload} data-testid="insights-reload">
          Atualizar
        </Button>
      </div>

      {actionError && (
        <div className="insights__error" role="alert" data-testid="insights-action-error">
          {actionError}
        </div>
      )}

      {/* ---- Cabeçalho de três colunas ---- */}
      <table className="insights__header" data-testid="insights-header">
        <thead>
          <tr>
            <th className="insights__h-metric">Métrica</th>
            <th>Esta change</th>
            <th>Média (merged)</th>
            <th data-testid="insights-compared-header">{comparedHeader} (Δ)</th>
          </tr>
        </thead>
        <tbody>
          {model.header.map((row) => {
            const tone = deltaTone(row.deltaPct, row.direction);
            return (
              <tr key={row.key} data-testid={`metric-${row.key}`}>
                <th scope="row" className="insights__h-metric">
                  {row.label}
                  {row.mode === "normalized" && <span className="insights__h-norm">/L</span>}
                  {row.estimated && (
                    <span className="insights__h-est" title="custo aproximado">
                      {" "}
                      ≈
                    </span>
                  )}
                </th>
                <td data-testid={`metric-${row.key}-current`}>
                  {fmtValue(row.current, row.format, row.mode)}
                </td>
                <td className="insights__h-baseline">
                  {fmtBaseline(row.baselineMean, row.baselineSd, row.format, row.mode)}
                </td>
                <td>
                  <span className="insights__h-compared">
                    {fmtValue(row.compared, row.format, row.mode)}
                  </span>
                  <span
                    className={`insights__delta insights__delta--${tone}`}
                    data-testid={`metric-${row.key}-delta`}
                  >
                    {fmtDelta(row.deltaPct)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ---- Lista de tasks ---- */}
      {visibleTasks.length === 0 ? (
        <p className="insights__no-tasks" data-testid="insights-no-tasks">
          {escapedOnly ? "Nenhum defeito escapado." : "Nenhuma task nesta change."}
        </p>
      ) : (
        <ul className="insights__tasks">
          {visibleTasks.map((t) => {
            const isExpanded = expandedTaskId === t.taskId;
            return (
              <TaskItem
                key={t.taskId}
                task={t}
                expanded={isExpanded}
                onToggle={() =>
                  setExpandedTaskId((cur) => (cur === t.taskId ? null : t.taskId))
                }
                stepRows={isExpanded ? stepRows : []}
                stepsLoading={isExpanded && stepsLoading}
                onSetVerdict={(action) => handleVerdict(t.taskId, action)}
                onAddBug={(bug) => handleAddBug(t.taskId, bug)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tri-state verdict control
// ---------------------------------------------------------------------------

/**
 * O controle tri-estado do veredito: Pass / Fail, e clicar no ativo reverte para
 * "não avaliada" (`clear`, D20). O estado atual vem de `verdict`.
 */
function VerdictControl({
  taskId,
  verdict,
  onSet,
}: {
  taskId: string;
  verdict: Verdict;
  onSet: (action: VerdictAction) => void;
}) {
  return (
    <div className="verdict" role="group" aria-label="Veredito humano">
      <button
        type="button"
        className={`verdict__btn verdict__btn--pass${verdict === "pass" ? " is-active" : ""}`}
        aria-pressed={verdict === "pass"}
        data-testid={`verdict-pass-${taskId}`}
        onClick={() => onSet(verdict === "pass" ? "clear" : "pass")}
      >
        Pass
      </button>
      <button
        type="button"
        className={`verdict__btn verdict__btn--fail${verdict === "fail" ? " is-active" : ""}`}
        aria-pressed={verdict === "fail"}
        data-testid={`verdict-fail-${taskId}`}
        onClick={() => onSet(verdict === "fail" ? "clear" : "fail")}
      >
        Fail
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task row — verdict, escaped badge, bug form, step expansion
// ---------------------------------------------------------------------------

function TaskItem({
  task,
  expanded,
  onToggle,
  stepRows,
  stepsLoading,
  onSetVerdict,
  onAddBug,
}: {
  task: TaskView;
  expanded: boolean;
  onToggle: () => void;
  stepRows: StepRow[];
  stepsLoading: boolean;
  onSetVerdict: (action: VerdictAction) => void;
  onAddBug: (bug: NewBug) => void;
}) {
  const [bugOpen, setBugOpen] = useState(false);
  const steps = buildStepViews(stepRows);

  return (
    <li className="insights__task" data-testid={`task-${task.taskId}`}>
      <div className="insights__task-row">
        <button
          type="button"
          className="insights__task-head"
          data-testid={`task-toggle-${task.taskId}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="insights__task-caret">{expanded ? "▾" : "▸"}</span>
          <span className="insights__task-num">{task.taskNumber}</span>
          <span className="insights__task-name">{task.name}</span>
        </button>

        <div className="insights__task-meta">
          {task.escapedDefect && (
            <span
              className="insights__escaped-badge"
              data-testid={`escaped-${task.taskId}`}
              title="Defeito escapado: mergeou mas o humano reprovou (D23)"
            >
              ⚠
            </span>
          )}
          <span className="insights__task-cost" title="custo da task">
            {fmtValue(task.costUsd, "usd")}
            {task.estimated && <span className="insights__h-est" title="aproximado"> ≈</span>}
          </span>
          <span className="insights__task-attempts" title="voltas do fix-loop (MAX visit_no)">
            {task.attempts ?? "—"}×
          </span>
          {task.bugs > 0 && (
            <span
              className="insights__task-bugs"
              data-testid={`bugs-${task.taskId}`}
              title={`${task.bugs} bug(s), ${task.bugsOpen} aberto(s)`}
            >
              🐞 {task.bugs}
            </span>
          )}
          <VerdictControl taskId={task.taskId} verdict={task.verdict} onSet={onSetVerdict} />
          <button
            type="button"
            className="insights__bug-toggle"
            data-testid={`bug-add-${task.taskId}`}
            aria-expanded={bugOpen}
            onClick={() => setBugOpen((v) => !v)}
          >
            + bug
          </button>
        </div>
      </div>

      {bugOpen && (
        <BugForm
          taskId={task.taskId}
          onSubmit={(bug) => {
            onAddBug(bug);
            setBugOpen(false);
          }}
          onCancel={() => setBugOpen(false)}
        />
      )}

      {expanded && (
        <div className="insights__steps" data-testid={`steps-${task.taskId}`}>
          {stepsLoading ? (
            <p className="insights__steps-loading">Carregando passos…</p>
          ) : steps.length === 0 ? (
            <p className="insights__steps-empty">Sem passos registrados.</p>
          ) : (
            <table className="insights__steps-table">
              <thead>
                <tr>
                  <th>Passo</th>
                  <th>Visita/Tent.</th>
                  <th>Status</th>
                  <th>Custo</th>
                  <th>Tokens</th>
                  <th>Trabalho</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.stepId} data-testid={`step-${s.stepId}`}>
                    <td>
                      <span className="insights__step-name">{s.name}</span>
                      <span className="insights__step-kind">{s.kind}</span>
                    </td>
                    <td>
                      {s.visitNo}/{s.attemptNo}
                    </td>
                    <td>
                      <span className={`insights__step-status insights__step-status--${s.ok ? "ok" : "bad"}`}>
                        {s.status}
                      </span>
                      {s.failReason && <span className="insights__step-fail"> {s.failReason}</span>}
                    </td>
                    <td data-testid={`step-cost-${s.stepId}`}>
                      {fmtValue(s.costUsd, "usd")}
                      {s.estimated && <span className="insights__h-est"> ≈</span>}
                    </td>
                    <td>{s.tokensTotal.toLocaleString("pt-BR")}</td>
                    <td>{fmtValue(s.workS, "duration")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inline bug form
// ---------------------------------------------------------------------------

function BugForm({
  taskId,
  onSubmit,
  onCancel,
}: {
  taskId: string;
  onSubmit: (bug: NewBug) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<NewBug["severity"]>("medium");
  const [detail, setDetail] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({ severity, title: title.trim(), detail: detail.trim() || undefined });
  };

  return (
    <form
      className="insights__bug-form"
      data-testid={`bug-form-${taskId}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="insights__bug-input"
        data-testid={`bug-title-${taskId}`}
        placeholder="Título do bug"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        spellCheck={false}
      />
      <select
        className="insights__bug-severity"
        data-testid={`bug-severity-${taskId}`}
        value={severity}
        onChange={(e) => setSeverity(e.target.value as NewBug["severity"])}
      >
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        className="insights__bug-input"
        placeholder="Detalhe (opcional)"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        spellCheck={false}
      />
      <Button
        variant="primary"
        type="submit"
        disabled={!title.trim()}
        data-testid={`bug-submit-${taskId}`}
      >
        Adicionar
      </Button>
      <Button variant="secondary" onClick={onCancel} data-testid={`bug-cancel-${taskId}`}>
        Cancelar
      </Button>
    </form>
  );
}
