import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, cn } from "@/lib/utils";

type Tab = "ativas" | "expiradas";

const STATUS_COLORS: Record<string, string> = {
  Sent: "bg-blue-100 text-blue-800 border-blue-200",
  Accepted: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Expired: "bg-slate-100 text-slate-700 border-slate-200",
  Rejected: "bg-rose-100 text-rose-800 border-rose-200",
  Paid: "bg-violet-100 text-violet-800 border-violet-200",
};

function formatDateTime(unix: number | Date | null | undefined): string {
  if (!unix) return "—";
  const ms = unix instanceof Date ? unix.getTime() : unix * 1000;
  return new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function Conversas() {
  const [tab, setTab] = useState<Tab>("ativas");
  const q = trpc.conversations.listOffers.useQuery({ tab });

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Conversas</h1>
        <p className="text-slate-500 text-sm mt-1">
          Acompanhe e responda mensagens com os clientes.
        </p>
      </header>

      <div className="flex gap-2">
        {(["ativas", "expiradas"] as const).map((t) => (
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
            {t === "ativas" ? "Ativas" : "Expiradas / Finalizadas"}
          </button>
        ))}
      </div>

      {q.isLoading && <div className="text-slate-400">Carregando…</div>}
      {!q.isLoading && (q.data ?? []).length === 0 && (
        <div className="text-slate-500 text-sm">Nenhuma conversa nesta aba.</div>
      )}

      <div className="space-y-4">
        {(q.data ?? []).map((row) => (
          <ConversationCard
            key={row.offer.id}
            offerId={row.offer.id}
            clientName={row.client.name}
            boardModel={row.board.model}
            boardSize={row.board.size}
            status={row.offer.status}
            messages={row.messages}
            canReply={tab === "ativas"}
            onSent={() => q.refetch()}
          />
        ))}
      </div>
    </div>
  );
}

interface MessageRow {
  id: number;
  content: string;
  response?: string | null;
  responseAt?: number | null;
  sentAt?: number | null;
  createdAt: Date | number;
  operatorTookOver: number;
}

function ConversationCard({
  offerId,
  clientName,
  boardModel,
  boardSize,
  status,
  messages,
  canReply,
  onSent,
}: {
  offerId: number;
  clientName: string;
  boardModel: string;
  boardSize: string;
  status: string;
  messages: MessageRow[];
  canReply: boolean;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const sendMut = trpc.conversations.sendOperatorMessage.useMutation({
    onSuccess: () => {
      setDraft("");
      toast.success("Mensagem enviada.");
      onSent();
    },
    onError: (e) => toast.error("Erro ao enviar: " + e.message),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between border-b pb-2">
        <div>
          <div className="font-semibold">{clientName}</div>
          <div className="text-xs text-slate-500">
            {boardModel} · {boardSize}
          </div>
        </div>
        <span
          className={cn(
            "px-2 py-1 rounded text-xs font-medium border",
            STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700 border-slate-200",
          )}
        >
          {status}
        </span>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-slate-400 text-sm italic">Sem mensagens.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-1">
            {m.content && (
              <div className="flex">
                <div className="max-w-[75%] bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm">
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {m.operatorTookOver ? "Operador" : "Bot"} ·{" "}
                    {formatDateTime(m.sentAt ?? m.createdAt)}
                  </div>
                </div>
              </div>
            )}
            {m.response && (
              <div className="flex justify-end">
                <div className="max-w-[75%] bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <div className="whitespace-pre-wrap">{m.response}</div>
                  <div className="text-[10px] text-slate-500 mt-1 text-right">
                    Cliente · {formatDateTime(m.responseAt ?? null)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {canReply && (
        <div className="flex gap-2 pt-2 border-t">
          <input
            type="text"
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Digite uma resposta…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sendMut.isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                sendMut.mutate({ offerId, content: draft.trim() });
              }
            }}
          />
          <Button
            disabled={!draft.trim() || sendMut.isPending}
            onClick={() => sendMut.mutate({ offerId, content: draft.trim() })}
          >
            Enviar
          </Button>
        </div>
      )}
      {!canReply && (
        <div className="pt-2 border-t text-xs text-slate-500">
          Conversa encerrada — envio desabilitado.
        </div>
      )}
    </Card>
  );
}

// hint: usar formatDate em footers se necessário (mantido para compat futuro)
void formatDate;
