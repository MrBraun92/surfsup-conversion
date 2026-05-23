import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type PreviewRow = Record<string, unknown>;

interface FilePayload {
  filename: string;
  base64: string;
  headers: string[];
  previewRows: PreviewRow[];
  totalRows: number;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function Importar() {
  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = trpc.importData.processFile.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Importação concluída.");
      } else {
        toast.error("Cabeçalho inválido — corrija a planilha.");
      }
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  async function handleFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Sem sheet");
      const sheet = wb.Sheets[sheetName]!;
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        blankrows: false,
      });
      const headers = ((aoa[0] ?? []) as unknown[]).map((h) => String(h ?? "").trim());
      const previewRows: PreviewRow[] = aoa.slice(1, 6).map((arr) => {
        const obj: PreviewRow = {};
        const a = arr as unknown[];
        headers.forEach((h, i) => {
          obj[h] = a[i] ?? null;
        });
        return obj;
      });
      setPayload({
        filename: file.name,
        base64: bufferToBase64(buf),
        headers,
        previewRows,
        totalRows: aoa.length - 1,
      });
    } catch (e) {
      toast.error(`Falha ao ler arquivo: ${(e as Error).message}`);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void handleFile(f);
  }

  async function process() {
    if (!payload) return;
    mutation.mutate({ filename: payload.filename, base64: payload.base64 });
  }

  function reset() {
    setPayload(null);
    mutation.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  const result = mutation.data;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importar planilha</h1>
        <p className="text-slate-500 text-sm mt-1">
          Aceita .xlsx ou .csv com as colunas obrigatórias: board_id, modelo, tamanho,
          preco_site, preco_amigo, client_id, nome, telefone, data_inicio, data_fim.
        </p>
      </div>

      {!payload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300"
          }`}
        >
          <p className="text-slate-600">Arraste o arquivo aqui ou clique para escolher</p>
          <p className="text-xs text-slate-400 mt-2">.xlsx ou .csv</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
      )}

      {payload && (
        <Card>
          <CardHeader>
            <CardTitle>
              {payload.filename}{" "}
              <span className="text-slate-400 text-sm font-normal">
                · {payload.totalRows} linhas
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    {payload.headers.map((h) => (
                      <th key={h} className="border px-2 py-1 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.previewRows.map((r, i) => (
                    <tr key={i}>
                      {payload.headers.map((h) => (
                        <td key={h} className="border px-2 py-1">
                          {r[h] === null || r[h] === undefined ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            String(r[h])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button onClick={process} disabled={mutation.isPending}>
                {mutation.isPending ? "Processando..." : "Processar"}
              </Button>
              <Button variant="outline" onClick={reset} disabled={mutation.isPending}>
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !result.ok && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-700">Cabeçalho inválido</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-6 text-sm text-red-700">
              {result.headerErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result && result.ok && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado da importação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Tile label="Clientes" main={`${result.report.clients.new} novos`} sub={`${result.report.clients.updated} atualizados`} />
              <Tile label="Pranchas" main={`${result.report.boards.new} novas`} sub={`${result.report.boards.updated} atualizadas`} />
              <Tile label="Aluguéis" main={`${result.report.rentals.inserted} inseridos`} sub={`${result.report.rentals.skipped} ignorados`} />
            </div>
            <div className="text-sm text-slate-500">
              {result.report.rescored} ofertas (re)calculadas.
            </div>

            {result.report.warnings.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-amber-700">
                  {result.report.warnings.length} avisos
                </summary>
                <ul className="list-disc pl-6 mt-2 text-amber-800">
                  {result.report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}

            {result.report.errors.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-medium text-red-700">
                  {result.report.errors.length} linhas com erro
                </summary>
                <ul className="list-disc pl-6 mt-2 text-red-700">
                  {result.report.errors.map((e, i) => (
                    <li key={i}>
                      Linha {e.rowIndex}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <Button variant="outline" onClick={reset}>
              Importar outro arquivo
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, main, sub }: { label: string; main: string; sub: string }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold mt-1">{main}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
