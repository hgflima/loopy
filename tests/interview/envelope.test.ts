import { describe, expect, it } from "vitest";

import { fullEnvelope, reminder, wrapUp } from "../../src/interview/envelope";

// A concrete Change dir the engine would know from turn 1 onward (D10).
const CHANGE_DIR = ".harn/devy/changes/C-0042-widget";

describe("fullEnvelope — first turn carries the whole rule block (D15)", () => {
  it("imposes the answer FORM: one block, one question, one recommended", () => {
    const env = fullEnvelope("spec");
    expect(env).toContain("ENCERRE O TURNO emitindo exatamente um bloco");
    expect(env).toContain("<loopy-ask>");
    expect(env).toContain('"recommended": true');
    expect(env).toContain("uma pergunta por turno");
    // Ends every turn by asking for the terminator.
    expect(env).toContain("<loopy-done/>");
    // The read-the-code affordance (finding + source), proven live by the spike.
    expect(env).toContain("LEIA O CÓDIGO");
    expect(env).toContain('"finding"');
    expect(env).toContain('"source"');
    // It is the multi-line block, not the one-line reminder.
    expect(env.split("\n").length).toBeGreaterThan(5);
    expect(env).not.toBe(reminder());
  });

  it("refine and plan share the same rule block as spec", () => {
    const rule = "ENCERRE O TURNO emitindo exatamente um bloco";
    expect(fullEnvelope("refine", CHANGE_DIR)).toContain(rule);
    expect(fullEnvelope("plan", CHANGE_DIR)).toContain(rule);
  });
});

describe("changeDir injection (D10)", () => {
  it("the spec phase carries the <loopy-change> paragraph, no injected dir", () => {
    const env = fullEnvelope("spec");
    expect(env).toContain("Ao criar a pasta da Change");
    expect(env).toContain("<loopy-change");
    // The dir does not exist yet in the spec phase — it must not be injected.
    expect(env).not.toContain(CHANGE_DIR);
    expect(env).not.toContain("Grave os arquivos em:");
  });

  it("the refine phase injects the change dir instead of the create paragraph", () => {
    const env = fullEnvelope("refine", CHANGE_DIR);
    expect(env).toContain(`Grave os arquivos em: ${CHANGE_DIR}`);
    expect(env).not.toContain("<loopy-change");
    expect(env).not.toContain("Ao criar a pasta da Change");
  });

  it("the plan phase injects the change dir too", () => {
    const env = fullEnvelope("plan", CHANGE_DIR);
    expect(env).toContain(`Grave os arquivos em: ${CHANGE_DIR}`);
    expect(env).not.toContain("<loopy-change");
  });

  it("throws when a non-spec phase is missing its change dir (programming fault)", () => {
    expect(() => fullEnvelope("refine")).toThrow();
    expect(() => fullEnvelope("plan")).toThrow();
  });
});

describe("reminder — later turns get one line only (D15)", () => {
  it("is a single line naming the block and the terminator", () => {
    const r = reminder();
    expect(r.trim().split("\n")).toHaveLength(1);
    expect(r).toContain("<loopy-ask>");
    expect(r).toContain("<loopy-done/>");
    expect(r).toContain("uma pergunta por turno");
  });

  it("is much shorter than the full envelope (fights drift, not context)", () => {
    expect(reminder().length).toBeLessThan(fullEnvelope("spec").length);
  });
});

describe("wrapUp — the 'Chega' button (D17)", () => {
  it("tells the agent to stop asking and write with what it has", () => {
    const w = wrapUp();
    expect(w).toContain("Pare de perguntar");
    expect(w).toContain("<loopy-done/>");
  });
});
