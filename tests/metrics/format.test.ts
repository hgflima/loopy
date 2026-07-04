import { describe, expect, it } from "vitest";
import type { StepCost, TurnUsage } from "../../src/types";
import {
  formatCost,
  formatDuration,
  formatTokens,
  formatUsage,
} from "../../src/metrics/format";

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

describe("formatTokens", () => {
  it("renders small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders thousands as Nk", () => {
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(12_000)).toBe("12k");
    expect(formatTokens(999_000)).toBe("999k");
  });

  it("renders fractional thousands with one decimal", () => {
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(12_345)).toBe("12.3k");
  });

  it("renders millions as NM", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(5_000_000)).toBe("5M");
  });

  it("renders fractional millions with one decimal", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("renders 0ms as '0s'", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("renders seconds only", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("renders minutes and seconds", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("renders hours, minutes, seconds", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
  });

  it("omits zero components in the middle", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(3_605_000)).toBe("1h 5s");
  });

  it("rounds milliseconds", () => {
    expect(formatDuration(1_499)).toBe("1s");
    expect(formatDuration(1_500)).toBe("2s");
  });
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

describe("formatCost", () => {
  it("renders null as 'n/d'", () => {
    expect(formatCost(null)).toBe("n/d");
  });

  it("renders unavailable as 'n/d'", () => {
    const cost: StepCost = { amount: 0, currency: "USD", available: false };
    expect(formatCost(cost)).toBe("n/d");
  });

  it("renders USD with $ prefix", () => {
    const cost: StepCost = { amount: 0.42, currency: "USD", available: true };
    expect(formatCost(cost)).toBe("$0.42");
  });

  it("renders non-USD with currency prefix", () => {
    const cost: StepCost = { amount: 1.5, currency: "EUR", available: true };
    expect(formatCost(cost)).toBe("EUR 1.50");
  });

  it("formats to two decimal places", () => {
    const cost: StepCost = { amount: 3, currency: "USD", available: true };
    expect(formatCost(cost)).toBe("$3.00");
  });
});

// ---------------------------------------------------------------------------
// formatUsage
// ---------------------------------------------------------------------------

describe("formatUsage", () => {
  it("renders null as 'n-a' (non-agent step)", () => {
    expect(formatUsage(null)).toBe("n-a");
  });

  it("renders unavailable as 'n/d'", () => {
    const usage: TurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      available: false,
    };
    expect(formatUsage(usage)).toBe("n/d");
  });

  it("renders in/out for simple usage", () => {
    const usage: TurnUsage = {
      inputTokens: 12_000,
      outputTokens: 3_400,
      totalTokens: 15_400,
      available: true,
    };
    expect(formatUsage(usage)).toBe("in:12k out:3.4k");
  });

  it("includes cached when non-zero", () => {
    const usage: TurnUsage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cachedReadTokens: 8_000,
      cachedWriteTokens: 2_000,
      totalTokens: 11_500,
      available: true,
    };
    expect(formatUsage(usage)).toBe("in:1k out:500 cached:10k");
  });

  it("omits cached when zero", () => {
    const usage: TurnUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      totalTokens: 150,
      available: true,
    };
    expect(formatUsage(usage)).toBe("in:100 out:50");
  });
});
