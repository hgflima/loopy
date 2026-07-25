/**
 * Tests for QuestionCard: the one-question-at-a-time interview card.
 *
 * Covers the acceptance criteria (spec.md, "Componentes"):
 *  - a card with options renders exactly one `RECOMENDADA` badge and the porquê
 *  - a card with a `finding` renders the source (`file:line`) and a decide-by-hand
 *  - the free-text escape hatch accepts text and lifts it via onAnswer
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import type { PendingQuestion } from "./interview-state";

afterEach(cleanup);

const { QuestionCard } = await import("./QuestionCard");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WITH_OPTIONS: PendingQuestion = {
  questionId: "objetivo",
  phase: "spec",
  prompt: "Qual o objetivo desta feature?",
  options: [
    {
      label: "Reduzir o atrito",
      detail: "Menos passos até o primeiro Run.",
      recommended: true,
      why: "É a dor que o usuário citou primeiro.",
    },
    {
      label: "Cobrir mais casos",
      detail: "Mais trilhas, mais superfície.",
    },
  ],
  otherLabel: "Nenhuma dessas — escrever a minha…",
};

const WITH_FINDING: PendingQuestion = {
  questionId: "runtime",
  phase: "spec",
  prompt: "Qual runtime a telemetria usa?",
  finding: "O adapter escolhe node:sqlite ou bun:sqlite por runtime.",
  source: "src/telemetry/open-db.ts:42",
  options: [{ label: "Seguir o que o código já faz", recommended: true }],
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe("QuestionCard — options", () => {
  it("renders the prompt", () => {
    const { getByText } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={vi.fn()} />,
    );
    expect(getByText("Qual o objetivo desta feature?")).not.toBeNull();
  });

  it("renders exactly one RECOMENDADA badge", () => {
    const { getAllByText } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={vi.fn()} />,
    );
    expect(getAllByText("RECOMENDADA")).toHaveLength(1);
  });

  it("renders the porquê of the recommended option", () => {
    const { getByText } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={vi.fn()} />,
    );
    expect(getByText(/É a dor que o usuário citou primeiro\./)).not.toBeNull();
  });

  it("puts the RECOMENDADA badge on the recommended option only", () => {
    const { container } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={vi.fn()} />,
    );
    const options = container.querySelectorAll(".spec-option");
    expect(options).toHaveLength(2);
    // The first option is the recommended one.
    expect(
      within(options[0] as HTMLElement).queryByText("RECOMENDADA"),
    ).not.toBeNull();
    expect(
      within(options[1] as HTMLElement).queryByText("RECOMENDADA"),
    ).toBeNull();
  });

  it("answers with the option label when an option is clicked", () => {
    const onAnswer = vi.fn();
    const { getByText } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={onAnswer} />,
    );
    fireEvent.click(getByText("Cobrir mais casos"));
    expect(onAnswer).toHaveBeenCalledWith("Cobrir mais casos");
  });
});

// ---------------------------------------------------------------------------
// Finding — the agent read the code instead of asking (D10)
// ---------------------------------------------------------------------------

describe("QuestionCard — finding", () => {
  it("renders the finding text and its source (file:line)", () => {
    const { getByText } = render(
      <QuestionCard question={WITH_FINDING} onAnswer={vi.fn()} />,
    );
    expect(
      getByText(/O adapter escolhe node:sqlite ou bun:sqlite/),
    ).not.toBeNull();
    expect(getByText("src/telemetry/open-db.ts:42")).not.toBeNull();
  });

  it("offers a decide-by-hand button that opens the free-text field", () => {
    const { getByText, container } = render(
      <QuestionCard question={WITH_FINDING} onAnswer={vi.fn()} />,
    );
    // The escape hatch for a finding reads as "I'll decide by hand".
    const byHand = getByText(/decido à mão/i);
    fireEvent.click(byHand);
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escape hatch — free text
// ---------------------------------------------------------------------------

describe("QuestionCard — escape hatch", () => {
  it("accepts free text and lifts it via onAnswer", () => {
    const onAnswer = vi.fn();
    const { getByText, container } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={onAnswer} />,
    );
    fireEvent.click(getByText("Nenhuma dessas — escrever a minha…"));

    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Minha própria resposta" } });
    fireEvent.click(getByText(/continuar/i));

    expect(onAnswer).toHaveBeenCalledWith("Minha própria resposta", []);
  });

  it("does not answer with empty free text", () => {
    const onAnswer = vi.fn();
    const { getByText, container } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={onAnswer} />,
    );
    fireEvent.click(getByText("Nenhuma dessas — escrever a minha…"));
    fireEvent.change(container.querySelector("textarea")!, {
      target: { value: "   " },
    });
    fireEvent.click(getByText(/continuar/i));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("renders an open-question prompt with only the escape hatch (D3 fallback)", () => {
    const openQuestion: PendingQuestion = {
      questionId: "aberta",
      phase: "refine",
      prompt: "Conte mais sobre o comportamento esperado.",
    };
    const { container } = render(
      <QuestionCard question={openQuestion} onAnswer={vi.fn()} />,
    );
    // No options → the free-text field is shown directly, no card buttons.
    expect(container.querySelectorAll(".spec-option")).toHaveLength(0);
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disabled — a late answer must not fire twice
// ---------------------------------------------------------------------------

describe("QuestionCard — disabled", () => {
  it("does not answer when disabled", () => {
    const onAnswer = vi.fn();
    const { getByText } = render(
      <QuestionCard question={WITH_OPTIONS} onAnswer={onAnswer} disabled />,
    );
    fireEvent.click(getByText("Cobrir mais casos"));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
