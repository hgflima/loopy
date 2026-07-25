/**
 * Tests for Interview — the assembled Specs Interview flow (C-0018, T-012).
 *
 * Interview is a **shell** (AD-6): it owns no flow logic. It renders the right
 * component for the current `stage` of the {@link useInterviewProcess} bridge
 * (T-010), whose reducer (T-009) is the single source of truth, and wires the
 * local human gestures (triage, describe, the gate) to `dispatch`/`start`.
 *
 * These tests drive it exactly as production does — through the bridge:
 * `isTauri()` is mocked true so the hook registers its `interview://` listeners,
 * and the test injects control frames by hand (the same technique as
 * `useInterviewProcess.test.ts`).
 *
 * Acceptance (spec.md / todo.md T-012):
 *  - triage → describe → the first `question_asked` renders a QuestionCard;
 *  - "Chega, grave o que temos" sends `phase_wrap_up` (D17);
 *  - `phase_finished` leads to the PhaseGate;
 *  - the `bug` trail reaches the Handoff **without the bridge being called**
 *    (no process is spawned — D4/D24);
 *  - closing returns to the list.
 *
 * Run: `npm test -w apps/menubar -- Interview`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Interview } from "./Interview";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  mockListen.mockClear();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// Injection helpers — pull the captured listener and fire a control frame
// ---------------------------------------------------------------------------

function lineListener(): (e: { payload: unknown }) => void {
  const call = mockListen.mock.calls.find(
    (c: unknown[]) => c[0] === "interview://line",
  );
  if (!call) throw new Error("no interview://line listener registered");
  return call[1] as (e: { payload: unknown }) => void;
}

/** Fire one control frame as the transport wraps it: `{ frame: "control", … }`. */
function emitControl(control: object): void {
  act(() =>
    lineListener()({
      payload: JSON.stringify({ frame: "control", ...control }),
    }),
  );
}

/** Every `start_interview` invocation (the process spawn). */
function startCalls(): unknown[][] {
  return mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === "start_interview",
  );
}

/** The most recent `send_interview_command` payload, parsed back. */
function lastCommand(): unknown {
  const call = [...mockInvoke.mock.calls]
    .reverse()
    .find((c: unknown[]) => c[0] === "send_interview_command");
  if (!call) throw new Error("no send_interview_command invoked");
  return JSON.parse((call[1] as { payload: string }).payload);
}

/** Advance triage → describe → submit a demand, for the given triage label. */
function reachDescribeAndSubmit(
  ui: ReturnType<typeof render>,
  triageLabel: string,
  demand: string,
): void {
  fireEvent.click(ui.getByText(triageLabel));
  const textarea = ui.container.querySelector("textarea");
  if (!textarea) throw new Error("no describe textarea");
  fireEvent.change(textarea, { target: { value: demand } });
  fireEvent.click(ui.getByText(/continuar/i));
}

// ---------------------------------------------------------------------------
// The assembled feature flow
// ---------------------------------------------------------------------------

describe("Interview — the feature trail", () => {
  it("triage → describe → question_asked renders a QuestionCard", () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );

    // Triage is LOCAL: choosing a trail spawns nothing yet.
    fireEvent.click(ui.getByText("Nova feature"));
    expect(startCalls()).toHaveLength(0);

    // Describe is LOCAL: submitting the demand begins the spec Phase — the
    // bridge is called exactly once (D4: a process only spawns at a Phase).
    const textarea = ui.container.querySelector("textarea")!;
    fireEvent.change(textarea, {
      target: { value: "um editor visual de specs" },
    });
    fireEvent.click(ui.getByText(/continuar/i));
    expect(startCalls()).toHaveLength(1);

    // The first question_asked control frame renders a QuestionCard.
    emitControl({
      control: "question_asked",
      questionId: "objetivo",
      phase: "spec",
      prompt: "Qual o objetivo desta feature?",
      options: [
        { label: "Reduzir o atrito", recommended: true, why: "a dor citada" },
        { label: "Cobrir mais casos" },
      ],
    });
    expect(ui.getByText("Qual o objetivo desta feature?")).not.toBeNull();
    expect(ui.getAllByText("RECOMENDADA")).toHaveLength(1);
  });

  it("carries the human's demand into the spec Phase as --demand (turn-1 seed)", () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Nova feature", "um editor visual de specs");

    // The demand is this shell's to deliver: it rides the spawn argv so the
    // engine's turn 1 is `/devy:spec um editor visual de specs`, not an empty
    // `/devy:spec` that re-asks what the describe stage already collected.
    const calls = startCalls();
    expect(calls).toHaveLength(1);
    const { args } = calls[0]![1] as { args: string[] };
    expect(args).toContain("--demand");
    expect(args[args.indexOf("--demand") + 1]).toBe(
      "um editor visual de specs",
    );
  });

  it('the always-visible "Chega" button sends phase_wrap_up (D17)', () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Nova feature", "x");

    // The button is visible while the Phase runs, before any question.
    fireEvent.click(ui.getByText(/chega/i));
    expect(lastCommand()).toEqual({ command: "phase_wrap_up" });
  });

  it("phase_finished on spec leads to the PhaseGate (D12)", () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Nova feature", "x");

    emitControl({
      control: "phase_finished",
      phase: "spec",
      changeDir: ".harn/devy/changes/C-1-editor",
      files: ["spec.md"],
    });

    // The gate offers the next step; the spec phase is not the last one.
    expect(ui.getByText("Refinar")).not.toBeNull();
    expect(ui.getByText("Ir direto ao plano")).not.toBeNull();
    expect(ui.getByText("spec.md")).not.toBeNull();
  });

  it("choosing Refinar at the gate spawns the refine Phase with the change id", () => {
    const ui = render(
      <Interview
        dir="/proj"
        agent="claude"
        model="opus"
        effort="high"
        onClose={vi.fn()}
      />,
    );
    reachDescribeAndSubmit(ui, "Nova feature", "x");
    expect(startCalls()).toHaveLength(1); // spec

    emitControl({
      control: "phase_finished",
      phase: "spec",
      changeDir: ".harn/devy/changes/C-3-editor",
      files: ["spec.md"],
    });
    fireEvent.click(ui.getByText("Refinar"));

    const calls = startCalls();
    expect(calls).toHaveLength(2);
    // The change id is derived from the change dir; the phase flags follow the
    // T-010 argv order (change, phase, agent, model, effort).
    expect(calls[1]![1]).toEqual({
      dir: "/proj",
      args: [
        "--change",
        "C-3",
        "--phase",
        "refine",
        "--agent",
        "claude",
        "--model",
        "opus",
        "--effort",
        "high",
      ],
    });
  });

  it('the plan Phase finishing shows the "Salvo" screen with Abrir o board (D11)', () => {
    const onOpenBoard = vi.fn();
    const ui = render(
      <Interview
        dir="/proj"
        agent="claude"
        onClose={vi.fn()}
        onOpenBoard={onOpenBoard}
      />,
    );
    reachDescribeAndSubmit(ui, "Nova feature", "x");

    emitControl({
      control: "phase_finished",
      phase: "plan",
      changeDir: ".harn/devy/changes/C-2-editor",
      files: ["spec.md", "plan.md", "todo.md"],
    });

    expect(ui.getByText(/salvo/i)).not.toBeNull();
    fireEvent.click(ui.getByText(/abrir o board/i));
    expect(onOpenBoard).toHaveBeenCalledWith(".harn/devy/changes/C-2-editor");
  });
});

// ---------------------------------------------------------------------------
// The bug/debt trail — LOCAL, never spawns a process (D4/D24)
// ---------------------------------------------------------------------------

describe("Interview — the bug trail", () => {
  it("reaches the Handoff without the bridge being called", () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Bug", "trava ao salvar com 2 anexos");

    // The bug trail is entirely local: no `loopy interview` process is spawned.
    expect(startCalls()).toHaveLength(0);
    // The hand-off mounts a copyable /devy:debug command.
    expect(
      ui.getByText("/devy:debug trava ao salvar com 2 anexos"),
    ).not.toBeNull();
  });

  it('routes "Débito técnico" to the hand-off too, still without a process', () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Débito técnico", "acoplamento do orquestrador");
    expect(startCalls()).toHaveLength(0);
    expect(ui.getByText(/nenhum arquivo é criado/i)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Closing — always returns to the list
// ---------------------------------------------------------------------------

describe("Interview — closing", () => {
  it("closing from the header returns to the list (onClose)", () => {
    const onClose = vi.fn();
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={onClose} />,
    );
    fireEvent.click(ui.getByLabelText("Voltar à lista"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Outro tipo de demanda…" falls to the feature trail (D24) and spawns a Phase', () => {
    const ui = render(
      <Interview dir="/proj" agent="claude" onClose={vi.fn()} />,
    );
    reachDescribeAndSubmit(ui, "Outro tipo de demanda…", "algo diferente");
    // D24: the unknown trail produces files, so it spawns like a feature.
    expect(startCalls()).toHaveLength(1);
  });
});
