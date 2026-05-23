# Surfsup Conversão

Funil de conversão de aluguéis em vendas para a **Surfsup** — clube brasileiro de aluguel de pranchas com 80+ pontos de retirada.

> **Ideia central.** O cliente já está há dias surfando uma prancha alugada. Dois dias antes de devolver, ele recebe uma mensagem no Telegram: *"essa prancha pode ser sua por R$ X — paga aqui e ela é sua, sem precisar inspecionar, retirar ou viajar"*. Se quiser, paga e a prancha é dele. Se não, devolve normal.

Este app gerencia esse funil: importa aluguéis ativos, scora cada par (cliente × prancha) por probabilidade de conversão, redige a oferta com LLM, o operador aprova/agenda, dispara via Telegram, classifica a resposta, gera link de pagamento (Stripe stub), efetua a venda e notifica a Surfsup.

---

## Stack

- **Frontend**: Vite + React 19 + TypeScript + TailwindCSS 4 + shadcn/ui (Button, Card)
- **Backend**: Express + tRPC 11 + Zod
- **Banco**: Drizzle ORM + SQLite (arquivo: `./data/surfsup.db`)
- **Jobs**: `node-cron` (dispatcher, expirer, rental sweeper)
- **Integrações**: Telegram Bot API (axios), OpenAI SDK (LLM com fallback offline), Stripe stub
- **Tooling**: pnpm, Vitest, tsx, drizzle-kit

---

## Setup

```bash
pnpm install
cp .env.example .env       # preencha OPENAI_API_KEY e (opcional) TELEGRAM_BOT_TOKEN
pnpm db:migrate            # aplica drizzle/0000_initial.sql em data/surfsup.db
pnpm dev                   # client em :5173, server em :3000
```

### Variáveis de ambiente úteis

| Var | Default | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do Express |
| `DATABASE_URL` | `./data/surfsup.db` | Caminho do SQLite |
| `OPENAI_API_KEY` | — | Se ausente OU placeholder, LLM cai automaticamente em modo offline (template determinístico) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo das chamadas |
| `LLM_OFFLINE_FALLBACK_MODE` | — | Force `1` para usar fallback offline mesmo com key |
| `TELEGRAM_BOT_TOKEN` | (no banco) | Pode vir do `.env` mas a fonte de verdade é `settings.telegram_bot_token` |
| `TELEGRAM_DRY_RUN` | — | `1` = não envia mensagens reais, só loga (usado em testes) |
| `SURFSUP_DISABLE_CRON` | — | `1` = não inicia jobs (usado em scripts/testes) |

---

## Fluxo de uso (operador)

Veja `OPERATOR_GUIDE.md` para o passo a passo não-técnico. Resumo:

1. `/importar` — sobe planilha (`templates/surfsup-conversion-template.xlsx` é o gabarito)
2. `/alugueis` — vê scores, clica **Gerar mensagem** nos pares promissores
3. `/aprovacoes` — edita o rascunho da mensagem, agenda envio
4. Cron dispara via Telegram no horário marcado
5. Cliente responde → webhook classifica → `/conversas` mostra a thread
6. Se aceitou → operador gera link → cliente paga em `/pay/[sessionId]`
7. `/vendas` consolida vendas efetivas e funil

---

## Estrutura

```
client/                            # Vite + React
  src/
    App.tsx                        # rotas + sidebar (pay/* é standalone)
    pages/                         # Dashboard, Alugueis, Aprovacoes, Conversas,
                                   # Vendas, Clientes, Importar, Configuracoes, Pay
    components/ui/                 # button, card (shadcn-style)
    lib/{trpc,utils}.ts            # trpc client + formatBRL/formatDate/cn
server/
  index.ts                         # Express + tRPC + webhooks + cron
  router.ts                        # appRouter (registro de todos os routers)
  trpc.ts                          # init + context
  db/
    schema.ts                      # 8 tabelas + clientBoardStats
    index.ts                       # singleton drizzle + better-sqlite3
    migrate.ts                     # aplica drizzle/*.sql idempotente
  lib/
    clientCooldown.ts              # cooldown universal (90d default)
    scoring.ts                     # Conversion Score 0–100
    csvImport.ts                   # parsing XLSX/CSV
    import.ts                      # upsert + recompute + rescore
    llm.ts                         # OpenAI + fallback offline + intent classifier
    telegram.ts                    # sendMessage / getMe (dry-run aware)
    stripeStub.ts                  # createPaymentLink / markPaid / markFailed
    notifySurfsup.ts               # log + sales.surfsupNotifiedAt
  routers/                         # tRPC routers (factories aceitam db injetado)
    import.ts | rentals.ts | offers.ts | dashboard.ts | sales.ts |
    payments.ts | conversations.ts | clientsLog.ts | settings.ts |
    telegramWebhook.ts             # Express handler — webhook do Telegram
  integrations/
    surfsupSync.ts                 # stub do webhook futuro Surfsup → app
  jobs/
    dispatcher.ts                  # envia messages Scheduled (1min)
    expirer.ts                     # marca Expired + aplica cooldown (1min)
    rentalStatusSweeper.ts         # Active → Overdue após endDate (5min)
shared/constants.ts                # enums (OFFER_STATUS, RENTAL_STATUS, ...)
drizzle/
  0000_initial.sql                 # schema + defaults de settings
templates/
  surfsup-conversion-template.xlsx # gabarito com 5 linhas exemplares
```

---

## Domínio em 60 segundos

- **`clients`**: pessoa física. `cooldown_until/reason` controla quando *não* podemos ofertar.
- **`boards`**: unidade física. `precoSite` (varejo) / `precoAmigo` (oferta interna) / `precoMinimo` (chão).
- **`rentals`**: aluguel atual ou passado.
- **`conversion_offers`**: máquina de estado da oferta para um aluguel — `NoOffer → Draft → PendingApproval → Scheduled → Sent → Accepted | Rejected | Expired → Paid`.
- **`messages`**: mensagens trocadas (operador ou cliente, via Telegram). `responseType` classifica o intent.
- **`sales`**: efetivada quando `payments.succeed` corre. Atualiza `rental.status=ConvertedToSale` e `board.status=Vendida`.
- **`client_board_stats`**: denormalização para scoring rápido.

---

## Scoring (resumo)

```
score(client, board) =
   40 * normalize(rentalsOfThisBoard, cap=10)
 + 25 * normalize(daysOfThisBoard,    cap=60)
 + 15 * normalize(totalRentals,       cap=30)
 + 10 * recencyScore(lastRentalAt)    # 1 em <=30d, 0 em >=180d
 + 10 * matchAffinity(boardType, history)

Se cliente em cooldown → score = -1 (oferta bloqueada)
```

Detalhes da matchAffinity, recencyScore e edge cases em `server/lib/scoring.ts` e `server/lib/scoring.test.ts`.

---

## Cooldown

Cliente entra em cooldown (default **90 dias**) quando:
- **`rejected`** — respondeu "não quero" (intent `not_interested` no webhook)
- **`no_response`** — `Sent` expirou sem resposta (expirer job)
- **`accepted_unpaid`** — aceitou mas não pagou até o fim do rental

Em cooldown: nenhuma oferta nova é gerada; o bot pode responder em modo consultoria.

---

## Testes

```bash
pnpm test          # 87 testes (16 arquivos), todos verdes
pnpm check         # tsc --noEmit no client e server
pnpm build         # vite build (client) + tsc (server)
```

Suítes:
- `clientCooldown.test.ts`, `scoring.test.ts` — lógica pura
- `csvImport.test.ts`, `import.test.ts` — parsing + upsert idempotente
- `llm.test.ts` — fallback offline + classificador de intent
- `rentals.test.ts`, `offers.test.ts`, `sales.test.ts`, `payments.test.ts`, `conversations.test.ts`, `clientsLog.test.ts` — routers
- `dispatcher.test.ts`, `expirer.test.ts` — jobs
- `telegramWebhook.test.ts` — handler de webhook
- `notifySurfsup.test.ts`, `surfsupSync.test.ts` — integrações
- `__tests__/e2eHappyPath.test.ts` — fluxo completo import → KPI

> **Por que vitest no E2E (não Playwright):** o E2E hermético em vitest com DB :memory: protege exatamente o mesmo caminho (import → generateMessage → webhook intent → createForOffer → succeed → KPIs), em ~30ms, sem precisar instalar browsers nem rodar dev server. Para validar UI especificamente, faça smoke manual com `pnpm dev`.

---

## Endpoints HTTP (além do tRPC em `/trpc`)

| Método | Path | Para que |
|---|---|---|
| GET | `/api/health` | health check |
| POST | `/api/integrations/telegram/webhook` | recebe replies do Telegram |
| POST | `/api/integrations/surfsup/sync` | **stub** — endpoint futuro para Surfsup push |

---

## Out of scope (intencional)

- Stripe real (stub apenas — interface pronta para swap)
- Email real (apenas log + `sales.surfsupNotifiedAt`)
- Auth (single-user)
- Multi-tenant
- Mobile responsive polish (foco em desktop)
- Sync real Surfsup → app (endpoint stub recebe e registra)

---

## Repo

https://github.com/MrBraun92/surfsup-conversion
