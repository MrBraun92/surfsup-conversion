# Surfsup Conversão

Funil de conversão de aluguéis em vendas para a Surfsup (clube brasileiro de aluguel de pranchas).

## Stack

- Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui
- Express + tRPC 11 + Zod
- Drizzle ORM + SQLite (`./data/surfsup.db`)
- node-cron, OpenAI SDK, Telegram Bot API, Stripe (stub)

## Setup

```bash
pnpm install
cp .env.example .env   # preencher OPENAI_API_KEY e TELEGRAM_BOT_TOKEN
pnpm db:migrate
pnpm dev
```

Frontend em `http://localhost:5173`, backend em `http://localhost:3000`.

## Fluxo

1. `/importar` — sobe planilha de aluguéis ativos
2. `/alugueis` — vê scores e dispara "Gerar Mensagem"
3. `/aprovacoes` — operador edita/agenda
4. Cron dispara via Telegram no horário marcado
5. Cliente responde → `/conversas` → link Stripe (stub) → `/vendas`

Veja `OPERATOR_GUIDE.md` para o passo a passo não-técnico.
