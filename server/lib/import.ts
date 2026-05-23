/**
 * import — orquestra ingestão de planilha (CSV/XLSX) em clients/boards/rentals.
 *
 * - Validação por linha (linha ruim vai para `errors`, não aborta).
 * - Upsert idempotente por surfsup_*_id e composto.
 * - Recalcula agregados (clients.total_*, client_board_stats) e re-score.
 */

import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { db as defaultDb, schema } from "../db/index.js";
import {
  parseImportRows,
  parseBRDate,
  parsePtBRNumber,
  normalizePhone,
} from "./csvImport.js";
import { computeScore } from "./scoring.js";

type DB = typeof defaultDb;

export interface ImportReport {
  clients: { new: number; updated: number };
  boards: { new: number; updated: number };
  rentals: { inserted: number; skipped: number };
  warnings: string[];
  errors: { rowIndex: number; message: string }[];
  rescored: number;
}

export type ImportResult =
  | { ok: false; headerErrors: string[]; report: null }
  | { ok: true; headerErrors: []; report: ImportReport };

interface RowValid {
  rowIndex: number;
  boardId: string;
  modelo: string;
  tamanho: string;
  brand: string | null;
  liters: number | null;
  boardType: string | null;
  precoSite: number;
  precoAmigo: number;
  precoMinimo: number;
  status: string | null;
  clientId: string;
  nome: string;
  phone: string;
  email: string | null;
  dataInicio: number;
  dataFim: number;
  devolucaoReal: number | null;
  rentalStatus: string;
}

function pickStr(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function validateRow(
  raw: Record<string, unknown>,
  rowIndex: number,
): { ok: true; row: RowValid; warnings: string[] } | { ok: false; message: string } {
  const warnings: string[] = [];
  const boardId = pickStr(raw, "board_id");
  if (!boardId) return { ok: false, message: "board_id ausente" };
  const modelo = pickStr(raw, "modelo");
  if (!modelo) return { ok: false, message: "modelo ausente" };
  const tamanho = pickStr(raw, "tamanho");
  if (!tamanho) return { ok: false, message: "tamanho ausente" };
  const precoSite = parsePtBRNumber(raw["preco_site"]);
  if (precoSite === null) return { ok: false, message: "preco_site inválido" };
  const precoAmigo = parsePtBRNumber(raw["preco_amigo"]);
  if (precoAmigo === null) return { ok: false, message: "preco_amigo inválido" };
  const clientId = pickStr(raw, "client_id");
  if (!clientId) return { ok: false, message: "client_id ausente" };
  const nome = pickStr(raw, "nome");
  if (!nome) return { ok: false, message: "nome ausente" };
  const phoneRaw = raw["telefone"];
  const { phone, warned: phoneWarned } = normalizePhone(phoneRaw);
  if (!phone) return { ok: false, message: "telefone inválido" };
  if (phoneWarned) warnings.push(`Linha ${rowIndex}: telefone normalizado para ${phone}`);
  const dataInicio = parseBRDate(raw["data_inicio"]);
  if (dataInicio === null) return { ok: false, message: "data_inicio inválida (use DD-MM-YYYY)" };
  const dataFim = parseBRDate(raw["data_fim"]);
  if (dataFim === null) return { ok: false, message: "data_fim inválida (use DD-MM-YYYY)" };
  if (dataFim < dataInicio) return { ok: false, message: "data_fim anterior a data_inicio" };

  const precoMinimoRaw = parsePtBRNumber(raw["preco_minimo"]);
  const precoMinimo = precoMinimoRaw ?? Math.round(precoAmigo * 0.88 * 100) / 100;

  const litersRaw = parsePtBRNumber(raw["litros"] ?? raw["liters"]);
  const liters = litersRaw ?? null;

  const devolucaoReal = parseBRDate(raw["devolucao_real"]);

  return {
    ok: true,
    warnings,
    row: {
      rowIndex,
      boardId,
      modelo,
      tamanho,
      brand: pickStr(raw, "marca") ?? pickStr(raw, "brand"),
      liters,
      boardType: pickStr(raw, "tipo") ?? pickStr(raw, "board_type"),
      precoSite,
      precoAmigo,
      precoMinimo,
      status: pickStr(raw, "status_prancha"),
      clientId,
      nome,
      phone,
      email: pickStr(raw, "email"),
      dataInicio,
      dataFim,
      devolucaoReal,
      rentalStatus: pickStr(raw, "status_aluguel") ?? (devolucaoReal ? "Returned" : "Active"),
    },
  };
}

export async function processImport(
  buf: Buffer,
  filename: string,
  database: DB = defaultDb,
): Promise<ImportResult> {
  const parsed = parseImportRows(buf, filename);
  if (parsed.headerErrors.length > 0) {
    return { ok: false, headerErrors: parsed.headerErrors, report: null };
  }

  const report: ImportReport = {
    clients: { new: 0, updated: 0 },
    boards: { new: 0, updated: 0 },
    rentals: { inserted: 0, skipped: 0 },
    warnings: [],
    errors: [],
    rescored: 0,
  };

  // Pré-validação de todas as linhas
  const validRows: RowValid[] = [];
  const nameByClient = new Map<string, string>();
  for (const r of parsed.rows) {
    const v = validateRow(r.raw, r.rowIndex);
    if (!v.ok) {
      report.errors.push({ rowIndex: r.rowIndex, message: v.message });
      continue;
    }
    // Detecta nome divergente para mesmo client_id (warning)
    const existingName = nameByClient.get(v.row.clientId);
    if (existingName && existingName !== v.row.nome) {
      report.warnings.push(
        `Linha ${v.row.rowIndex}: client_id ${v.row.clientId} já apareceu com nome "${existingName}" — mantendo o primeiro.`,
      );
    } else if (!existingName) {
      nameByClient.set(v.row.clientId, v.row.nome);
    }
    report.warnings.push(...v.warnings);
    validRows.push(v.row);
  }

  // Drizzle better-sqlite3 — transação síncrona
  // @ts-expect-error transaction tipo é genérico mas funciona
  database.transaction((tx: DB) => {
    for (const row of validRows) {
      try {
        upsertOne(tx, row, report);
      } catch (e) {
        report.errors.push({
          rowIndex: row.rowIndex,
          message: `Erro ao salvar: ${(e as Error).message}`,
        });
      }
    }
  });

  // Recalcula agregados fora da transação principal (pode ser pesado)
  recomputeAggregates(database, Array.from(new Set(validRows.map((r) => r.clientId))));

  // Re-score de aluguéis ativos
  report.rescored = rescoreActiveRentals(database);

  return { ok: true, headerErrors: [], report };
}

function upsertOne(database: DB, row: RowValid, report: ImportReport) {
  // ---- boards
  const existingBoard = database
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.surfsupBoardId, row.boardId))
    .all();
  let boardPk: number;
  if (existingBoard.length === 0) {
    const res = database
      .insert(schema.boards)
      .values({
        surfsupBoardId: row.boardId,
        model: row.modelo,
        brand: row.brand,
        size: row.tamanho,
        liters: row.liters,
        boardType: row.boardType,
        precoSite: row.precoSite,
        precoAmigo: row.precoAmigo,
        precoMinimo: row.precoMinimo,
        status: row.rentalStatus === "Active" ? "EmAluguel" : (row.status ?? "Disponivel"),
      })
      .returning({ id: schema.boards.id })
      .all();
    boardPk = res[0]!.id;
    report.boards.new++;
  } else {
    boardPk = existingBoard[0]!.id;
    database
      .update(schema.boards)
      .set({
        model: row.modelo,
        brand: row.brand ?? existingBoard[0]!.brand,
        size: row.tamanho,
        liters: row.liters ?? existingBoard[0]!.liters,
        boardType: row.boardType ?? existingBoard[0]!.boardType,
        precoSite: row.precoSite,
        precoAmigo: row.precoAmigo,
        precoMinimo: row.precoMinimo,
        status:
          row.rentalStatus === "Active"
            ? "EmAluguel"
            : (row.status ?? existingBoard[0]!.status ?? "Disponivel"),
        updatedAt: new Date(),
      })
      .where(eq(schema.boards.id, boardPk))
      .run();
    report.boards.updated++;
  }

  // ---- clients
  const existingClient = database
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.surfsupClientId, row.clientId))
    .all();
  let clientPk: number;
  if (existingClient.length === 0) {
    const res = database
      .insert(schema.clients)
      .values({
        surfsupClientId: row.clientId,
        name: row.nome,
        phone: row.phone,
        email: row.email,
      })
      .returning({ id: schema.clients.id })
      .all();
    clientPk = res[0]!.id;
    report.clients.new++;
  } else {
    clientPk = existingClient[0]!.id;
    database
      .update(schema.clients)
      .set({
        // Não muda nome (preserva primeiro)
        phone: row.phone,
        email: row.email ?? existingClient[0]!.email,
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.id, clientPk))
      .run();
    report.clients.updated++;
  }

  // ---- rentals (idempotência pelo composto client_id+board_id+start_date)
  const existingRental = database
    .select()
    .from(schema.rentals)
    .where(
      and(
        eq(schema.rentals.clientId, clientPk),
        eq(schema.rentals.boardId, boardPk),
        eq(schema.rentals.startDate, row.dataInicio),
      ),
    )
    .all();

  if (existingRental.length > 0) {
    report.rentals.skipped++;
    return;
  }

  const surfsupRentalId =
    pickRentalId(row) ?? `${row.clientId}-${row.boardId}-${row.dataInicio}`;

  const status = row.devolucaoReal ? "Returned" : row.rentalStatus;

  database
    .insert(schema.rentals)
    .values({
      surfsupRentalId,
      clientId: clientPk,
      boardId: boardPk,
      startDate: row.dataInicio,
      endDate: row.dataFim,
      returnedAt: row.devolucaoReal,
      status,
    })
    .run();
  report.rentals.inserted++;
}

function pickRentalId(row: RowValid): string | null {
  // Suporte opcional caso a planilha tenha rental_id explícito (não obrigatório)
  // Mantido como hook para evolução futura — atualmente sempre null.
  void row;
  return null;
}

/**
 * Recalcula clients.total_rentals, clients.total_days_rented e client_board_stats
 * para os clientes afetados.
 */
export function recomputeAggregates(database: DB, surfsupClientIds: string[]) {
  if (surfsupClientIds.length === 0) return;
  const clientsRows = database
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(inArray(schema.clients.surfsupClientId, surfsupClientIds))
    .all();
  const clientIds = clientsRows.map((c) => c.id);
  if (clientIds.length === 0) return;

  const rentalsRows = database
    .select()
    .from(schema.rentals)
    .where(inArray(schema.rentals.clientId, clientIds))
    .all();

  // Por cliente
  const byClient = new Map<number, typeof rentalsRows>();
  for (const r of rentalsRows) {
    const arr = byClient.get(r.clientId) ?? [];
    arr.push(r);
    byClient.set(r.clientId, arr);
  }

  for (const [cid, list] of byClient) {
    const totalRentals = list.length;
    const totalDays = list.reduce((acc, r) => {
      const days = Math.max(1, Math.round((r.endDate - r.startDate) / 86_400) + 1);
      return acc + days;
    }, 0);
    database
      .update(schema.clients)
      .set({ totalRentals, totalDaysRented: totalDays, updatedAt: new Date() })
      .where(eq(schema.clients.id, cid))
      .run();
  }

  // client_board_stats — agrega por par
  const pairs = new Map<string, { clientId: number; boardId: number; count: number; days: number; last: number }>();
  for (const r of rentalsRows) {
    const key = `${r.clientId}:${r.boardId}`;
    const days = Math.max(1, Math.round((r.endDate - r.startDate) / 86_400) + 1);
    const existing = pairs.get(key);
    if (existing) {
      existing.count++;
      existing.days += days;
      if (r.startDate > existing.last) existing.last = r.startDate;
    } else {
      pairs.set(key, {
        clientId: r.clientId,
        boardId: r.boardId,
        count: 1,
        days,
        last: r.startDate,
      });
    }
  }

  for (const p of pairs.values()) {
    const existing = database
      .select()
      .from(schema.clientBoardStats)
      .where(
        and(
          eq(schema.clientBoardStats.clientId, p.clientId),
          eq(schema.clientBoardStats.boardId, p.boardId),
        ),
      )
      .all();
    if (existing.length === 0) {
      database
        .insert(schema.clientBoardStats)
        .values({
          clientId: p.clientId,
          boardId: p.boardId,
          rentalsCount: p.count,
          daysCount: p.days,
          lastRentalAt: p.last,
        })
        .run();
    } else {
      database
        .update(schema.clientBoardStats)
        .set({
          rentalsCount: p.count,
          daysCount: p.days,
          lastRentalAt: p.last,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.clientBoardStats.clientId, p.clientId),
            eq(schema.clientBoardStats.boardId, p.boardId),
          ),
        )
        .run();
    }
  }
}

/**
 * Re-score de todos os aluguéis Active sem devolução. Cria/atualiza conversion_offers.
 * Retorna quantos foram processados.
 */
export function rescoreActiveRentals(database: DB): number {
  const actives = database
    .select()
    .from(schema.rentals)
    .where(and(eq(schema.rentals.status, "Active"), isNull(schema.rentals.returnedAt)))
    .all();

  let count = 0;
  for (const rental of actives) {
    const client = database
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, rental.clientId))
      .all()[0];
    if (!client) continue;
    const board = database
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, rental.boardId))
      .all()[0];
    if (!board) continue;
    const stats = database
      .select()
      .from(schema.clientBoardStats)
      .where(
        and(
          eq(schema.clientBoardStats.clientId, rental.clientId),
          eq(schema.clientBoardStats.boardId, rental.boardId),
        ),
      )
      .all()[0];
    // Últimas 10 pranchas alugadas pelo cliente
    const recentRentals = database
      .select({ boardId: schema.rentals.boardId, startDate: schema.rentals.startDate })
      .from(schema.rentals)
      .where(eq(schema.rentals.clientId, rental.clientId))
      .orderBy(desc(schema.rentals.startDate))
      .limit(10)
      .all();
    const recentBoardIds = recentRentals.map((r) => r.boardId);
    const boardTypeMap = new Map<number, string | null>();
    if (recentBoardIds.length > 0) {
      const allBoards = database
        .select({ id: schema.boards.id, boardType: schema.boards.boardType })
        .from(schema.boards)
        .where(inArray(schema.boards.id, recentBoardIds))
        .all();
      for (const b of allBoards) boardTypeMap.set(b.id, b.boardType);
    }
    const recentBoardTypes = recentBoardIds.map((id) => boardTypeMap.get(id) ?? null);

    // Última data de aluguel (qualquer prancha)
    const lastRentalAt = recentRentals[0]?.startDate ?? null;

    const result = computeScore({
      rentalsOfThisBoard: stats?.rentalsCount ?? 0,
      daysOfThisBoard: stats?.daysCount ?? 0,
      totalRentals: client.totalRentals,
      lastRentalAt,
      offeredBoardType: board.boardType,
      recentBoardTypes,
      client: {
        cooldownUntil: client.cooldownUntil,
        cooldownReason: client.cooldownReason,
        cooldownTriggerAt: client.cooldownTriggerAt,
      },
    });

    const existingOffer = database
      .select()
      .from(schema.conversionOffers)
      .where(eq(schema.conversionOffers.rentalId, rental.id))
      .all()[0];

    if (!existingOffer) {
      database
        .insert(schema.conversionOffers)
        .values({
          rentalId: rental.id,
          clientId: rental.clientId,
          boardId: rental.boardId,
          score: result.score,
          scoringReason: result.reason,
          status: "NoOffer",
        })
        .run();
      count++;
    } else if (existingOffer.status === "NoOffer" || existingOffer.status === "Draft") {
      database
        .update(schema.conversionOffers)
        .set({
          score: result.score,
          scoringReason: result.reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversionOffers.id, existingOffer.id))
        .run();
      count++;
    }
  }
  return count;
}
