import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { draftOfferMessage } from "./llm.js";

describe("llm.draftOfferMessage — offline fallback", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalMode = process.env.LLM_MODE;
  const originalFlag = process.env.LLM_OFFLINE_FALLBACK_MODE;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODE;
    delete process.env.LLM_OFFLINE_FALLBACK_MODE;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    if (originalMode !== undefined) process.env.LLM_MODE = originalMode;
    if (originalFlag !== undefined) process.env.LLM_OFFLINE_FALLBACK_MODE = originalFlag;
  });

  it("retorna template não-vazio contendo primeiro nome e preço formatado quando sem API key", async () => {
    const text = await draftOfferMessage({
      clientName: "João Silva Santos",
      boardModel: "Pyzel Ghost",
      boardSize: "6'0",
      days: 12,
      rentals: 4,
      endDateBR: "25/05/2026",
      precoSite: 5000,
      precoAmigo: 4000,
    });
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain("João");
    expect(text).not.toContain("Silva");
    expect(text).toMatch(/R\$\s*4\.000,00/);
    expect(text).toMatch(/R\$\s*5\.000,00/);
    expect(text).toContain("Pyzel Ghost");
    expect(text).toContain("25/05/2026");
  });

  it("aplica prefixo [OFFLINE] quando LLM_OFFLINE_FALLBACK_MODE=1", async () => {
    process.env.LLM_OFFLINE_FALLBACK_MODE = "1";
    const text = await draftOfferMessage({
      clientName: "Maria",
      boardModel: "Lost",
      boardSize: "5'10",
      days: 5,
      rentals: 2,
      endDateBR: "01/06/2026",
      precoSite: 3000,
      precoAmigo: 2500,
    });
    expect(text.startsWith("[OFFLINE]")).toBe(true);
  });

  it("trata placeholder sk-... como offline", async () => {
    process.env.OPENAI_API_KEY = "sk-...";
    const text = await draftOfferMessage({
      clientName: "Ana",
      boardModel: "Channel Islands",
      boardSize: "5'8",
      days: 3,
      rentals: 1,
      endDateBR: "10/06/2026",
      precoSite: 4500,
      precoAmigo: 3800,
    });
    expect(text).toContain("Ana");
    expect(text.length).toBeGreaterThan(20);
  });

  it("respeita LLM_MODE=offline mesmo com API key presente", async () => {
    process.env.OPENAI_API_KEY = "sk-real-key-abc";
    process.env.LLM_MODE = "offline";
    const text = await draftOfferMessage({
      clientName: "Carlos",
      boardModel: "Mayhem",
      boardSize: "6'2",
      days: 7,
      rentals: 3,
      endDateBR: "15/06/2026",
      precoSite: 6000,
      precoAmigo: 5000,
    });
    expect(text).toContain("Carlos");
  });
});
