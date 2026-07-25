import { describe, expect, it } from "vitest";
import { parseAsk } from "../../src/interview/parse-ask";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A well-formed <loopy-ask> block with every optional field the envelope
 *  documents (id, prompt, options, recommended, why, otherLabel). */
const VALID_ASK = [
  "<loopy-ask>",
  JSON.stringify({
    id: "objetivo",
    prompt: "Qual o objetivo desta feature?",
    options: [
      {
        label: "A",
        detail: "faz A",
        recommended: true,
        why: "é o mais barato",
      },
      { label: "B", detail: "faz B" },
    ],
    otherLabel: "Nenhuma dessas — escrever a minha…",
  }),
  "</loopy-ask>",
].join("\n");

const CHANGE_TAG =
  '<loopy-change dir=".harn/devy/changes/C-0018-specs-authoring"/>';

// ---------------------------------------------------------------------------
// The six table cases (spec — "Parsing", SC1)
// ---------------------------------------------------------------------------

describe("parseAsk — the six table cases", () => {
  it("1. <loopy-ask>{valid json} → kind ask with the parsed question", () => {
    const r = parseAsk(VALID_ASK);
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.question.id).toBe("objetivo");
    expect(r.question.prompt).toBe("Qual o objetivo desta feature?");
    expect(r.question.options).toEqual([
      {
        label: "A",
        detail: "faz A",
        recommended: true,
        why: "é o mais barato",
      },
      { label: "B", detail: "faz B" },
    ]);
    expect(r.question.otherLabel).toBe("Nenhuma dessas — escrever a minha…");
    expect(r.warning).toBeUndefined();
  });

  it('2. <loopy-change dir="…"/> → change dir, coexisting with the directive', () => {
    const r = parseAsk(CHANGE_TAG);
    expect(r.change).toBe(".harn/devy/changes/C-0018-specs-authoring");
  });

  it("3. <loopy-done/> → kind done", () => {
    const r = parseAsk("Gravei os arquivos.\n<loopy-done/>");
    expect(r.kind).toBe("done");
  });

  it("4. no blocks + non-empty text → kind open, text is the prose (D3)", () => {
    const r = parseAsk("Qual é o nome do módulo?");
    expect(r.kind).toBe("open");
    if (r.kind !== "open") return;
    expect(r.text).toBe("Qual é o nome do módulo?");
    expect(r.prose).toBe("Qual é o nome do módulo?");
    expect(r.warning).toBeUndefined();
  });

  it("5. malformed JSON inside the block → open + warning", () => {
    const r = parseAsk("<loopy-ask>{ isto não é json }</loopy-ask>");
    expect(r.kind).toBe("open");
    expect(r.warning).toBeDefined();
  });

  it("6. two or more ask blocks → the first + warning (D25)", () => {
    const two = [
      '<loopy-ask>{"id":"primeiro","prompt":"P1?"}</loopy-ask>',
      '<loopy-ask>{"id":"segundo","prompt":"P2?"}</loopy-ask>',
    ].join("\n");
    const r = parseAsk(two);
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.question.id).toBe("primeiro");
    expect(r.warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Coexistence (acceptance: change may accompany ask/done in one turn — D10)
// ---------------------------------------------------------------------------

describe("parseAsk — change coexists with the directive", () => {
  it("change + done in the same turn returns both", () => {
    const r = parseAsk(`${CHANGE_TAG}\nPronto.\n<loopy-done/>`);
    expect(r.kind).toBe("done");
    expect(r.change).toBe(".harn/devy/changes/C-0018-specs-authoring");
  });

  it("change + ask in the same turn returns both", () => {
    const r = parseAsk(`${CHANGE_TAG}\n${VALID_ASK}`);
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.question.id).toBe("objetivo");
    expect(r.change).toBe(".harn/devy/changes/C-0018-specs-authoring");
  });

  it("accepts single-quoted dir attribute", () => {
    const r = parseAsk("<loopy-change dir='.harn/devy/changes/C-0099-x'/>");
    expect(r.change).toBe(".harn/devy/changes/C-0099-x");
  });

  it("a change-only turn falls back to open with the change reported", () => {
    const r = parseAsk(CHANGE_TAG);
    expect(r.kind).toBe("open");
    expect(r.change).toBe(".harn/devy/changes/C-0018-specs-authoring");
  });
});

// ---------------------------------------------------------------------------
// Prose outside the blocks (D25 — transcript, not the card)
// ---------------------------------------------------------------------------

describe("parseAsk — prose outside the blocks (D25)", () => {
  it("returns the narration prose separate from the card", () => {
    const turn = `Deixa eu analisar os módulos existentes primeiro.\n${VALID_ASK}`;
    const r = parseAsk(turn);
    expect(r.kind).toBe("ask");
    expect(r.prose).toBe("Deixa eu analisar os módulos existentes primeiro.");
    if (r.kind !== "ask") return;
    // The block text never leaks into the prose.
    expect(r.prose).not.toContain("loopy-ask");
    expect(r.prose).not.toContain("objetivo");
  });

  it("strips the change/done tags out of the prose", () => {
    const r = parseAsk(`${CHANGE_TAG}\nTudo pronto.\n<loopy-done/>`);
    expect(r.prose).toBe("Tudo pronto.");
  });
});

// ---------------------------------------------------------------------------
// Question shape — every optional field carried, finding/source (SC14)
// ---------------------------------------------------------------------------

describe("parseAsk — question shape", () => {
  it("carries finding + source when the agent read the code (D10 / SC14)", () => {
    const turn = [
      "<loopy-ask>",
      JSON.stringify({
        id: "porta",
        prompt: "Qual porta usar?",
        finding: "O servidor já escuta na 8080",
        source: "src/server.ts:42",
        options: [{ label: "8080", recommended: true, why: "já em uso" }],
      }),
      "</loopy-ask>",
    ].join("\n");
    const r = parseAsk(turn);
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.question.finding).toBe("O servidor já escuta na 8080");
    expect(r.question.source).toBe("src/server.ts:42");
  });

  it("drops options that are not well-formed but keeps the good ones", () => {
    const turn = [
      "<loopy-ask>",
      JSON.stringify({
        id: "x",
        prompt: "P?",
        options: [{ label: "ok" }, "lixo", { detail: "sem label" }],
      }),
      "</loopy-ask>",
    ].join("\n");
    const r = parseAsk(turn);
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.question.options).toEqual([{ label: "ok" }]);
  });

  it("valid JSON with the wrong shape (no id/prompt) degrades to open + warning", () => {
    const r = parseAsk('<loopy-ask>{"foo":"bar"}</loopy-ask>');
    expect(r.kind).toBe("open");
    expect(r.warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Precedence — a pending question outranks an end signal (documented decision)
// ---------------------------------------------------------------------------

describe("parseAsk — precedence", () => {
  it("a valid ask outranks a done in the same turn (human still has 'Chega')", () => {
    const r = parseAsk(`${VALID_ASK}\n<loopy-done/>`);
    expect(r.kind).toBe("ask");
  });
});

// ---------------------------------------------------------------------------
// Never throws (AD-5) — acceptance: empty, truncated JSON, unclosed block
// ---------------------------------------------------------------------------

describe("parseAsk — never throws (AD-5)", () => {
  it("empty input", () => {
    const r = parseAsk("");
    expect(r.kind).toBe("open");
    if (r.kind !== "open") return;
    expect(r.text).toBe("");
    expect(r.prose).toBe("");
  });

  it("whitespace-only input", () => {
    const r = parseAsk("   \n\t ");
    expect(r.kind).toBe("open");
  });

  it("truncated JSON inside a closed block → open + warning, no throw", () => {
    const r = parseAsk('<loopy-ask>{"id":"x","prompt":</loopy-ask>');
    expect(r.kind).toBe("open");
    expect(r.warning).toBeDefined();
  });

  it("an unclosed block with truncated JSON does not throw (no closing tag)", () => {
    // No `</loopy-ask>` → not a complete block → plain open fallback, no warning.
    const r = parseAsk('<loopy-ask>{"id":"x","prompt":"P?"');
    expect(() => parseAsk('<loopy-ask>{"id":"x"')).not.toThrow();
    expect(r.kind).toBe("open");
  });

  it("an unclosed <loopy-ask> block does not throw and falls back to open", () => {
    const r = parseAsk('<loopy-ask>\n{"id":"x","prompt":"P?"}\nsem fechamento');
    expect(r.kind).toBe("open");
  });

  it("random garbage never throws", () => {
    for (const junk of [
      "<><><>",
      "}{[]",
      "<loopy-ask>",
      "</loopy-ask>",
      "<loopy-done",
      "<loopy-change dir=>",
    ]) {
      expect(() => parseAsk(junk)).not.toThrow();
    }
  });
});
