import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBRL, formatDate, cn } from "@/lib/utils";

/**
 * Converte unix (segundos) para string aceita por <input type="datetime-local">
 * no fuso horário local do browser ("YYYY-MM-DDTHH:mm").
 */
function unixToDatetimeLocal(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

interface CardData {
  offerId: number;
  rentalId: number;
  messageId: number;
  clientName: string;
  clientPhone: string;
  boardModel: string;
  boardSize: string;
  score: number;
  precoSite: number;
  precoAmigo: number;
  endDate: number;
  initialContent: string;
}

function ApprovalCard({ data }: { data: CardData }) {
  const utils = trpc.useUtils();
  const [content, setContent] = useState(data.initialContent);
  const [scheduledFor, setScheduledFor] = useState<string>("");

  const { data: paymentDefault } = trpc.offers.getPaymentDefault.useQuery({
    rentalId: data.rentalId,
  });

  useEffect(() => {
    if (paymentDefault && !scheduledFor) {
      setScheduledFor(unixToDatetimeLocal(paymentDefault.defaultScheduledFor));
    }
  }, [paymentDefault, scheduledFor]);

  const approve = trpc.offers.approveAndSchedule.useMutation({
    onSuccess: () => {
      toast.success("Mensagem aprovada e agendada");
      utils.offers.listPendingApproval.invalidate();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const reject = trpc.offers.rejectDraft.useMutation({
    onSuccess: () => {
      toast.success("Rascunho rejeitado");
      utils.offers.listPendingApproval.invalidate();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const isHighProb = data.score >= 75;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-lg">{data.clientName}</h3>
            <span className="text-sm text-slate-500">· {data.clientPhone}</span>
          </div>
          <div className="text-sm text-slate-600">
            <span className="font-medium">{data.boardModel}</span> {data.boardSize}
            {" · "}
            {formatBRL(data.precoAmigo)} <span className="text-slate-400">(de {formatBRL(data.precoSite)})</span>
            {" · termina "}
            {formatDate(data.endDate)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block rounded px-2 py-0.5 text-xs font-semibold",
              data.score >= 75
                ? "text-emerald-700 bg-emerald-50"
                : data.score >= 50
                  ? "text-amber-700 bg-amber-50"
                  : "text-slate-600 bg-slate-100",
            )}
          >
            Score {data.score.toFixed(1)}
          </span>
          {isHighProb && (
            <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-emerald-700 bg-emerald-100">
              Alta probabilidade
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-600">Mensagem</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          className="w-full border rounded p-3 text-sm font-mono resize-vertical focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Enviar em</label>
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            onClick={() => reject.mutate({ offerId: data.offerId })}
            disabled={reject.isPending || approve.isPending}
          >
            Rejeitar
          </Button>
          <Button
            onClick={() => {
              if (!scheduledFor) {
                toast.error("Defina a data de envio");
                return;
              }
              approve.mutate({
                messageId: data.messageId,
                content,
                scheduledFor: datetimeLocalToUnix(scheduledFor),
              });
            }}
            disabled={reject.isPending || approve.isPending || !content.trim()}
          >
            Aprovar e Agendar
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ScheduledList() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.offers.listScheduled.useQuery();
  const cancel = trpc.offers.cancelScheduled.useMutation({
    onSuccess: () => {
      toast.success("Agendamento cancelado — voltou para Aprovações");
      utils.offers.listScheduled.invalidate();
      utils.offers.listPendingApproval.invalidate();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  if (isLoading) return <div className="text-slate-500">Carregando...</div>;
  if (!data || data.length === 0)
    return (
      <Card className="p-8 text-center text-slate-500">
        Nenhuma mensagem agendada no momento.
      </Card>
    );

  const formatDateTime = (unix: number) =>
    new Date(unix * 1000).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <div className="space-y-3">
      {data.map((row) => {
        const due = row.offer.scheduledFor && row.offer.scheduledFor * 1000 < Date.now();
        const noChatId = !row.client.telegramChatId;
        return (
          <Card key={row.offer.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{row.client.name}</span>
                  <span className="text-sm text-slate-500">· {row.client.phone}</span>
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  {row.board.model} {row.board.size}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Enviar em <span className="font-mono">{row.offer.scheduledFor ? formatDateTime(row.offer.scheduledFor) : "—"}</span>
                  {due && <span className="ml-2 text-amber-600 font-medium">⏰ horário já passou</span>}
                  {noChatId && (
                    <span className="ml-2 text-red-600 font-medium">⚠️ cliente sem chat_id Telegram</span>
                  )}
                </div>
                {row.lastMessage && (
                  <div className="mt-3 p-3 bg-slate-50 border rounded text-xs whitespace-pre-wrap font-mono text-slate-700">
                    {row.lastMessage.content}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Cancelar este agendamento? A mensagem volta para Aprovações."))
                    cancel.mutate({ offerId: row.offer.id });
                }}
                disabled={cancel.isPending}
              >
                Cancelar agendamento
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function PendingList() {
  const { data, isLoading } = trpc.offers.listPendingApproval.useQuery();

  if (isLoading) return <div className="text-slate-500">Carregando...</div>;
  if (!data || data.length === 0)
    return (
      <Card className="p-8 text-center text-slate-500">
        Nenhuma mensagem aguardando aprovação.
      </Card>
    );

  return (
    <div className="space-y-4">
      {data.map((row) => {
        if (!row.lastMessage) return null;
        return (
          <ApprovalCard
            key={row.offer.id}
            data={{
              offerId: row.offer.id,
              rentalId: row.rental.id,
              messageId: row.lastMessage.id,
              clientName: row.client.name,
              clientPhone: row.client.phone,
              boardModel: row.board.model,
              boardSize: row.board.size,
              score: row.offer.score,
              precoSite: row.board.precoSite,
              precoAmigo: row.board.precoAmigo,
              endDate: row.rental.endDate,
              initialContent: row.lastMessage.content,
            }}
          />
        );
      })}
    </div>
  );
}

export function Aprovacoes() {
  const [tab, setTab] = useState<"pending" | "scheduled">("pending");
  const pendingQ = trpc.offers.listPendingApproval.useQuery();
  const scheduledQ = trpc.offers.listScheduled.useQuery();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Aprovações</h1>
        <p className="text-slate-500 text-sm mt-1">
          Mensagens geradas pelo bot aguardando revisão humana antes do envio.
        </p>
      </div>

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("pending")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
            tab === "pending"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-900",
          )}
        >
          Aguardando aprovação ({pendingQ.data?.length ?? 0})
        </button>
        <button
          onClick={() => setTab("scheduled")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition",
            tab === "scheduled"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-900",
          )}
        >
          Agendadas ({scheduledQ.data?.length ?? 0})
        </button>
      </div>

      {tab === "pending" ? <PendingList /> : <ScheduledList />}
    </div>
  );
}
