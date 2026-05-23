import { useState } from "react";
import { useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/utils";

export function Pay() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const utils = trpc.useUtils();
  const q = trpc.payments.getBySession.useQuery({ sessionId }, { enabled: !!sessionId });
  const [outcome, setOutcome] = useState<"success" | "failure" | null>(null);

  const succeed = trpc.payments.succeed.useMutation({
    onSuccess: () => {
      setOutcome("success");
      utils.payments.getBySession.invalidate({ sessionId });
    },
  });
  const fail = trpc.payments.fail.useMutation({
    onSuccess: () => {
      setOutcome("failure");
      utils.payments.getBySession.invalidate({ sessionId });
    },
  });

  if (q.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400">Carregando…</div>
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Pagamento não encontrado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600">Esta sessão de pagamento não existe ou expirou.</p>
            <p className="text-xs text-slate-400 mt-2">Session: {sessionId}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { sale, board, client } = q.data;
  const isPaid = sale.paymentStatus === "paid";
  const isFailed = sale.paymentStatus === "failed";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>🏄 Pagamento Surfsup</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Cliente</div>
            <div className="font-medium">{client?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Prancha</div>
            <div className="font-medium">
              {board?.model ?? "—"} <span className="text-slate-500">{board?.size}</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Valor</div>
            <div className="text-2xl font-mono font-semibold">{formatBRL(sale.salePrice)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
            <div className="text-sm">
              {isPaid && <span className="text-emerald-700 font-medium">Pago</span>}
              {isFailed && <span className="text-red-700 font-medium">Falhou</span>}
              {!isPaid && !isFailed && <span className="text-amber-700 font-medium">Pendente</span>}
            </div>
          </div>

          {outcome === "success" && (
            <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              Pagamento confirmado — obrigado!
            </div>
          )}
          {outcome === "failure" && (
            <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
              Pagamento falhou. Tente novamente.
            </div>
          )}

          {!isPaid && (
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                disabled={succeed.isPending || fail.isPending}
                onClick={() => succeed.mutate({ sessionId })}
              >
                {succeed.isPending ? "Processando…" : "Confirmar Pagamento"}
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-red-700 border-red-300 hover:bg-red-50"
                disabled={succeed.isPending || fail.isPending}
                onClick={() => fail.mutate({ sessionId })}
              >
                Falhar Pagamento
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
