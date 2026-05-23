import { trpc } from "@/lib/trpc";
import { formatBRL, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function ScoreBadge({ score }: { score: number }) {
  if (score < 0) return <span className="text-slate-400">—</span>;
  const color = score >= 75 ? "text-emerald-700 bg-emerald-50" : score >= 50 ? "text-amber-700 bg-amber-50" : "text-slate-600 bg-slate-100";
  return <span className={`px-2 py-0.5 rounded text-xs font-mono ${color}`}>{score.toFixed(1)}</span>;
}

export function Dashboard() {
  const kpisQ = trpc.dashboard.getKPIs.useQuery();
  const upcomingQ = trpc.dashboard.getUpcomingConversions.useQuery({ limit: 10 });
  const utils = trpc.useUtils();
  const genMsg = trpc.offers.generateMessage.useMutation({
    onSuccess: () => {
      toast.success("Mensagem em rascunho — vá para Aprovações");
      utils.dashboard.getUpcomingConversions.invalidate();
      utils.rentals.list.invalidate();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const kpis = kpisQ.data;

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Visão do funil de conversão.</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Aluguéis ativos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-semibold">
              {kpisQ.isLoading ? "…" : (kpis?.activeRentals ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">
              Em janela de oferta ({kpis?.offerWindowDays ?? 2}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-semibold text-amber-600">
              {kpisQ.isLoading ? "…" : (kpis?.inOfferWindow ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Convertidos este mês</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-semibold text-emerald-600">
              {kpisQ.isLoading ? "…" : (kpis?.convertedThisMonth ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Receita do mês</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-semibold">
              {kpisQ.isLoading ? "…" : formatBRL(kpis?.revenueThisMonth ?? 0)}
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Próximas conversões</h2>
        <Card>
          <CardContent className="p-0">
            {upcomingQ.isLoading ? (
              <div className="p-6 text-slate-500 text-sm">Carregando…</div>
            ) : (upcomingQ.data?.length ?? 0) === 0 ? (
              <div className="p-6 text-slate-500 text-sm">
                Nenhum aluguel elegível agora. Suba mais dados em <a href="/importar" className="underline">Importar</a>.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Cliente</th>
                    <th className="px-4 py-2">Prancha</th>
                    <th className="px-4 py-2">Fim</th>
                    <th className="px-4 py-2 text-right">Restam</th>
                    <th className="px-4 py-2 text-right">× alugou</th>
                    <th className="px-4 py-2 text-right">Score</th>
                    <th className="px-4 py-2 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingQ.data!.map((r) => (
                    <tr key={r.rentalId} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{r.clientName}</td>
                      <td className="px-4 py-2 text-slate-600">{r.boardLabel}</td>
                      <td className="px-4 py-2 text-slate-600">{formatDate(r.endDate)}</td>
                      <td className={`px-4 py-2 text-right font-mono ${r.daysRemaining < 0 ? "text-red-600" : r.daysRemaining <= 2 ? "text-amber-600" : ""}`}>
                        {r.daysRemaining}d
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{r.stats.rentalsOfThisBoard}</td>
                      <td className="px-4 py-2 text-right">
                        <ScoreBadge score={r.score} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          disabled={r.offerStatus !== "NoOffer" || genMsg.isPending}
                          onClick={() => genMsg.mutate({ rentalId: r.rentalId })}
                        >
                          Gerar mensagem
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
