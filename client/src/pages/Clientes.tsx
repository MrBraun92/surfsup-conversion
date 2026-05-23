import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";

type Filter = "all" | "cooldown" | "has_offer" | "paid";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "cooldown", label: "Em cooldown" },
  { key: "has_offer", label: "Com oferta ativa" },
  { key: "paid", label: "Compraram" },
];

export function Clientes() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const q = trpc.clientsLog.listQualified.useQuery({
    search: search.trim() || undefined,
    filter,
  });

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-slate-500 text-sm mt-1">
          Log de clientes qualificados (com pelo menos 1 aluguel).
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="text"
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-2 text-sm flex-1 max-w-md"
        />
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border",
                filter === f.key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Telefone</th>
              <th className="text-right px-3 py-2">Aluguéis</th>
              <th className="text-right px-3 py-2">Dias totais</th>
              <th className="text-left px-3 py-2">Cooldown</th>
              <th className="text-left px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Carregando…
                </td>
              </tr>
            )}
            {!q.isLoading && (q.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
            {(q.data ?? []).map((row) => (
              <tr
                key={row.client.id}
                onClick={() => setSelectedId(row.client.id)}
                className="border-b hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-3 py-2 font-medium">{row.client.name}</td>
                <td className="px-3 py-2 text-xs">{row.client.phone}</td>
                <td className="px-3 py-2 text-right font-mono">{row.totalRentals}</td>
                <td className="px-3 py-2 text-right font-mono">{row.totalDaysRented}</td>
                <td className="px-3 py-2 text-xs">
                  {row.cooldown.inCooldown ? (
                    <span className="text-amber-700">
                      Sim · {row.cooldown.daysRemaining}d
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(row.client.id);
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    Ver detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId !== null && (
        <ClientDrawer
          clientId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ClientDrawer({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.clientsLog.getClientDetail.useQuery({ clientId });
  const data = q.data;
  const boardMap = new Map((data?.boards ?? []).map((b: any) => [b.id, b]));

  const [chatIdInput, setChatIdInput] = useState<string>("");
  useEffect(() => {
    if (data?.client) setChatIdInput(data.client.telegramChatId ?? "");
  }, [data?.client]);

  const setChatId = trpc.clientsLog.setTelegramChatId.useMutation({
    onSuccess: () => {
      toast.success("Chat ID salvo");
      utils.clientsLog.getClientDetail.invalidate({ clientId });
      utils.clientsLog.listQualified.invalidate();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl z-50 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h2 className="text-xl font-bold">{data?.client.name ?? "…"}</h2>
              <div className="text-xs text-slate-500 mt-1">
                {data?.client.phone}
                {data?.client.email ? ` · ${data.client.email}` : ""}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {q.isLoading && <div className="text-slate-400">Carregando…</div>}

          {data && (
            <>
              <section className="bg-blue-50 border border-blue-200 rounded p-3">
                <h3 className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-2">
                  Telegram chat_id
                </h3>
                <p className="text-xs text-slate-600 mb-2">
                  ID do chat do cliente com o bot. Sem isso, nenhuma mensagem é enviada.
                  Veja em <a href="/configuracoes" className="underline">Configurações → Buscar chats recentes</a>.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="ex: 1234567890"
                    value={chatIdInput}
                    onChange={(e) => setChatIdInput(e.target.value)}
                    className="border rounded px-3 py-1.5 text-sm font-mono flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={setChatId.isPending || chatIdInput === (data.client.telegramChatId ?? "")}
                    onClick={() =>
                      setChatId.mutate({
                        clientId,
                        telegramChatId: chatIdInput.trim() || null,
                      })
                    }
                  >
                    Salvar
                  </Button>
                </div>
              </section>
              <section>
                <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Cooldown
                </h3>
                {data.cooldown.inCooldown ? (
                  <div className="text-sm">
                    <span className="text-amber-700 font-semibold">Em cooldown</span> ·{" "}
                    {data.cooldown.daysRemaining}d restantes · motivo: {data.cooldown.reason ?? "—"}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Sem cooldown ativo.</div>
                )}
              </section>

              <section>
                <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Histórico de aluguéis ({data.rentals.length})
                </h3>
                <table className="w-full text-xs border">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-2 py-1">Prancha</th>
                      <th className="text-left px-2 py-1">Início</th>
                      <th className="text-left px-2 py-1">Fim</th>
                      <th className="text-left px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rentals.map((r: any) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-2 py-1">
                          {(boardMap.get(r.boardId) as any)?.model ?? `Board ${r.boardId}`}
                        </td>
                        <td className="px-2 py-1">{formatDate(r.startDate)}</td>
                        <td className="px-2 py-1">{formatDate(r.endDate)}</td>
                        <td className="px-2 py-1">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Ofertas ({data.offers.length})
                </h3>
                {data.offers.length === 0 ? (
                  <div className="text-sm text-slate-500">Sem ofertas.</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {data.offers.map((o: any) => (
                      <li key={o.id} className="border rounded px-2 py-1">
                        <span className="font-semibold">{o.status}</span> ·{" "}
                        score {o.score} · prancha{" "}
                        {(boardMap.get(o.boardId) as any)?.model ?? o.boardId}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {data.sales.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                    Vendas ({data.sales.length})
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {data.sales.map((s: any) => (
                      <li key={s.id} className="border rounded px-2 py-1">
                        <span className="font-semibold">{s.paymentStatus}</span> · R${" "}
                        {s.salePrice} · pago em {formatDate(s.paidAt)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
