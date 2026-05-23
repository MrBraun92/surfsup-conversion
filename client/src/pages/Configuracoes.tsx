import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const WINDOW_OPTIONS = [1, 2, 3, 5, 7];

function DiscoverChatsButton() {
  const [chats, setChats] = useState<
    | null
    | Array<{
        chatId: string;
        firstName: string;
        lastName?: string;
        username?: string;
        lastMessage: string;
        lastMessageAt: number;
      }>
  >(null);
  const m = trpc.settings.discoverTelegramChats.useMutation({
    onSuccess: (r) => {
      setChats(r.chats);
      if (r.chats.length === 0) toast.info("Nenhum chat encontrado ainda. Mande /start pro bot e tente de novo.");
      else toast.success(`${r.chats.length} chat(s) encontrado(s)`);
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });
  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? "Buscando…" : "Buscar chats recentes do bot"}
      </Button>
      {chats && chats.length > 0 && (
        <div className="border rounded overflow-hidden text-sm mt-2">
          <table className="w-full">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Pessoa</th>
                <th className="text-left px-3 py-2">Chat ID</th>
                <th className="text-left px-3 py-2">Última msg</th>
              </tr>
            </thead>
            <tbody>
              {chats.map((c) => (
                <tr key={c.chatId} className="border-t">
                  <td className="px-3 py-2">
                    {c.firstName} {c.lastName ?? ""}
                    {c.username && <span className="text-xs text-slate-400 ml-1">@{c.username}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(c.chatId);
                        toast.success(`Copiado: ${c.chatId}`);
                      }}
                      className="text-blue-600 hover:underline"
                      title="Copiar"
                    >
                      {c.chatId}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-xs">
                    {c.lastMessage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Configuracoes() {
  const q = trpc.settings.getAll.useQuery();
  const utils = trpc.useUtils();
  const set = trpc.settings.set.useMutation({
    onSuccess: () => {
      toast.success("Salvo");
      utils.settings.getAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const validate = trpc.settings.validateTelegram.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(`Bot OK: @${r.username ?? "?"}`);
      else toast.error("Token inválido");
    },
    onError: (e) => toast.error("Falha: " + e.message),
  });
  const validateChatId = trpc.settings.validateTestChatId.useMutation({
    onSuccess: () => toast.success("Mensagem de teste enviada — veja seu Telegram"),
    onError: (e) => toast.error(e.message),
  });

  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setLocal((cur) => ({ ...q.data, ...cur }));
  }, [q.data]);

  const value = (k: string) => local[k] ?? "";
  const update = (k: string, v: string) => setLocal((s) => ({ ...s, [k]: v }));
  const save = (k: string) => set.mutate({ key: k as any, value: value(k) });

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold">Configurações</h1>
      </header>

      <Card>
        <CardHeader><CardTitle>Janela de oferta</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <select
            className="border rounded px-3 py-2 text-sm"
            value={value("offer_window_days")}
            onChange={(e) => update("offer_window_days", e.target.value)}
          >
            {WINDOW_OPTIONS.map((d) => <option key={d} value={String(d)}>{d} dia{d > 1 ? "s" : ""}</option>)}
          </select>
          <Button onClick={() => save("offer_window_days")}>Salvar</Button>
          <span className="text-xs text-slate-500">Quantos dias antes do fim do aluguel a mensagem é enviada por padrão.</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cooldown</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <input type="number" min={1} max={365}
            className="border rounded px-3 py-2 text-sm w-24"
            value={value("cooldown_days")}
            onChange={(e) => update("cooldown_days", e.target.value)} />
          <Button onClick={() => save("cooldown_days")}>Salvar</Button>
          <span className="text-xs text-slate-500">Dias de cooldown após recusa, não-resposta ou aceite-não-pago.</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Score mínimo para liberar &quot;Gerar Mensagem&quot;</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <input type="number" min={0} max={100} step={1}
            className="border rounded px-3 py-2 text-sm w-24"
            value={value("min_score_to_generate")}
            onChange={(e) => update("min_score_to_generate", e.target.value)} />
          <Button onClick={() => save("min_score_to_generate")}>Salvar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Telegram Bot</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-slate-600 font-medium">Bot Token (do BotFather)</label>
            <div className="flex gap-2 mt-1">
              <input type="password"
                className="border rounded px-3 py-2 text-sm flex-1 font-mono"
                placeholder="123456789:ABC-DEF..."
                value={value("telegram_bot_token")}
                onChange={(e) => update("telegram_bot_token", e.target.value)} />
              <Button onClick={() => save("telegram_bot_token")}>Salvar</Button>
              <Button variant="outline"
                disabled={!value("telegram_bot_token") || validate.isPending}
                onClick={() => validate.mutate({ token: value("telegram_bot_token") })}
              >Validar</Button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              O token contém o Bot ID embutido — não precisa configurar mais nada do lado do bot.
            </p>
          </div>

          <div className="border-t pt-3">
            <label className="text-xs text-slate-600 font-medium">
              Chat ID de teste (fallback global)
            </label>
            <p className="text-xs text-slate-500 mt-1 mb-2">
              Para testes: todas as mensagens vão para este chat_id quando o cliente não tem um próprio.
              Para obter, mande <code className="bg-slate-100 px-1 rounded">/start</code> ao bot pelo seu Telegram
              e use o botão abaixo para descobrir, OU pegue manualmente via{" "}
              <code className="bg-slate-100 px-1 rounded">api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.
            </p>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                inputMode="numeric"
                className="border rounded px-3 py-2 text-sm flex-1 font-mono"
                placeholder="ex: 1234567890"
                value={value("telegram_test_chat_id")}
                onChange={(e) => update("telegram_test_chat_id", e.target.value)}
              />
              <Button onClick={() => save("telegram_test_chat_id")}>Salvar</Button>
              <Button
                variant="outline"
                disabled={
                  !value("telegram_test_chat_id") ||
                  !value("telegram_bot_token") ||
                  validateChatId.isPending
                }
                onClick={() =>
                  validateChatId.mutate({ chatId: value("telegram_test_chat_id") })
                }
              >
                Validar
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              "Validar" envia uma mensagem de teste real ao chat informado.
            </p>
          </div>

          <div className="border-t pt-3">
            <label className="text-xs text-slate-600 font-medium">Descobrir chats ativos</label>
            <p className="text-xs text-slate-500 mt-1 mb-2">
              Lista quem mandou mensagem ao bot recentemente (via{" "}
              <code className="bg-slate-100 px-1 rounded">getUpdates</code>).
              Clique no <code className="bg-slate-100 px-1 rounded">chat_id</code> para copiar.
            </p>
            <DiscoverChatsButton />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stripe</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <select className="border rounded px-3 py-2 text-sm"
            value={value("stripe_mode")}
            onChange={(e) => update("stripe_mode", e.target.value)}>
            <option value="stub">stub (mock interno)</option>
            <option value="test">test (Stripe sandbox)</option>
            <option value="live">live (produção)</option>
          </select>
          <Button onClick={() => save("stripe_mode")}>Salvar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Email para notificar Surfsup</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <input type="email"
            className="border rounded px-3 py-2 text-sm flex-1"
            placeholder="ops@surfsup.com.br"
            value={value("surfsup_notify_email")}
            onChange={(e) => update("surfsup_notify_email", e.target.value)} />
          <Button onClick={() => save("surfsup_notify_email")}>Salvar</Button>
        </CardContent>
      </Card>
    </div>
  );
}
