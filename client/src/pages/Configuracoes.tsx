import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const WINDOW_OPTIONS = [1, 2, 3, 5, 7];

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
        <CardHeader><CardTitle>Telegram Bot Token</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <input type="password"
              className="border rounded px-3 py-2 text-sm flex-1 font-mono"
              placeholder="123456:ABC-DEF..."
              value={value("telegram_bot_token")}
              onChange={(e) => update("telegram_bot_token", e.target.value)} />
            <Button onClick={() => save("telegram_bot_token")}>Salvar</Button>
            <Button variant="outline"
              disabled={!value("telegram_bot_token") || validate.isPending}
              onClick={() => validate.mutate({ token: value("telegram_bot_token") })}
            >Validar</Button>
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
