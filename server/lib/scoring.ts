/**
 * Conversion Score — 0 a 100.
 *
 * Fórmula:
 *   40 * normalize(rentalsOfThisBoard, max=10)
 *  + 25 * normalize(daysOfThisBoard, max=60)
 *  + 15 * normalize(totalRentals, max=30)
 *  + 10 * normalize(recencyScore, max=1)       // 1 se últimos 30d, 0 em 180d
 *  + 10 * matchAffinity(boardType, history)    // 0..1
 *
 * Se cliente em cooldown → score = -1.
 */

import type { BoardType } from "../../shared/constants.js";
import { isClientInCooldown, type ClientCooldownInput } from "./clientCooldown.js";

export interface ScoringInput {
  rentalsOfThisBoard: number;
  daysOfThisBoard: number;
  totalRentals: number;
  /** unix seconds do aluguel mais recente do cliente (qualquer prancha) */
  lastRentalAt: number | null;
  /** tipo da prancha sendo ofertada */
  offeredBoardType: BoardType | string | null;
  /** tipos das últimas até 10 pranchas alugadas (mais recentes primeiro) */
  recentBoardTypes: (BoardType | string | null)[];
  /** estado de cooldown do cliente */
  client: ClientCooldownInput;
}

export interface ScoringResult {
  score: number; // -1 ou 0..100, com 1 casa decimal
  breakdown: {
    boardRentals: number;
    boardDays: number;
    totalRentals: number;
    recency: number;
    affinity: number;
  };
  reason: string;
}

const cap = (value: number, max: number) => Math.min(Math.max(value, 0), max) / max;

/**
 * Recência: 1.0 se alugou há <=30d, decai linearmente até 0 em 180d, 0 depois.
 */
export function recencyScore(
  lastRentalAt: number | null,
  now: number = Math.floor(Date.now() / 1000),
): number {
  if (!lastRentalAt) return 0;
  const daysSince = (now - lastRentalAt) / 86_400;
  if (daysSince <= 30) return 1;
  if (daysSince >= 180) return 0;
  // decai linear entre 30 e 180 dias
  return 1 - (daysSince - 30) / 150;
}

/**
 * Afinidade de tipo de prancha — última 10 aluguéis do cliente.
 * - oferta == tipo mais comum → 1.0
 * - oferta == 2º mais comum   → 0.66
 * - oferta presente mas raro  → 0.33
 * - oferta nunca alugada      → 0
 * - oferta nula               → 0.5 (neutro)
 */
export function matchAffinity(
  offered: BoardType | string | null,
  history: (BoardType | string | null)[],
): number {
  if (!offered) return 0.5;
  const counts = new Map<string, number>();
  for (const t of history.slice(0, 10)) {
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return 0;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const offeredCount = counts.get(offered) ?? 0;
  if (offeredCount === 0) return 0;
  if (sorted[0] && sorted[0][0] === offered) return 1;
  if (sorted[1] && sorted[1][0] === offered) return 0.66;
  return 0.33;
}

export function computeScore(
  input: ScoringInput,
  now: number = Math.floor(Date.now() / 1000),
): ScoringResult {
  if (isClientInCooldown(input.client, now)) {
    return {
      score: -1,
      breakdown: { boardRentals: 0, boardDays: 0, totalRentals: 0, recency: 0, affinity: 0 },
      reason: "Cliente em cooldown — oferta bloqueada.",
    };
  }

  const boardRentals = 40 * cap(input.rentalsOfThisBoard, 10);
  const boardDays = 25 * cap(input.daysOfThisBoard, 60);
  const totalRentalsPts = 15 * cap(input.totalRentals, 30);
  const recency = 10 * recencyScore(input.lastRentalAt, now);
  const affinity = 10 * matchAffinity(input.offeredBoardType, input.recentBoardTypes);

  const raw = boardRentals + boardDays + totalRentalsPts + recency + affinity;
  const score = Math.round(raw * 10) / 10;

  const reason = buildReason(input);
  return {
    score,
    breakdown: {
      boardRentals: round1(boardRentals),
      boardDays: round1(boardDays),
      totalRentals: round1(totalRentalsPts),
      recency: round1(recency),
      affinity: round1(affinity),
    },
    reason,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildReason(i: ScoringInput): string {
  const bits: string[] = [];
  if (i.rentalsOfThisBoard >= 5) {
    bits.push(
      `Cliente alugou esta prancha ${i.rentalsOfThisBoard} vezes, totalizando ${i.daysOfThisBoard} dias — sinal forte de validação.`,
    );
  } else if (i.rentalsOfThisBoard >= 2) {
    bits.push(
      `Cliente já alugou esta prancha ${i.rentalsOfThisBoard} vezes (${i.daysOfThisBoard} dias acumulados).`,
    );
  } else {
    bits.push(`Primeiro aluguel desta prancha pelo cliente.`);
  }
  if (i.totalRentals >= 10) {
    bits.push(`Histórico ativo no clube (${i.totalRentals} aluguéis no total).`);
  }
  return bits.join(" ");
}
