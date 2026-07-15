/**
 * Testes dos formatadores da aba Insights.
 *
 * Run: `npm test -w apps/menubar -- insights/format`
 */
import { describe, it, expect } from "vitest";
import { fmtValue, fmtBaseline, fmtDelta, deltaTone, DASH } from "./format";

describe("fmtValue", () => {
  it("null / NaN → traço", () => {
    expect(fmtValue(null, "usd")).toBe(DASH);
    expect(fmtValue(NaN, "duration")).toBe(DASH);
  });

  it("usd absoluto = 2 casas; normalizado = 4 casas por-linha", () => {
    expect(fmtValue(1.234, "usd", "absolute")).toBe("$1.23");
    expect(fmtValue(0.01234, "usd", "normalized")).toBe("$0.0123/L");
  });

  it("duration absoluto compacto; normalizado por-linha", () => {
    expect(fmtValue(45, "duration", "absolute")).toBe("45s");
    expect(fmtValue(200, "duration", "absolute")).toBe("3m 20s");
    expect(fmtValue(5400, "duration", "absolute")).toBe("1.5h");
    expect(fmtValue(0.85, "duration", "normalized")).toBe("0.85s/L");
  });

  it("rate = percentual inteiro; count = inteiro ou 1 casa", () => {
    expect(fmtValue(0.85, "rate")).toBe("85%");
    expect(fmtValue(3, "count")).toBe("3");
    expect(fmtValue(2.5, "count")).toBe("2.5");
  });
});

describe("fmtBaseline", () => {
  it("média ± desvio", () => {
    expect(fmtBaseline(1.2, 0.3, "usd")).toBe("$1.20 ± $0.30");
  });
  it("sem desvio → só a média", () => {
    expect(fmtBaseline(0.9, null, "rate")).toBe("90%");
  });
  it("sem média → traço", () => {
    expect(fmtBaseline(null, 0.3, "usd")).toBe(DASH);
  });
});

describe("fmtDelta", () => {
  it("assinado, 1 casa abaixo de 10%, inteiro acima", () => {
    expect(fmtDelta(5.4)).toBe("+5.4%");
    expect(fmtDelta(-42.7)).toBe("-43%");
    expect(fmtDelta(0)).toBe("0%");
  });
  it("null → traço", () => {
    expect(fmtDelta(null)).toBe(DASH);
  });
});

describe("deltaTone", () => {
  it("lower-better: queda é boa, alta é ruim", () => {
    expect(deltaTone(-10, "lower-better")).toBe("good");
    expect(deltaTone(10, "lower-better")).toBe("bad");
  });
  it("higher-better: alta é boa", () => {
    expect(deltaTone(10, "higher-better")).toBe("good");
    expect(deltaTone(-10, "higher-better")).toBe("bad");
  });
  it("neutro para métrica neutra, delta nulo ou zero", () => {
    expect(deltaTone(10, "neutral")).toBe("neutral");
    expect(deltaTone(null, "lower-better")).toBe("neutral");
    expect(deltaTone(0, "lower-better")).toBe("neutral");
  });
});
