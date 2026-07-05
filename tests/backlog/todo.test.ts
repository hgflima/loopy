import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BacklogError,
  backlogOptionsFrom,
  loadBacklog,
  markDone,
  markDoneInFile,
  parseBacklog,
  pendingTasks,
} from "../../src/backlog/todo";
import type { BacklogConfig } from "../../src/types";

const FIXTURE = fileURLToPath(new URL("../fixtures/todo.md", import.meta.url));

/** The committed fixture, read fresh so parser tests share one real backlog. */
function fixtureSource(): string {
  return readFileSync(FIXTURE, "utf8");
}

describe("parseBacklog — extraction", () => {
  it("returns every task in file order with its done flag", () => {
    const tasks = parseBacklog(fixtureSource());

    expect(tasks.map((t) => t.id)).toEqual([
      "T-001",
      "T-002",
      "T-003",
      "T-010",
      "T-011",
    ]);
    expect(tasks.map((t) => t.done)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("extracts id, title, slug and branch from the checkbox line", () => {
    const [first] = parseBacklog(fixtureSource());

    expect(first?.id).toBe("T-001");
    expect(first?.title).toBe("Scaffold do projeto + types.ts");
    expect(first?.slug).toBe("scaffold-do-projeto-types-ts");
    expect(first?.branch).toBe("T-001-scaffold-do-projeto-types-ts");
  });

  it("captures the indented block beneath the checkbox as the body, dedented", () => {
    const tasks = parseBacklog(fixtureSource());
    const t001 = tasks.find((t) => t.id === "T-001");

    expect(t001?.body).toBe(
      [
        "package.json (ESM) + tsconfig estrito + eslint/prettier + vitest.",
        "src/types.ts com Task, StepConfig, StepResult. Depende de nada.",
      ].join("\n"),
    );
  });

  it("treats an indented checkbox inside a body as text, not a task", () => {
    const tasks = parseBacklog(fixtureSource());

    // The `- [ ]` inside T-003's body must not create a phantom task.
    expect(tasks.map((t) => t.id)).not.toContain("");
    const t003 = tasks.find((t) => t.id === "T-003");
    expect(t003?.body).toContain("`- [ ]` literal no meio do texto");
  });

  it("yields an empty body when a task has no indented block", () => {
    const t010 = parseBacklog(fixtureSource()).find((t) => t.id === "T-010");

    expect(t010?.body).toBe("");
  });

  it("skips a leading blank line between the checkbox and its body", () => {
    const t011 = parseBacklog(fixtureSource()).find((t) => t.id === "T-011");

    expect(t011?.body).toBe("body após linha em branco interna.");
  });

  it("strips diacritics when building a branch-safe slug", () => {
    const [task] = parseBacklog("- [ ] T-042: Configuração & Cache");

    expect(task?.slug).toBe("configuracao-cache");
    expect(task?.branch).toBe("T-042-configuracao-cache");
  });

  it("honors a custom branch builder", () => {
    const [task] = parseBacklog("- [ ] T-007: Widget", {
      branchFor: ({ id }) => `loopy/${id}`,
    });

    expect(task?.branch).toBe("loopy/T-007");
  });
});

describe("parseBacklog — custom markers and pattern", () => {
  it("respects configured markers and task id pattern", () => {
    const source = ["* [ ] TASK-9: Alt markers", "* [X] TASK-8: Done alt"].join(
      "\n",
    );

    const tasks = parseBacklog(source, {
      pendingMarker: "* [ ]",
      doneMarker: "* [X]",
      taskIdPattern: "TASK-\\d+",
    });

    expect(tasks.map((t) => t.id)).toEqual(["TASK-9", "TASK-8"]);
    expect(tasks.map((t) => t.done)).toEqual([false, true]);
  });
});

describe("pendingTasks", () => {
  it("keeps only unfinished tasks, preserving file order", () => {
    const pending = pendingTasks(parseBacklog(fixtureSource()));

    expect(pending.map((t) => t.id)).toEqual([
      "T-002",
      "T-003",
      "T-010",
      "T-011",
    ]);
  });
});

describe("markDone", () => {
  it("flips only the target checkbox from pending to done", () => {
    const next = markDone(fixtureSource(), "T-002");

    const tasks = parseBacklog(next);
    expect(tasks.find((t) => t.id === "T-002")?.done).toBe(true);
    // Every other task keeps its original state.
    expect(tasks.find((t) => t.id === "T-001")?.done).toBe(true);
    expect(tasks.find((t) => t.id === "T-003")?.done).toBe(false);
    expect(tasks.find((t) => t.id === "T-010")?.done).toBe(false);
  });

  it("preserves the rest of the file verbatim (only the marker changes)", () => {
    const source = fixtureSource();
    const next = markDone(source, "T-002");

    const expected = source.replace("- [ ] T-002:", "- [x] T-002:");
    expect(next).toBe(expected);
  });

  it("is idempotent — marking an already-done task is a no-op", () => {
    const source = fixtureSource();

    expect(markDone(source, "T-001")).toBe(source);
  });

  it("is idempotent across repeated calls on a pending task", () => {
    const once = markDone(fixtureSource(), "T-003");
    const twice = markDone(once, "T-003");

    expect(twice).toBe(once);
  });

  it("does not disturb a `- [ ]` that lives inside another task's body", () => {
    const next = markDone(fixtureSource(), "T-002");

    expect(next).toContain("`- [ ]` literal no meio do texto");
    expect(parseBacklog(next).find((t) => t.id === "T-003")?.done).toBe(false);
  });

  it("throws BacklogError for an unknown id", () => {
    expect(() => markDone(fixtureSource(), "T-999")).toThrow(BacklogError);
    expect(() => markDone(fixtureSource(), "T-999")).toThrow(/T-999/);
  });

  it("preserves CRLF line endings and the trailing newline", () => {
    const source = "- [ ] T-001: A\r\n- [x] T-002: B\r\n";

    const next = markDone(source, "T-001");

    expect(next).toBe("- [x] T-001: A\r\n- [x] T-002: B\r\n");
  });
});

describe("loadBacklog / markDoneInFile", () => {
  const dirs: string[] = [];

  afterEach(() => {
    dirs.length = 0;
  });

  function tempTodo(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "loopy-backlog-"));
    dirs.push(dir);
    const path = join(dir, "todo.md");
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("loadBacklog reads and parses a file from disk", () => {
    const path = tempTodo(fixtureSource());

    expect(loadBacklog(path).map((t) => t.id)).toEqual([
      "T-001",
      "T-002",
      "T-003",
      "T-010",
      "T-011",
    ]);
  });

  it("markDoneInFile rewrites the file and reports the change", () => {
    const path = tempTodo(fixtureSource());

    const changed = markDoneInFile(path, "T-002");

    expect(changed).toBe(true);
    expect(loadBacklog(path).find((t) => t.id === "T-002")?.done).toBe(true);
  });

  it("markDoneInFile leaves the file untouched and reports no change when idempotent", () => {
    const path = tempTodo(fixtureSource());
    const before = readFileSync(path, "utf8");

    const changed = markDoneInFile(path, "T-001");

    expect(changed).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("backlogOptionsFrom", () => {
  it("maps a BacklogConfig into parser options", () => {
    const cfg: BacklogConfig = {
      pending_marker: "* [ ]",
      done_marker: "* [X]",
      task_id_pattern: "TASK-\\d+",
      body: "indented",
      mark_done_on_success: true,
    };

    const [task] = parseBacklog(
      "* [ ] TASK-1: Bridge",
      backlogOptionsFrom(cfg),
    );

    expect(task?.id).toBe("TASK-1");
  });
});

describe("parseBacklog — deps parsing", () => {
  it("parses Deps: line into task.deps array", () => {
    const tasks = parseBacklog(fixtureSource());
    const t002 = tasks.find((t) => t.id === "T-002");

    expect(t002?.deps).toEqual(["T-001"]);
  });

  it("parses multiple deps separated by commas", () => {
    const tasks = parseBacklog(fixtureSource());
    const t003 = tasks.find((t) => t.id === "T-003");

    expect(t003?.deps).toEqual(["T-001", "T-002"]);
  });

  it("returns empty array when no Deps: line is present", () => {
    const tasks = parseBacklog(fixtureSource());
    const t001 = tasks.find((t) => t.id === "T-001");

    expect(t001?.deps).toEqual([]);
  });

  it("returns empty array for tasks with no body", () => {
    const tasks = parseBacklog(fixtureSource());
    const t010 = tasks.find((t) => t.id === "T-010");

    expect(t010?.deps).toEqual([]);
  });

  it("treats 'nenhuma' (any case) as no deps", () => {
    const source = [
      "- [ ] T-001: First task",
      "      Deps: nenhuma",
    ].join("\n");

    const [task] = parseBacklog(source);
    expect(task?.deps).toEqual([]);
  });

  it("treats 'Nenhuma' (capitalized) as no deps", () => {
    const source = [
      "- [ ] T-001: First task",
      "      Deps: Nenhuma",
    ].join("\n");

    const [task] = parseBacklog(source);
    expect(task?.deps).toEqual([]);
  });

  it("is case-insensitive on the Deps: prefix", () => {
    const source = [
      "- [ ] T-001: First",
      "- [ ] T-002: Second",
      "      deps: T-001",
    ].join("\n");

    const tasks = parseBacklog(source);
    expect(tasks[1]?.deps).toEqual(["T-001"]);
  });

  it("tolerates extra spaces around commas and ids", () => {
    const source = [
      "- [ ] T-001: A",
      "- [ ] T-002: B",
      "- [ ] T-003: C",
      "      Deps:  T-001 , T-002 ",
    ].join("\n");

    const tasks = parseBacklog(source);
    expect(tasks[2]?.deps).toEqual(["T-001", "T-002"]);
  });

  it("ignores dep ids that don't match task_id_pattern", () => {
    const source = [
      "- [ ] T-001: A",
      "- [ ] T-002: B",
      "      Deps: T-001, INVALID, T-999",
    ].join("\n");

    const tasks = parseBacklog(source);
    // T-001 and T-999 match T-\\d+ but INVALID does not
    expect(tasks[1]?.deps).toEqual(["T-001", "T-999"]);
  });

  it("respects custom deps_pattern", () => {
    const source = [
      "- [ ] T-001: A",
      "- [ ] T-002: B",
      "      Requires: T-001",
    ].join("\n");

    const tasks = parseBacklog(source, { depsPattern: "Requires:" });
    expect(tasks[1]?.deps).toEqual(["T-001"]);
  });

  it("preserves body byte-for-byte including the Deps: line", () => {
    const source = [
      "- [ ] T-001: First",
      "- [ ] T-002: Second task",
      "      Some description.",
      "      Deps: T-001",
    ].join("\n");

    const tasks = parseBacklog(source);
    expect(tasks[1]?.body).toBe("Some description.\nDeps: T-001");
    expect(tasks[1]?.deps).toEqual(["T-001"]);
  });
});
