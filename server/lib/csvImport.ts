/**
 * csvImport — parsing puro de XLSX/CSV single-sheet para linhas tipadas.
 *
 * Não toca em DB. Não lança exceções por linha — agrega tudo no resultado.
 */

import * as XLSX from "xlsx";

export const REQUIRED_HEADERS = [
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
] as const;

export type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

export interface ImportRow {
  rowIndex: number; // 1-based, corresponde à linha visível na planilha (excluindo header)
  raw: Record<string, unknown>;
}

export interface ParseResult {
  rows: ImportRow[];
  headerErrors: string[];
  headers: string[];
}

/**
 * Parseia buffer (xlsx ou csv) lendo a primeira sheet.
 * Valida apenas headers — validação de campos por linha é responsabilidade do caller.
 */
export function parseImportRows(buffer: Buffer, filename: string): ParseResult {
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: true,
  });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      headerErrors: ["Arquivo não contém nenhuma aba/sheet."],
      headers: [],
    };
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return {
      rows: [],
      headerErrors: ["Primeira aba está vazia."],
      headers: [],
    };
  }

  // header:1 → array de arrays; primeira linha = headers
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  if (aoa.length === 0) {
    return {
      rows: [],
      headerErrors: ["Planilha vazia."],
      headers: [],
    };
  }

  const headersRaw = (aoa[0] ?? []) as unknown[];
  const headers = headersRaw.map((h) => String(h ?? "").trim().toLowerCase());

  const headerErrors: string[] = [];
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      headerErrors.push(`Coluna obrigatória ausente: ${required}`);
    }
  }

  if (headerErrors.length > 0) {
    return { rows: [], headerErrors, headers };
  }

  const rows: ImportRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const arr = aoa[i] ?? [];
    if (arr.every((v) => v === null || v === undefined || String(v).trim() === "")) {
      continue; // pula linhas em branco
    }
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = arr[c] ?? null;
    }
    rows.push({ rowIndex: i, raw: obj });
  }

  return { rows, headerErrors: [], headers };
  // filename apenas para futura logagem; não usado para decidir formato — XLSX.read detecta sozinho.
  void filename;
}

/**
 * Parseia uma string `DD-MM-YYYY` ou `DD/MM/YYYY` para unix-seconds em UTC midnight.
 * Aceita Date direto (caso XLSX retorne Date). Retorna null se inválido.
 */
export function parseBRDate(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return Math.floor(
      Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()) / 1000,
    );
  }
  // Excel serial number
  if (typeof input === "number" && Number.isFinite(input)) {
    // Excel epoch: 1899-12-30 (com bug do 1900)
    const ms = Math.round((input - 25569) * 86_400_000);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Math.floor(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
    );
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (
    !Number.isFinite(dd) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(yyyy) ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }
  const utc = Date.UTC(yyyy, mm - 1, dd);
  return Math.floor(utc / 1000);
}

/**
 * Parseia número PT-BR aceitando "1.234,56", "1234.56", "1234,56" ou number puro.
 */
export function parsePtBRNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (s === "") return null;
  // Remove sufixos de moeda
  s = s.replace(/R\$\s?/gi, "").replace(/\s/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // formato PT-BR clássico: ponto milhar, vírgula decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza telefone para E.164 best-effort. Se não começar com '+', prepende '+55'
 * se aparenta ser BR (10-11 dígitos), senão apenas '+'. Retorna { phone, warned }.
 */
export function normalizePhone(input: unknown): { phone: string | null; warned: boolean } {
  if (input === null || input === undefined || input === "") return { phone: null, warned: false };
  const raw = String(input).trim();
  if (raw === "") return { phone: null, warned: false };
  // Mantém apenas dígitos e '+' inicial
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.length < 8) return { phone: null, warned: false };
    return { phone: `+${digits}`, warned: false };
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 0) return { phone: null, warned: false };
  if (digits.length === 10 || digits.length === 11) {
    return { phone: `+55${digits}`, warned: true };
  }
  return { phone: `+${digits}`, warned: true };
}
