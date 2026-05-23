/**
 * build-template — gera templates/surfsup-conversion-template.xlsx
 * com 5 linhas exemplares (nomes BR realistas, telefones +55, datas DD-MM-YYYY).
 */

import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const headers = [
  "board_id",
  "modelo",
  "tamanho",
  "litros",
  "tipo",
  "marca",
  "preco_site",
  "preco_amigo",
  "preco_minimo",
  "client_id",
  "nome",
  "telefone",
  "email",
  "data_inicio",
  "data_fim",
  "devolucao_real",
];

const rows: (string | number | null)[][] = [
  // Aluguel ativo (sem devolução), preco_minimo explícito
  [
    "B-001",
    "Pyzel Ghost",
    "6'0",
    32.5,
    "Shortboard",
    "Pyzel",
    "500,00",
    "400,00",
    "350,00",
    "C-101",
    "João Pereira",
    "+4740346834",
    "joao@example.com",
    "10-03-2026",
    "15-03-2026",
    null, // ativa
  ],
  // Aluguel devolvido
  [
    "B-002",
    "Channel Islands Happy",
    "5'10",
    30.0,
    "Shortboard",
    "Channel Islands",
    "480,00",
    "380,00",
    "330,00",
    "C-102",
    "Maria Souza",
    "+4740346834",
    "maria@example.com",
    "01-02-2026",
    "07-02-2026",
    "07-02-2026",
  ],
  // Sem preco_minimo (testa default amigo*0.88)
  [
    "B-003",
    "Mayhem Sub Driver",
    "6'2",
    34.0,
    "Shortboard",
    "Lost",
    "520,00",
    "420,00",
    null,
    "C-101",
    "João Pereira",
    "+4740346834",
    "joao@example.com",
    "20-01-2026",
    "23-01-2026",
    "23-01-2026",
  ],
  // Longboard
  [
    "B-004",
    "Bing Silver Spoon",
    "9'2",
    65.0,
    "Longboard",
    "Bing",
    "600,00",
    "500,00",
    "450,00",
    "C-103",
    "Ana Carolina Lima",
    "+4740346834",
    null,
    "12-03-2026",
    "14-03-2026",
    null,
  ],
  // Fish, segundo aluguel do mesmo cliente para mesma board
  [
    "B-005",
    "Lost RNF Retro",
    "5'6",
    28.0,
    "Fish",
    "Lost",
    "470,00",
    "370,00",
    "325,00",
    "C-104",
    "Bruno Carvalho",
    "+4740346834",
    "bruno@example.com",
    "05-01-2026",
    "09-01-2026",
    "09-01-2026",
  ],
];

const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "rentals");

const outPath = path.resolve(process.cwd(), "templates/surfsup-conversion-template.xlsx");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
XLSX.writeFile(wb, outPath);

// eslint-disable-next-line no-console
console.log(`✓ template gerado em ${outPath}`);
