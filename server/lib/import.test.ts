import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../db/schema.js";
import {
  parseImportRows,
  parseBRDate,
  parsePtBRNumber,
  normalizePhone,
} from "./csvImport.js";
import { processImport } from "./import.js";

function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0000_initial.sql"),
    "utf-8",
  );
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function buildXlsx(headers: string[], rows: (string | number | null)[][]): Buffer {
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return out as Buffer;
}

describe("parseBRDate", () => {
  it("parses DD-MM-YYYY", () => {
    const ts = parseBRDate("15-03-2025");
    expect(ts).not.toBeNull();
    const d = new Date(ts! * 1000);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(15);
  });
  it("parses DD/MM/YYYY", () => {
    expect(parseBRDate("01/01/2026")).not.toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseBRDate("foo")).toBeNull();
    expect(parseBRDate("32-13-2025")).toBeNull();
    expect(parseBRDate(null)).toBeNull();
    expect(parseBRDate("")).toBeNull();
  });
});

describe("parsePtBRNumber", () => {
  it("parses PT-BR format", () => {
    expect(parsePtBRNumber("1.234,56")).toBe(1234.56);
    expect(parsePtBRNumber("450,00")).toBe(450);
  });
  it("parses plain numbers", () => {
    expect(parsePtBRNumber("123.45")).toBe(123.45);
    expect(parsePtBRNumber(99)).toBe(99);
    expect(parsePtBRNumber("R$ 1.500,00")).toBe(1500);
  });
  it("returns null for invalid", () => {
    expect(parsePtBRNumber("abc")).toBeNull();
    expect(parsePtBRNumber(null)).toBeNull();
    expect(parsePtBRNumber("")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("keeps E.164 phones", () => {
    expect(normalizePhone("+5511999998888")).toEqual({
      phone: "+5511999998888",
      warned: false,
    });
  });
  it("prepends +55 for BR-shaped digits", () => {
    expect(normalizePhone("11999998888")).toEqual({
      phone: "+5511999998888",
      warned: true,
    });
  });
  it("handles formatted BR phones", () => {
    expect(normalizePhone("(11) 99999-8888")).toEqual({
      phone: "+5511999998888",
      warned: true,
    });
  });
});

describe("parseImportRows", () => {
  it("parses valid headers + rows", () => {
    const buf = buildXlsx(
      [
        "board_id",
        "modelo",
        "tamanho",
        "preco_site",
        "preco_amigo",
        "client_id",
        "nome",
        "telefone",
        "data_inicio",
        "data_fim",
      ],
      [
        [
          "B1",
          "Pyzel Ghost",
          "6'0",
          500,
          400,
          "C1",
          "João",
          "+5511999998888",
          "10-03-2026",
          "15-03-2026",
        ],
      ],
    );
    const r = parseImportRows(buf, "x.xlsx");
    expect(r.headerErrors).toEqual([]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]!.raw["board_id"]).toBe("B1");
  });

  it("reports missing headers", () => {
    const buf = buildXlsx(
      ["board_id", "modelo"], // faltam vários
      [["B1", "Pyzel"]],
    );
    const r = parseImportRows(buf, "x.xlsx");
    expect(r.headerErrors.length).toBeGreaterThan(0);
    expect(r.rows.length).toBe(0);
  });
});

describe("processImport — integrado", () => {
  const fullHeaders = [
    "board_id",
    "modelo",
    "tamanho",
    "preco_site",
    "preco_amigo",
    "client_id",
    "nome",
    "telefone",
    "data_inicio",
    "data_fim",
  ];

  it("inserts new clients/boards/rentals and reports correctly", async () => {
    const { db } = setupTestDb();
    const buf = buildXlsx(fullHeaders, [
      ["B1", "Pyzel Ghost", "6'0", 500, 400, "C1", "João", "+5511999998888", "10-03-2026", "15-03-2026"],
      ["B2", "Channel Islands", "5'10", 480, 380, "C2", "Maria", "+5511988887777", "12-03-2026", "14-03-2026"],
      ["B1", "Pyzel Ghost", "6'0", 500, 400, "C1", "João", "+5511999998888", "20-04-2026", "25-04-2026"],
    ]);

    const result = await processImport(buf, "test.xlsx", db as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.clients.new).toBe(2);
    expect(result.report.boards.new).toBe(2);
    expect(result.report.rentals.inserted).toBe(3);
    expect(result.report.errors.length).toBe(0);

    // Idempotência: rodar de novo deve skipar tudo
    const result2 = await processImport(buf, "test.xlsx", db as never);
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    // 3 linhas re-processadas: C1 e B1 aparecem 2x cada (linhas 1 e 3), C2/B2 1x
    expect(result2.report.clients.updated).toBe(3);
    expect(result2.report.boards.updated).toBe(3);
    expect(result2.report.rentals.skipped).toBe(3);
    expect(result2.report.rentals.inserted).toBe(0);
  });

  it("returns headerErrors when required column missing", async () => {
    const { db } = setupTestDb();
    const buf = buildXlsx(
      ["board_id", "modelo"], // faltam várias obrigatórias
      [["B1", "Pyzel"]],
    );
    const result = await processImport(buf, "test.xlsx", db as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.headerErrors.length).toBeGreaterThan(0);
  });

  it("collects per-row errors without aborting", async () => {
    const { db } = setupTestDb();
    const buf = buildXlsx(fullHeaders, [
      ["B1", "Pyzel Ghost", "6'0", 500, 400, "C1", "João", "+5511999998888", "10-03-2026", "15-03-2026"],
      ["B2", "X", "5'10", 480, 380, "C2", "Maria", "+5511988887777", "INVALIDA", "14-03-2026"],
      ["B3", "Y", "6'2", 520, 420, "C3", "Ana", "+5511977776666", "01-05-2026", "05-05-2026"],
    ]);
    const result = await processImport(buf, "test.xlsx", db as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.errors.length).toBe(1);
    expect(result.report.errors[0]!.rowIndex).toBe(2);
    expect(result.report.rentals.inserted).toBe(2);
  });
});
