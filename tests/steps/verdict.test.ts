import { describe, expect, it } from "vitest";
import { parseVerdict, type Verdict } from "../../src/steps/verdict";

describe("parseVerdict — PASS", () => {
  it("detects a bare PASS verdict", () => {
    const v = parseVerdict("AUDIT: PASS");
    expect(v).toEqual<Verdict>({ pass: true, found: true });
  });

  it("detects PASS as the last line after preceding prose (noise)", () => {
    const text = [
      "Revisei a implementação da task T-013.",
      "Correção: ok. Segurança: ok. Casos de borda: cobertos.",
      "",
      "AUDIT: PASS",
    ].join("\n");
    expect(parseVerdict(text).pass).toBe(true);
  });

  it("ignores trailing punctuation after PASS", () => {
    expect(parseVerdict("AUDIT: PASS.").pass).toBe(true);
  });

  it("is case-insensitive on the label and keyword", () => {
    expect(parseVerdict("audit: pass").pass).toBe(true);
  });

  it("tolerates markdown emphasis around the marker", () => {
    expect(parseVerdict("**AUDIT: PASS**").pass).toBe(true);
    expect(parseVerdict("`AUDIT: PASS`").pass).toBe(true);
    expect(parseVerdict("**AUDIT**: PASS").pass).toBe(true);
    expect(parseVerdict("AUDIT: **PASS**").pass).toBe(true);
  });

  it("tolerates extra whitespace around the colon", () => {
    expect(parseVerdict("AUDIT   :   PASS").pass).toBe(true);
    expect(parseVerdict("AUDIT:PASS").pass).toBe(true);
  });

  it("leaves reason undefined on PASS", () => {
    expect(parseVerdict("AUDIT: PASS").reason).toBeUndefined();
  });
});

describe("parseVerdict — FAIL + motivo", () => {
  it("detects FAIL and extracts the reason after the second colon", () => {
    const v = parseVerdict("AUDIT: FAIL: faltou tratar o caso vazio");
    expect(v.pass).toBe(false);
    expect(v.found).toBe(true);
    expect(v.reason).toBe("faltou tratar o caso vazio");
  });

  it("preserves colons inside the reason text", () => {
    const v = parseVerdict("AUDIT: FAIL: erro em foo: bar não tratado");
    expect(v.reason).toBe("erro em foo: bar não tratado");
  });

  it("detects FAIL without a reason", () => {
    const v = parseVerdict("AUDIT: FAIL");
    expect(v.pass).toBe(false);
    expect(v.found).toBe(true);
    expect(v.reason).toBeUndefined();
  });

  it("strips surrounding markdown from the reason", () => {
    const v = parseVerdict("**AUDIT: FAIL: cobertura insuficiente**");
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("cobertura insuficiente");
  });

  it("does not match the word FAILED as a FAIL verdict", () => {
    // 'FAILED' is not the FAIL keyword; with no valid verdict this is absence.
    const v = parseVerdict("AUDIT: FAILED miserably");
    expect(v.found).toBe(false);
    expect(v.pass).toBe(false);
  });
});

describe("parseVerdict — absence is FAIL (fail-closed)", () => {
  it("treats empty text as FAIL with no verdict found", () => {
    const v = parseVerdict("");
    expect(v.pass).toBe(false);
    expect(v.found).toBe(false);
    expect(v.reason).toBeDefined();
  });

  it("treats text without any verdict marker as FAIL", () => {
    const v = parseVerdict("Aqui vai um resumo, mas sem veredito nenhum.");
    expect(v.pass).toBe(false);
    expect(v.found).toBe(false);
  });

  it("does not match a bare PASS/FAIL keyword without the label", () => {
    expect(parseVerdict("PASS").found).toBe(false);
    expect(parseVerdict("the build did not FAIL").found).toBe(false);
  });
});

describe("parseVerdict — last occurrence wins", () => {
  it("uses the final verdict when several appear (FAIL then PASS)", () => {
    const text = [
      "AUDIT: FAIL: primeira passada com problemas",
      "corrigi os problemas apontados",
      "AUDIT: PASS",
    ].join("\n");
    expect(parseVerdict(text).pass).toBe(true);
  });

  it("uses the final verdict when several appear (PASS then FAIL)", () => {
    const text = ["AUDIT: PASS", "AUDIT: FAIL: regressão detectada"].join("\n");
    const v = parseVerdict(text);
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("regressão detectada");
  });

  it("fails closed when the agent merely echoes the instruction line last", () => {
    // The prompt instructs the agent to answer 'AUDIT: PASS' or
    // 'AUDIT: FAIL: <motivo>'. An echoed instruction must never read as PASS.
    const text = "Responda 'AUDIT: PASS' ou 'AUDIT: FAIL: <motivo>'.";
    expect(parseVerdict(text).pass).toBe(false);
  });
});

describe("parseVerdict — configurable label (AD-1)", () => {
  it("honors a custom label", () => {
    expect(parseVerdict("REVIEW: PASS", { label: "REVIEW" }).pass).toBe(true);
    expect(parseVerdict("AUDIT: PASS", { label: "REVIEW" }).found).toBe(false);
  });

  it("escapes regex metacharacters in the label", () => {
    const v = parseVerdict("A.B: PASS", { label: "A.B" });
    expect(v.pass).toBe(true);
    // The '.' must be literal, not a wildcard.
    expect(parseVerdict("AxB: PASS", { label: "A.B" }).found).toBe(false);
  });
});
