/**
 * Estado de fluxo derivado do grafo — puro e testável isolado (AD-6).
 *
 * O `status` cru de uma task **não** diz onde ela está no fluxo: o motor
 * registra toda task que tem `Deps:` como `blocked` (`orchestrator.ts`), e ela
 * só sai desse status quando começa a rodar. Logo `blocked` significa "tem
 * dependência", não "é a próxima" — pintar o anel direto do status acenderia de
 * âmbar o backlog inteiro desde o primeiro segundo do Run.
 *
 * O que o grafo precisa mostrar é a **frente de onda**: quem roda a seguir. Isso
 * é derivado das arestas + status, nunca do status sozinho.
 */
import type { TaskStatus } from "loopy/tui/store";
import { TASK_STATUS_META, type Tone } from "../ui";

/** Statuses de uma task que ainda não começou e espera a sua vez. */
const AWAITING: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["pending", "blocked"]);

/** Uma dep está "vencida" quando já terminou ou está terminando agora. */
function depCleared(status: TaskStatus | undefined): boolean {
  return status === "done" || status === "running";
}

/**
 * Ids da **frente de onda** — as tasks que rodam a seguir.
 *
 * Uma task ainda não iniciada entra na frente quando *cada* dep sua já está
 * `done` (pronta para escalar agora) ou `running` (espera só o que roda neste
 * instante). Task com uma dep de status desconhecido fica fora (fail-closed).
 *
 * `limit` (= `concurrency`) corta a frente às primeiras N tasks **na ordem do
 * backlog** — que é a ordem de iteração de `statusById`, construído a partir da
 * lista de tasks. Sem esse corte, um backlog sem nenhuma `Deps:` acenderia
 * inteiro: sem arestas, *toda* task satisfaz a regra vacuamente. Omitir `limit`
 * não corta nada — melhor acender demais que apagar a próxima de verdade.
 */
export function wavefront(
  statusById: ReadonlyMap<string, TaskStatus>,
  edges: readonly (readonly [string, string])[],
  limit: number = Infinity,
): ReadonlySet<string> {
  const depsOf = new Map<string, string[]>();
  for (const [dep, dependent] of edges) {
    const deps = depsOf.get(dependent);
    if (deps) deps.push(dep);
    else depsOf.set(dependent, [dep]);
  }

  const front = new Set<string>();
  for (const [id, status] of statusById) {
    if (front.size >= limit) break;
    if (!AWAITING.has(status)) continue;
    const deps = depsOf.get(id) ?? [];
    if (deps.every((dep) => depCleared(statusById.get(dep)))) front.add(id);
  }
  return front;
}

/** Tone + rótulo do anel de um card. Espelha a forma de `TASK_STATUS_META`. */
export interface NodeStatusMeta {
  readonly tone: Tone;
  readonly label: string;
  readonly hollow?: boolean;
}

/**
 * Status (+ posição no fluxo) → tone e rótulo do anel.
 *
 * `TASK_STATUS_META` segue a fonte única de status→tone; esta função só
 * **reinterpreta a espera** à luz do grafo: quem espera na frente de onda é a
 * próxima (âmbar, "Next"); quem espera atrás dela fica quieto (cinza neutro).
 * Os demais status (running/done/escalated/paused/skipped) passam intactos — a
 * cor deles é do status, não da posição.
 *
 * O rótulo acompanha a cor porque cor nunca é o único canal (Meaning-Only Rule):
 * sem isso, "próxima" e "esperando" ficariam indistinguíveis sem enxergar hue.
 */
export function nodeStatusMeta(status: TaskStatus, onWavefront: boolean): NodeStatusMeta {
  const meta = TASK_STATUS_META[status];
  if (!AWAITING.has(status)) return meta;
  return onWavefront
    ? { tone: "blocked", label: "Next", hollow: true }
    : { tone: "neutral", label: meta.label, hollow: true };
}

/** Fluxo de uma aresta: o que alimenta o agora, o que ele destrava, o já andado. */
export type EdgeFlow = "running" | "next" | "done";

/**
 * Fluxo de uma aresta `from → to`, por precedência:
 *
 * 1. entra numa `running` → `running` (o **antes** — cyan; vence o empate quando
 *    as duas pontas rodam, D2);
 * 2. entra numa task da **frente de onda** → `next` (o caminho que destrava a
 *    próxima — âmbar);
 * 3. liga duas `done` → `done` (o caminho já percorrido — verde). Uma aresta que
 *    sai de uma `done` para uma task ainda não iniciada **não** é verde: aquele
 *    trecho do caminho ainda não foi andado;
 * 4. qualquer outra → `null` (o resto do grafo fica quieto).
 *
 * A regra 2 é o que faz linha e card falarem a mesma língua: âmbar é sempre "a
 * próxima", nas duas notações. A regra anterior pintava de âmbar o que *saía* de
 * uma `running` — ou seja, toda dependente da task viva, inclusive uma que ainda
 * espera outras deps. O resultado era uma linha âmbar chegando num card cinza,
 * enquanto o caminho até a verdadeira próxima ficava apagado.
 */
export function edgeFlow(
  from: string,
  to: string,
  statusById: ReadonlyMap<string, TaskStatus>,
  front: ReadonlySet<string>,
): EdgeFlow | null {
  const source = statusById.get(from);
  const target = statusById.get(to);
  if (target === "running") return "running";
  if (front.has(to)) return "next";
  if (source === "done" && target === "done") return "done";
  return null;
}
