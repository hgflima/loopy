/**
 * useInsights — ponte de leitura/escrita da aba Insights (T-011, molde
 * `useAgentCapabilities`).
 *
 * **Leitura** (SELECT-only pelo Rust `rusqlite`, D19): carrega a lista de changes
 * (`v_change`), o baseline histórico (`v_change_baseline`) e as tasks da change em
 * foco (`v_task`) por comandos Tauri. Degrada graciosamente (OQ3): sem `.db` — ou
 * fora do Tauri (dev:web) — tudo volta vazio e o status vira `empty`/`idle`, então
 * a aba mostra "sem telemetria" em vez de quebrar. Funciona **em idle** (revisão
 * fria) e **durante o run** — é só leitura de um arquivo.
 *
 * **Escrita** (write-back, D6/D20): veredito e bug **nunca** tocam o `.db` daqui —
 * são invocações one-shot do CLI `loopy` (os comandos Rust `insights_*` da T-009).
 * Quem invoca chama `reload()` depois para reprojetar a tela.
 *
 * Corrida: cada carga carimba um `reqRef` incremental e só publica se ainda é a
 * resposta corrente — trocar a change em foco no meio de um fetch nunca pinta a
 * tela com as tasks da change anterior.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import type { ChangeRow, BaselineRow, TaskRow, StepRow } from "./rows";
import { pickDefaultThisChange } from "./selection";

/** Estado da carga do índice (lista + baseline + tasks da change em foco). */
export type InsightsStatus = "idle" | "loading" | "ready" | "empty" | "error";

/** O que o hook devolve para a `InsightsPane`. */
export interface UseInsights {
  readonly status: InsightsStatus;
  /** Todas as changes conhecidas (newest-first) — o dropdown e os defaults. */
  readonly changeList: ChangeRow[];
  /** Média±desvio das merged (`null` quando não há `.db`/nenhuma merged). */
  readonly baseline: BaselineRow | null;
  /** Tasks da change em foco (vazio até `changeId` estar definido). */
  readonly tasks: TaskRow[];
  readonly error?: string;
  /** Re-carrega tudo — chamado após um write-back (veredito/bug). */
  readonly reload: () => void;
}

/**
 * Carrega o índice da aba para `dir`, com as tasks da change `changeId`.
 *
 * Mantém os dados anteriores durante uma recarga (status `loading` sem limpar a
 * tela) — trocar a change em foco não pisca o cabeçalho para vazio.
 */
export function useInsights(dir: string | undefined, changeId: string | null): UseInsights {
  const [changeList, setChangeList] = useState<ChangeRow[]>([]);
  const [baseline, setBaseline] = useState<BaselineRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [status, setStatus] = useState<InsightsStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!dir || !isTauri()) {
      setChangeList([]);
      setBaseline(null);
      setTasks([]);
      setError(undefined);
      setStatus("idle");
      return;
    }

    const myReq = ++reqRef.current;
    setStatus("loading");

    void (async () => {
      try {
        const [changes, baselineRows] = await Promise.all([
          invoke<ChangeRow[]>("read_change_list", { dir }),
          invoke<BaselineRow[]>("read_baseline", { dir }),
        ]);
        // A change em foco: a selecionada pelo pai ou, antes dele sincronizar, o
        // default (a mais recente). Carregar as tasks aqui — na MESMA carga das
        // changes — evita uma 2ª rodada async que só o effect do pai dispararia:
        // sem isso o cabeçalho (ex. o contador `unrated`) pintava com a lista
        // vazia por um tick antes das tasks chegarem.
        const focus = changeId ?? pickDefaultThisChange(changes);
        const taskRows = focus
          ? await invoke<TaskRow[]>("read_task_insights", { dir, changeId: focus })
          : [];
        if (reqRef.current !== myReq) return;
        setChangeList(changes);
        setBaseline(baselineRows[0] ?? null);
        setTasks(taskRows);
        setError(undefined);
        setStatus(changes.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (reqRef.current !== myReq) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
  }, [dir, changeId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { status, changeList, baseline, tasks, error, reload };
}

/** Os passos (por-tentativa) de uma task expandida — a linha do tempo do SC1. */
export interface UseTaskSteps {
  readonly steps: StepRow[];
  readonly loading: boolean;
  readonly error?: string;
}

/**
 * Carrega `v_step` da task `taskId` (via `read_step_insights`). `null` em `taskId`
 * — nenhuma task expandida — devolve vazio sem invocar nada.
 */
export function useTaskSteps(dir: string | undefined, taskId: string | null): UseTaskSteps {
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!dir || !taskId || !isTauri()) {
      setSteps([]);
      setLoading(false);
      setError(undefined);
      return;
    }

    const myReq = ++reqRef.current;
    setLoading(true);

    void (async () => {
      try {
        const rows = await invoke<StepRow[]>("read_step_insights", { dir, taskId });
        if (reqRef.current !== myReq) return;
        setSteps(rows);
        setError(undefined);
        setLoading(false);
      } catch (err) {
        if (reqRef.current !== myReq) return;
        setSteps([]);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
  }, [dir, taskId]);

  return { steps, loading, error };
}

// ---------------------------------------------------------------------------
// Write-back — one-shot `loopy` CLI via os comandos Rust da T-009 (D6/D20)
// ---------------------------------------------------------------------------

/** O tri-estado que a tela envia: `pass`/`fail` fazem upsert; `clear` reverte (D20). */
export type VerdictAction = "pass" | "fail" | "clear";

/**
 * Grava (ou limpa) o veredito humano de uma task pelo CLI. `clear` deleta a linha
 * — o tri-estado volta a "não avaliada" (D20); `note`/`by` são ignorados nele.
 */
export function invokeSetVerdict(
  dir: string,
  task: string,
  verdict: VerdictAction,
  opts: { note?: string; by?: string } = {},
): Promise<string> {
  return invoke<string>("insights_set_verdict", {
    dir,
    task,
    verdict,
    note: opts.note,
    by: opts.by,
  });
}

/** Campos de um bug novo (o `foundIn` liga a uma change; padrão = a change atual). */
export interface NewBug {
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly title: string;
  readonly detail?: string;
  readonly foundIn?: string;
}

/**
 * Adiciona um bug ligado a uma task pelo CLI. Um bug de change anterior é o caso
 * normal (D14) — a FK é só `bug.task_id`, sem restrição de change.
 */
export function invokeAddBug(dir: string, task: string, bug: NewBug): Promise<string> {
  return invoke<string>("insights_add_bug", {
    dir,
    task,
    severity: bug.severity,
    title: bug.title,
    detail: bug.detail,
    foundIn: bug.foundIn,
  });
}
