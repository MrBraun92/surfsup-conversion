/**
 * llm.ts — wrapper sobre OpenAI SDK para gerar mensagens de oferta.
 *
 * Modos:
 *  - Online (default): chama OpenAI Chat Completions API.
 *  - Offline (sem OPENAI_API_KEY, key placeholder, ou LLM_MODE=offline):
 *    retorna um template hardcoded PT-BR usando os mesmos campos.
 *
 * Env vars:
 *  - OPENAI_API_KEY: chave da API (se ausente ou começa com "sk-..." literal, vai offline).
 *  - OPENAI_MODEL: modelo (default "gpt-4o-mini").
 *  - LLM_MODE: "offline" força modo offline.
 *  - LLM_OFFLINE_FALLBACK_MODE: se "1", prefixa "[OFFLINE]" na primeira linha (uso em testes).
 */

import OpenAI from "openai";

export interface DraftOfferInput {
  clientName: string;
  boardModel: string;
  boardSize: string;
  days: number;
  rentals: number;
  endDateBR: string;
  precoSite: number;
  precoAmigo: number;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function isOfflineMode(): boolean {
  if (process.env.LLM_MODE === "offline") return true;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return true;
  // Placeholder literal do .env.example
  if (key === "sk-..." || key.startsWith("sk-...")) return true;
  return false;
}

function offlineTemplate(input: DraftOfferInput): string {
  const fn = firstName(input.clientName);
  const site = formatBRL(input.precoSite);
  const amigo = formatBRL(input.precoAmigo);
  const prefix = process.env.LLM_OFFLINE_FALLBACK_MODE === "1" ? "[OFFLINE]\n" : "";
  return (
    `${prefix}Oi ${fn}! Tudo bem? Aqui é da Surfsup. ` +
    `Vi que você está com a ${input.boardModel} ${input.boardSize} há ${input.days} dias ` +
    `(${input.rentals} aluguéis no último ano) e o aluguel termina em ${input.endDateBR}. ` +
    `Topa ficar com essa mesma prancha por ${amigo} (de ${site})? ` +
    `Sem precisar buscar nem trocar — é a prancha que já está com você. ` +
    `Se não rolar, é só devolver normalmente em ${input.endDateBR}. Abraço!`
  );
}

function buildPrompt(input: DraftOfferInput): string {
  const fn = firstName(input.clientName);
  const site = formatBRL(input.precoSite);
  const amigo = formatBRL(input.precoAmigo);
  return (
    `You are a friendly Brazilian Portuguese surf-shop assistant from Surfsup writing a Telegram message to a current rental customer. ` +
    `They've been renting the board ${input.boardModel} ${input.boardSize} for ${input.days} days ` +
    `(across ${input.rentals} rentals over the past year). The rental ends on ${input.endDateBR}. ` +
    `We're offering them the option to KEEP this exact board for R$ ${amigo} (originally R$ ${site}) ` +
    `— same physical board they're already using. They don't have to inspect, pick up, or travel — ` +
    `just pay the link and the board is theirs. If not interested, return normally on ${input.endDateBR}.\n\n` +
    `Tone: casual but professional, Brazilian Portuguese, 3-4 sentences max. Use ${fn}.`
  );
}

export type InboundIntent = "interested" | "not_interested" | "paid" | "question";

export interface InboundIntentResult {
  intent: InboundIntent;
  confidence: number;
}

function offlineIntent(text: string): InboundIntentResult {
  const t = (text ?? "").toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => t.includes(n));
  if (has("paguei", "pago", "pagamento feito", "transferi")) {
    return { intent: "paid", confidence: 0.6 };
  }
  if (has("não quero", "nao quero", "n quero", "não tenho interesse", "nao tenho interesse", "recuso")) {
    return { intent: "not_interested", confidence: 0.6 };
  }
  if (has("quero", "aceito", "topo", "fechado", "vou ficar", "fico com", "sim")) {
    return { intent: "interested", confidence: 0.6 };
  }
  if (/^\s*não\s*$|^\s*nao\s*$/.test(t)) {
    return { intent: "not_interested", confidence: 0.6 };
  }
  return { intent: "question", confidence: 0.6 };
}

export async function classifyInboundIntent(text: string): Promise<InboundIntentResult> {
  if (isOfflineMode()) {
    return offlineIntent(text);
  }
  try {
    const apiKey = process.env.OPENAI_API_KEY!;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const client = new OpenAI({ apiKey });
    const prompt =
      `Classify the following Brazilian Portuguese reply from a surf-shop customer about an offer to keep their rental board. ` +
      `Reply MUST be JSON {"intent": "...", "confidence": number}. ` +
      `intent ∈ {interested, not_interested, paid, question}. Text: "${text}"`;
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 60,
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return offlineIntent(text);
    const parsed = JSON.parse(raw);
    const intent = parsed.intent as InboundIntent;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    if (!["interested", "not_interested", "paid", "question"].includes(intent)) {
      return offlineIntent(text);
    }
    return { intent, confidence };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[llm] erro classificando intent, usando fallback offline:", err);
    return offlineIntent(text);
  }
}

export async function draftOfferMessage(input: DraftOfferInput): Promise<string> {
  if (isOfflineMode()) {
    return offlineTemplate(input);
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY!;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const client = new OpenAI({ apiKey });
    const content = buildPrompt(input);
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.7,
      max_tokens: 300,
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      // eslint-disable-next-line no-console
      console.warn("[llm] resposta vazia da OpenAI, usando fallback offline");
      return offlineTemplate(input);
    }
    return text;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[llm] erro chamando OpenAI, usando fallback offline:", err);
    return offlineTemplate(input);
  }
}
