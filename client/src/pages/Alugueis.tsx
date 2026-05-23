import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";

type Filter =
  | "all"
  | "active"
  | "ending_2d"
  | "ending_5d"
  | "ending_7d"
  | "converted"
  | "rejected"
  | "expired";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "active", label: "Ativos" },
  { key: "ending_2d", label: "Acabando em 2d" },
  { key: "ending_5d", label: "Acabando em 5d" },
  { key: "ending_7d", label: "Acabando em 7d" },
  { key: "converted", label: "Convertidos" },
  { key: "rejected", label: "Recusados" },
  { key: "expired", label: "Expirados" },
];

function daysUntil(unix: number, now: number): number {
  return Math.ceil((unix - now) / 86_400);
}

function ScoreCell({ score }: { score: number }) {
  if (score < 0) return <span className="text-slate-300">—</span>;
  const color =
    score >= 75 ? "text-emerald-700 bg-emerald-50" :
    score >= 50 ? "text-amber-700 bg-amber-50" :
                  "text-slate-600 bg-slate-100";
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold", color)}>
      {score.toFixed(1)}
    </span>
  );
}

function CooldownCell({ cooldown }: { cooldown: { inCooldown: boolean; reason: string | null; daysRemaining: number } }) {
  if (!cooldown.inCooldown) {
    return <span className="text-emerald-700 text-xs">Livre</span>;
  }
  return (
    <span className="text-orange-700 text-xs">
      {cooldown.daysRemaining}d ({cooldown.reason ?? "—"})
    </span>
  );
}

function DaysRemainingCell({ days }: { days: number }) {
  if (days < 0) {
    return <span className="text-red-700 font-semibold text-xs">Atrasado: {days}d</span>;
  }
  if (days === 0) {
    return <span className="text-orange-700 font-semibold text-xs">Hoje</span>;
  }
  if (days <= 2) {
    return <span className="text-amber-700 font-semibold text-xs">{days}d</span>;
  }
  return <span className="text-xs">{days}d</span>;
}

export function Alugueis() {
  const [filter, setFilter] = useState<Filter>("all");
  const utils = trpc.useUtils();
  const listQuery = trpc.rentals.list.useQuery({ filter });
  const minScoreQuery = trpc.offers.getMinScoreSetting.useQuery();
  const minScore = minScoreQuery.data?.minScore ?? 50;

  const generateMessage = trpc.offers.generateMessage.useMutation({
    onSuccess: () => {
      toast.success("Mensagem em rascunho gerada.");
      void utils.rentals.list.invalidate();
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const markReturned = trpc.rentals.markReturned.useMutation({
    onSuccess: (res) => {
      if (res.alreadyReturned) {
        toast.info("Aluguel já estava marcado como devolvido.");
      } else {
        toast.success("Aluguel marcado como devolvido.");
      }
      void utils.rentals.list.invalidate();
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const recompute = trpc.rentals.recompute.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.rescored} ofertas recalculadas.`);
      void utils.rentals.list.invalidate();
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const rows = listQuery.data ?? [];
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Aluguéis</h1>
          <p className="text-slate-500 text-sm mt-1">
            Score mínimo para gerar oferta: <span className="font-medium">{minScore}</span>.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          {recompute.isPending ? "Recalculando..." : "Recalcular scores"}
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              filter === f.key
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Telefone</th>
                <th className="text-left px-3 py-2">Prancha</th>
                <th className="text-left px-3 py-2">Início</th>
                <th className="text-left px-3 py-2">Fim previsto</th>
                <th className="text-left px-3 py-2">Restantes</th>
                <th className="text-left px-3 py-2">Alugou esta prancha</th>
                <th className="text-left px-3 py-2">Dias acum.</th>
                <th className="text-left px-3 py-2">Score</th>
                <th className="text-left px-3 py-2">Cooldown</th>
                <th className="text-left px-3 py-2">Oferta</th>
                <th className="text-right px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <>
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className="border-b animate-pulse">
                      {Array.from({ length: 12 }).map((_, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-3 bg-slate-100 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              )}

              {!listQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                    Nenhum aluguel encontrado neste filtro.
                  </td>
                </tr>
              )}

              {rows.map((row) => {
                const days = daysUntil(row.rental.endDate, now);
                const offerStatus = row.offer?.status ?? "—";
                const score = row.offer?.score ?? -1;
                const canGenerate =
                  score >= minScore &&
                  row.offer?.status === "NoOffer" &&
                  !row.cooldown.inCooldown;
                const isActive =
                  row.rental.status === "Active" && !row.rental.returnedAt;

                return (
                  <tr key={row.rental.id} className="border-b hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{row.client.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{row.client.phone}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.board.model}</div>
                      <div className="text-xs text-slate-500">
                        {row.board.size} · [{row.board.surfsupBoardId}]
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDate(row.rental.startDate)}</td>
                    <td className="px-3 py-2 text-xs">{formatDate(row.rental.endDate)}</td>
                    <td className="px-3 py-2">
                      {isActive ? <DaysRemainingCell days={days} /> : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">× {row.stats.rentalsOfThisBoard}</td>
                    <td className="px-3 py-2 text-xs">{row.stats.daysOfThisBoard}d</td>
                    <td className="px-3 py-2"><ScoreCell score={score} /></td>
                    <td className="px-3 py-2"><CooldownCell cooldown={row.cooldown} /></td>
                    <td className="px-3 py-2 text-xs">{offerStatus}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={!canGenerate || generateMessage.isPending}
                          onClick={() =>
                            generateMessage.mutate({ rentalId: row.rental.id })
                          }
                        >
                          Gerar Mensagem
                        </Button>
                        {isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={markReturned.isPending}
                            onClick={() =>
                              markReturned.mutate({ rentalId: row.rental.id })
                            }
                          >
                            Devolvido
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
