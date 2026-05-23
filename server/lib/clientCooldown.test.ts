import { describe, it, expect } from "vitest";
import { getCooldownState, isClientInCooldown, buildCooldownPatch } from "./clientCooldown.js";

const NOW = 1_750_000_000;

describe("clientCooldown", () => {
  it("retorna não em cooldown quando cooldownUntil é null", () => {
    const s = getCooldownState(
      { cooldownUntil: null, cooldownReason: null, cooldownTriggerAt: null },
      NOW,
    );
    expect(s.inCooldown).toBe(false);
    expect(s.daysRemaining).toBe(0);
  });

  it("retorna não em cooldown quando cooldownUntil já passou", () => {
    const s = getCooldownState(
      { cooldownUntil: NOW - 100, cooldownReason: "rejected", cooldownTriggerAt: NOW - 1000 },
      NOW,
    );
    expect(s.inCooldown).toBe(false);
  });

  it("retorna em cooldown com dias restantes corretos", () => {
    const s = getCooldownState(
      { cooldownUntil: NOW + 3 * 86_400, cooldownReason: "no_response", cooldownTriggerAt: NOW },
      NOW,
    );
    expect(s.inCooldown).toBe(true);
    expect(s.daysRemaining).toBe(3);
    expect(s.reason).toBe("no_response");
  });

  it("isClientInCooldown é atalho consistente", () => {
    const c = { cooldownUntil: NOW + 100, cooldownReason: "rejected", cooldownTriggerAt: NOW };
    expect(isClientInCooldown(c, NOW)).toBe(true);
    expect(isClientInCooldown(c, NOW + 200)).toBe(false);
  });

  it("buildCooldownPatch gera until = now + days*86400", () => {
    const p = buildCooldownPatch("rejected", 90, 42, NOW);
    expect(p.cooldownUntil).toBe(NOW + 90 * 86_400);
    expect(p.cooldownReason).toBe("rejected");
    expect(p.cooldownTriggerBoardId).toBe(42);
    expect(p.cooldownTriggerAt).toBe(NOW);
  });
});
