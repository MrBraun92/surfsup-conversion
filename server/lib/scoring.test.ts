import { describe, it, expect } from "vitest";
import { computeScore, matchAffinity, recencyScore } from "./scoring.js";

const NOW = 1_750_000_000;
const noCooldown = { cooldownUntil: null, cooldownReason: null, cooldownTriggerAt: null };

describe("recencyScore", () => {
  it("1.0 para aluguel hoje", () => {
    expect(recencyScore(NOW - 0, NOW)).toBe(1);
  });
  it("1.0 ainda em 30d", () => {
    expect(recencyScore(NOW - 29 * 86_400, NOW)).toBe(1);
  });
  it("decai linear entre 30 e 180", () => {
    const v = recencyScore(NOW - 105 * 86_400, NOW); // metade do caminho
    expect(v).toBeCloseTo(0.5, 1);
  });
  it("0 em 180d ou mais", () => {
    expect(recencyScore(NOW - 180 * 86_400, NOW)).toBe(0);
    expect(recencyScore(NOW - 365 * 86_400, NOW)).toBe(0);
  });
  it("0 quando lastRentalAt é null", () => {
    expect(recencyScore(null, NOW)).toBe(0);
  });
});

describe("matchAffinity", () => {
  it("0.5 quando oferta é null (neutro)", () => {
    expect(matchAffinity(null, ["Shortboard", "Longboard"])).toBe(0.5);
  });
  it("0 quando histórico vazio", () => {
    expect(matchAffinity("Shortboard", [])).toBe(0);
  });
  it("0 quando tipo nunca alugado", () => {
    expect(matchAffinity("Fish", ["Shortboard", "Longboard"])).toBe(0);
  });
  it("1.0 quando oferta = tipo mais comum", () => {
    expect(matchAffinity("Shortboard", ["Shortboard", "Shortboard", "Longboard"])).toBe(1);
  });
  it("0.66 quando oferta = 2º mais comum", () => {
    const r = matchAffinity("Longboard", ["Shortboard", "Shortboard", "Longboard"]);
    expect(r).toBe(0.66);
  });
  it("0.33 quando presente mas terceiro+", () => {
    const r = matchAffinity("Fish", [
      "Shortboard",
      "Shortboard",
      "Longboard",
      "Longboard",
      "Fish",
    ]);
    expect(r).toBe(0.33);
  });
});

describe("computeScore", () => {
  it("retorna -1 quando cliente em cooldown", () => {
    const r = computeScore(
      {
        rentalsOfThisBoard: 10,
        daysOfThisBoard: 60,
        totalRentals: 30,
        lastRentalAt: NOW,
        offeredBoardType: "Shortboard",
        recentBoardTypes: ["Shortboard"],
        client: { cooldownUntil: NOW + 100, cooldownReason: "rejected", cooldownTriggerAt: NOW },
      },
      NOW,
    );
    expect(r.score).toBe(-1);
  });

  it("score máximo = 100 para cenário perfeito", () => {
    const r = computeScore(
      {
        rentalsOfThisBoard: 10,
        daysOfThisBoard: 60,
        totalRentals: 30,
        lastRentalAt: NOW,
        offeredBoardType: "Shortboard",
        recentBoardTypes: ["Shortboard", "Shortboard", "Shortboard"],
        client: noCooldown,
      },
      NOW,
    );
    expect(r.score).toBe(100);
  });

  it("score = 0 para cenário mínimo", () => {
    const r = computeScore(
      {
        rentalsOfThisBoard: 0,
        daysOfThisBoard: 0,
        totalRentals: 0,
        lastRentalAt: null,
        offeredBoardType: "Shortboard",
        recentBoardTypes: [],
        client: noCooldown,
      },
      NOW,
    );
    expect(r.score).toBe(0);
  });

  it("caps em valores extremos não excedem o peso", () => {
    const r = computeScore(
      {
        rentalsOfThisBoard: 999, // capa em 10
        daysOfThisBoard: 999, // capa em 60
        totalRentals: 999, // capa em 30
        lastRentalAt: NOW,
        offeredBoardType: "Shortboard",
        recentBoardTypes: ["Shortboard"],
        client: noCooldown,
      },
      NOW,
    );
    expect(r.score).toBe(100);
  });

  it("breakdown soma ao score arredondado", () => {
    const r = computeScore(
      {
        rentalsOfThisBoard: 5,
        daysOfThisBoard: 30,
        totalRentals: 15,
        lastRentalAt: NOW - 100 * 86_400, // ~0.33 de recência
        offeredBoardType: "Fish",
        recentBoardTypes: ["Shortboard", "Shortboard", "Fish"], // 0.66 (segundo)
        client: noCooldown,
      },
      NOW,
    );
    const sum =
      r.breakdown.boardRentals +
      r.breakdown.boardDays +
      r.breakdown.totalRentals +
      r.breakdown.recency +
      r.breakdown.affinity;
    expect(Math.abs(sum - r.score)).toBeLessThan(0.2);
    expect(r.reason).toContain("5 vezes");
  });
});
