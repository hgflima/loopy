/**
 * Pure scheduler functions for the task dependency graph (AD-6).
 *
 * Operates on the **complete** backlog (done + pending). Tasks marked `[x]`
 * enter as nodes with pre-satisfied status (`done`). The graph is a DAG;
 * cycles and orphan deps are detected as error-values (AD-5).
 *
 * No I/O — every function is pure and deterministic.
 */
import type { Task } from "../types";
import type { SchedulerTaskStatus, TaskGraph } from "./types";

// ---------------------------------------------------------------------------
// Result type (AD-5 — errors as values)
// ---------------------------------------------------------------------------

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build an adjacency list from edges: `keyIndex → valueIndex[]`. */
function adjMap(
  edges: readonly (readonly [string, string])[],
  keyIndex: 0 | 1,
): Map<string, string[]> {
  const valueIndex = keyIndex === 0 ? 1 : 0;
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const key = edge[keyIndex];
    const val = edge[valueIndex];
    let list = adj.get(key);
    if (!list) {
      list = [];
      adj.set(key, list);
    }
    list.push(val);
  }
  return adj;
}

/** Forward adjacency: dep → dependentes. */
function childrenOf(edges: readonly (readonly [string, string])[]): Map<string, string[]> {
  return adjMap(edges, 0);
}

/** Reverse adjacency: dependente → deps. */
function depsOf(edges: readonly (readonly [string, string])[]): Map<string, string[]> {
  return adjMap(edges, 1);
}

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

/**
 * Build the task dependency graph from the complete backlog.
 *
 * - Nodes = task ids in backlog (file) order.
 * - Edges = `[dep, dependente]` for each `task.deps` entry.
 * - Orphan dep (id not in backlog) → error listing the orphan + the task.
 * - Cycle → error listing the cycle path.
 *
 * Orphan detection runs before cycle detection (fail-fast on invalid refs).
 */
export function buildGraph(tasks: readonly Task[]): Result<TaskGraph> {
  const ids = new Set(tasks.map((t) => t.id));
  const nodes = tasks.map((t) => t.id);
  const edges: (readonly [string, string])[] = [];

  // 1. Validate deps + collect edges
  for (const task of tasks) {
    for (const dep of task.deps) {
      if (!ids.has(dep)) {
        return {
          ok: false,
          error: `Dep órfã: "${dep}" referenciada por "${task.id}" não existe no backlog.`,
        };
      }
      edges.push([dep, task.id]);
    }
  }

  // 2. Detect cycles via DFS
  const cycleError = detectCycle(nodes, childrenOf(edges));
  if (cycleError) {
    return { ok: false, error: cycleError };
  }

  return { ok: true, value: { nodes, edges } };
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS — three-color)
// ---------------------------------------------------------------------------

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/** Returns an error message if a cycle is found, or `null` if acyclic. */
function detectCycle(
  nodes: readonly string[],
  adj: ReadonlyMap<string, readonly string[]>,
): string | null {
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  for (const n of nodes) color.set(n, WHITE);

  for (const n of nodes) {
    if (color.get(n) !== WHITE) continue;
    const cycle = dfs(n, adj, color, parent);
    if (cycle) return `Ciclo detectado no grafo de dependências: ${cycle.join(" → ")} → ${cycle[0]}.`;
  }
  return null;
}

function dfs(
  node: string,
  adj: ReadonlyMap<string, readonly string[]>,
  color: Map<string, number>,
  parent: Map<string, string>,
): string[] | null {
  color.set(node, GRAY);

  for (const next of adj.get(node) ?? []) {
    const c = color.get(next);
    if (c === GRAY) {
      // Back edge — extract cycle
      const cycle: string[] = [next];
      let cur = node;
      while (cur !== next) {
        cycle.push(cur);
        cur = parent.get(cur)!;
      }
      cycle.reverse();
      return cycle;
    }
    if (c !== BLACK) {
      parent.set(next, node);
      const found = dfs(next, adj, color, parent);
      if (found) return found;
    }
  }

  color.set(node, BLACK);
  return null;
}

// ---------------------------------------------------------------------------
// readySet
// ---------------------------------------------------------------------------

/**
 * Compute the set of tasks that are ready to run: all deps must be `done`.
 * Returns ids in backlog order (deterministic tie-breaking).
 */
export function readySet(
  graph: TaskGraph,
  status: ReadonlyMap<string, SchedulerTaskStatus>,
): string[] {
  const deps = depsOf(graph.edges);
  const ready: string[] = [];

  for (const id of graph.nodes) {
    if (status.get(id) !== "blocked") continue;
    const taskDeps = deps.get(id);
    if (!taskDeps || taskDeps.every((dep) => status.get(dep) === "done")) {
      ready.push(id);
    }
  }
  return ready;
}

// ---------------------------------------------------------------------------
// skipDescendants
// ---------------------------------------------------------------------------

/**
 * Compute the transitive closure of descendants of a failed task.
 * Handles diamonds (A→{B,C}→D): D appears once.
 */
export function skipDescendants(
  graph: TaskGraph,
  failedId: string,
): Set<string> {
  const children = childrenOf(graph.edges);
  const result = new Set<string>();
  const queue = [failedId];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of children.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// topoLayers
// ---------------------------------------------------------------------------

/**
 * Compute topological layers (Kahn's algorithm). Tasks with no deps form
 * layer 0; tasks whose deps are all in prior layers form the next layer.
 * Within each layer, order is backlog order (deterministic).
 */
export function topoLayers(graph: TaskGraph): string[][] {
  if (graph.nodes.length === 0) return [];

  const inDegree = new Map<string, number>();
  for (const id of graph.nodes) inDegree.set(id, 0);
  for (const [, to] of graph.edges) {
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const children = childrenOf(graph.edges);
  const orderIndex = new Map(graph.nodes.map((id, i) => [id, i]));

  const layers: string[][] = [];
  let current = graph.nodes.filter((id) => inDegree.get(id) === 0);

  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    const nextSet = new Set<string>();

    for (const id of current) {
      for (const child of children.get(id) ?? []) {
        const d = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, d);
        if (d === 0 && !nextSet.has(child)) {
          nextSet.add(child);
          next.push(child);
        }
      }
    }

    next.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    current = next;
  }

  return layers;
}
