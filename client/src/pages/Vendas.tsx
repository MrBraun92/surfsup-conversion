import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatDate, cn } from "@/lib/utils";

type Tab = "efetivas" | "rejeitadas";

const REASON_LABEL: Record<string, string> = {
  rejected: "Recusou",
  no_response: "Não respondeu",
  accepted_unpaid: "Aceitou e não pagou",
};

export function Vendas() {
  const [tab, setTab] = useState<Tab>("efetivas");
  const effQ = trpc.sales.listEffective.useQuery();
  const rejQ = trpc.sales.listRejected.useQuery();
  const kEffQ = trpc.sales.kpisEffective.useQuery();
  const kRejQ = trpc.sales.kpisRejected.useQuery();

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Vendas</h1>
        <p className="text-slate-500 text-sm mt-1">Acompanhamento de conversões e ofertas perdidas.</p>
      </header>

      <div className="flex gap-2">
        {(["efetivas", "rejeitadas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 rounded text-sm font-medium border transition-colors",
              tab === t
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
            )}
          >
            {t === "efetivas" ? "Efetivas" : "Recusadas / Ignoradas"}
          </button>
        ))}
      </div>

      {tab === "efetivas" ? (
        <EfetivasSection kpis={kEffQ.data} rows={effQ.data ?? []} loading={effQ.isLoading} />
      ) : (
        <RejeitadasSection kpis={kRejQ.data} rows={rejQ.data ?? []} loading={rejQ.isLoading} />
      )}
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wide text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-mono font-semibold">{value}</div>
        {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function EfetivasSection({
  kpis,
  rows,
  loading,
}: {
  kpis: { totalRevenue: number; ticketAverage: number; conversionRate: number; salesThisMonth: number; salesThisMonthRevenue: number } | undefined;
  rows: any[];
  loading: boolean;
}) {
  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total vendido" value={formatBRL(kpis?.totalRevenue ?? 0)} />
        <KpiCard label="Ticket médio" value={formatBRL(kpis?.ticketAverage ?? 0)} />
        <KpiCard label="Taxa de conversão" value={`${kpis?.conversionRate ?? 0}%`} />
        <KpiCard
          label="Vendas no mês"
          value={String(kpis?.salesThisMonth ?? 0)}
          hint={formatBRL(kpis?.salesThisMonthRevenue ?? 0)}
        />
      </section>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Prancha</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-left px-3 py-2">Pago em</th>
              <th className="text-left px-3 py-2">Notificada Surfsup</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">Carregando…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  Nenhuma venda efetivada ainda.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.sale.id} className="border-b hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{row.client.name}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.board.model}</div>
                  <div className="text-xs text-slate-500">{row.board.size}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatBRL(row.sale.salePrice)}</td>
                <td className="px-3 py-2 text-xs">{formatDate(row.sale.paidAt)}</td>
                <td className="px-3 py-2 text-xs">
                  {row.sale.surfsupNotifiedAt ? (
                    <span className="text-emerald-700">Sim · {formatDate(row.sale.surfsupNotifiedAt)}</span>
                  ) : (
                    <span className="text-amber-700">Não</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RejeitadasSection({
  kpis,
  rows,
  loading,
}: {
  kpis: { totalRejected: number; totalCooldownGenerated: number; byReason: { rejected: number; no_response: number; accepted_unpaid: number } } | undefined;
  rows: any[];
  loading: boolean;
}) {
  const byReason = kpis?.byReason ?? { rejected: 0, no_response: 0, accepted_unpaid: 0 };
  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KpiCard label="Total recusadas / ignoradas" value={String(kpis?.totalRejected ?? 0)} />
        <KpiCard label="Cooldowns gerados" value={String(kpis?.totalCooldownGenerated ?? 0)} />
      </section>

      <div className="text-sm text-slate-600">
        Recusou: <span className="font-mono font-semibold">{byReason.rejected}</span> ·{" "}
        Não respondeu: <span className="font-mono font-semibold">{byReason.no_response}</span> ·{" "}
        Aceitou e não pagou: <span className="font-mono font-semibold">{byReason.accepted_unpaid}</span>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Prancha</th>
              <th className="text-left px-3 py-2">Motivo</th>
              <th className="text-left px-3 py-2">Data</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">Carregando…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  Nenhuma oferta recusada ou ignorada.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.offer.id} className="border-b hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{row.client.name}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.board.model}</div>
                  <div className="text-xs text-slate-500">{row.board.size}</div>
                </td>
                <td className="px-3 py-2 text-xs">{REASON_LABEL[row.reason] ?? row.reason}</td>
                <td className="px-3 py-2 text-xs">
                  {formatDate(Math.floor(new Date(row.offer.updatedAt).getTime() / 1000))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
