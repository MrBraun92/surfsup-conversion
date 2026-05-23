/**
 * clientCooldown — lógica universal de cooldown de cliente.
 *
 * Portado conceitualmente do revenue-swell. Cliente fica em cooldown quando:
 *  - rejeita explicitamente uma oferta ("rejected")
 *  - não responde até a expiração da janela ("no_response")
 *  - aceita mas não paga até a expiração ("accepted_unpaid")
 *
 * Cooldown é por CLIENTE (não por par cliente×prancha) e dura `cooldownDays` dias
 * a partir do trigger. Durante o cooldown:
 *  - nenhuma nova oferta é gerada para esse cliente
 *  - "modo consultoria": bot pode responder inbound, mas não pushea oferta
 */

export type CooldownReason = "rejected" | "no_response" | "accepted_unpaid";

export interface ClientCooldownInput {
  cooldownUntil: number | null;
  cooldownReason: CooldownReason | string | null;
  cooldownTriggerAt: number | null;
}

export interface CooldownState {
  inCooldown: boolean;
  reason: CooldownReason | null;
  until: number | null;
  daysRemaining: number;
}

/**
 * Estado atual do cooldown do cliente.
 * @param client snapshot dos campos cooldown do cliente
 * @param now    timestamp (segundos unix) — default = agora
 */
export function getCooldownState(
  client: ClientCooldownInput,
  now: number = Math.floor(Date.now() / 1000),
): CooldownState {
  if (!client.cooldownUntil || client.cooldownUntil <= now) {
    return { inCooldown: false, reason: null, until: null, daysRemaining: 0 };
  }
  const secs = client.cooldownUntil - now;
  return {
    inCooldown: true,
    reason: (client.cooldownReason as CooldownReason) ?? null,
    until: client.cooldownUntil,
    daysRemaining: Math.ceil(secs / 86_400),
  };
}

export function isClientInCooldown(
  client: ClientCooldownInput,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  return getCooldownState(client, now).inCooldown;
}

/**
 * Calcula o trigger de cooldown a aplicar — retorna o patch para o cliente.
 * @param reason          motivo do cooldown
 * @param cooldownDays    setting `cooldown_days` (default 90)
 * @param triggerBoardId  id da board que originou (para histórico)
 * @param now             timestamp em segundos
 */
export function buildCooldownPatch(
  reason: CooldownReason,
  cooldownDays: number,
  triggerBoardId: number | null,
  now: number = Math.floor(Date.now() / 1000),
): {
  cooldownUntil: number;
  cooldownReason: CooldownReason;
  cooldownTriggerBoardId: number | null;
  cooldownTriggerAt: number;
} {
  return {
    cooldownUntil: now + cooldownDays * 86_400,
    cooldownReason: reason,
    cooldownTriggerBoardId: triggerBoardId,
    cooldownTriggerAt: now,
  };
}
