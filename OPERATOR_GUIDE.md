# Guia do Operador — Surfsup Conversão

Versão não-técnica. Se você é a pessoa que vai usar o app no dia a dia, este guia é pra você.

---

## O que esse app faz

Transforma aluguéis ativos em vendas. Cliente que está há dias surfando uma prancha do nosso estoque pode receber uma oferta para **ficar com aquela exata prancha** — sem precisar inspecionar, retirar ou viajar. Paga o link, e a prancha é dele. Se não quiser, devolve normalmente.

---

## Primeiro acesso

1. Abra `http://localhost:5173` (ou onde o app estiver rodando).
2. Vá em **Configurações** (canto inferior esquerdo).
3. Preencha:
   - **Janela de oferta**: quantos dias antes do fim do aluguel a mensagem é enviada. Default `2`.
   - **Cooldown**: quantos dias o cliente fica "intocável" se rejeitar / não responder / não pagar. Default `90`.
   - **Score mínimo**: abaixo desse score, o botão "Gerar mensagem" fica desabilitado. Default `50`.
   - **Telegram Bot Token**: cole o token do bot. Clique **Validar** — deve aparecer "Bot OK: @nome_do_bot".
   - **Stripe**: deixe em `stub` por enquanto (modo simulado).
   - **Email para notificar Surfsup**: quando uma venda fechar, vamos *(no futuro)* mandar email pra esse endereço.

---

## Fluxo do dia

### 1. Importar dados

Toda manhã (ou conforme combinado), o pessoal da Surfsup vai te mandar uma planilha (.xlsx) com os aluguéis ativos. Você sobe ela em:

**Importar** → arraste o arquivo → veja o preview das primeiras 5 linhas → clique **Processar**.

O sistema é idempotente: pode subir a mesma planilha duas vezes que nada quebra. Vai aparecer um cartão com:

- Quantos clientes/pranchas novos vs atualizados
- Quantos aluguéis foram inseridos vs ignorados (já existiam)
- Avisos (ex: telefone normalizado de `11955554444` para `+5511955554444`)
- Erros (linha por linha — geralmente data fora de formato ou coluna obrigatória vazia)

**Colunas obrigatórias na planilha** (use `templates/surfsup-conversion-template.xlsx` como gabarito):

`board_id, modelo, tamanho, preco_site, preco_amigo, client_id, nome, telefone, data_inicio, data_fim`

Colunas opcionais: `marca, litros, tipo, preco_minimo, status_prancha, devolucao_real, email`.

### 2. Olhar quem está pronto pra oferta

Vá em **Aluguéis**. Filtre por:

- **Acabando em 2d** — esses são os candidatos do dia.
- **Acabando em 5d/7d** — janela maior.

Cada linha mostra **Score** (0 a 100):

- 🟢 verde (≥75): alta chance — quase certeza de aceite
- 🟡 amarelo (50–74): probabilidade média
- ⬜ cinza (<50): pouca chance — botão "Gerar mensagem" fica desabilitado
- — (cinza neutro): cliente em **cooldown** (não dá pra ofertar)

Para os promissores, clique **Gerar mensagem**.

### 3. Aprovar a mensagem

O sistema redige um rascunho usando o nome do cliente, o modelo da prancha, há quantos dias ele está com ela e o preço. Vá em **Aprovações**:

- Cada card tem o rascunho num campo editável (você pode ajustar o tom, adicionar emoji, etc).
- Tem um seletor de **data e hora** para agendar o envio. Default = `endDate - 2 dias`, às 9h.
- Clique **Aprovar e Agendar**. A mensagem entra na fila do cron, que envia no horário marcado.
- Ou **Rejeitar** se a mensagem não fizer sentido — volta o estado para `NoOffer` (não impacta cooldown).

### 4. Acompanhar respostas

Quando o cliente responder no Telegram, a resposta aparece em **Conversas** (aba Ativas). O sistema classifica automaticamente:

- **Aceitou** ("quero", "sim", "aceito") → status muda pra `Accepted`, notificação cria toast
- **Recusou** ("não", "não quero") → status `Rejected`, cooldown de 90 dias aplicado
- **Pergunta** ("quanto?", "tem como entregar?", etc) → status fica como está, você responde manualmente pelo card

Você pode digitar respostas suas direto no card — vão pelo Telegram em tempo real, com flag `operatorTookOver`.

### 5. Receber o pagamento

Quando o cliente aceitou:

1. Em **Aluguéis** ou **Conversas**, gere o link Stripe (modo stub gera um link interno `/pay/abc123`).
2. Cole o link na conversa do Telegram.
3. O cliente abre — vê a prancha, valor, dois botões: **Confirmar Pagamento** / **Falhar Pagamento** (no stub é manual; em prod real o Stripe assume).
4. **Confirmou** → sistema marca a venda como paga, atualiza a prancha pra `Vendida`, o aluguel pra `ConvertedToSale`, e dispara notificação pra Surfsup.

### 6. Ver resultado

**Vendas** tem duas abas:

- **Efetivas** — todas as vendas pagas. KPIs no topo: total vendido, ticket médio, taxa de conversão, vendas no mês.
- **Recusadas / Ignoradas** — quem disse não, quem não respondeu, quem aceitou e não pagou. Mostra também quantos cooldowns foram aplicados.

### 7. Dashboard

A página inicial mostra resumo do dia: aluguéis ativos, quantos estão na janela de oferta, conversões e receita do mês. Embaixo, **Próximas conversões** lista os 10 pares com maior score elegíveis (não em cooldown). Você pode disparar "Gerar mensagem" direto de lá.

### 8. Log de Clientes

**Clientes** lista todos que já alugaram (qualificados). Filtros: Em cooldown / Com oferta ativa / Compraram. Clique numa linha para ver o histórico completo: aluguéis, ofertas, vendas.

---

## O que NÃO fazer

- **Não force "Gerar mensagem" em cliente em cooldown.** O sistema bloqueia, mas se você forçar via API direta vai poluir o funil.
- **Não rode o `pnpm db:migrate` em produção sem revisar.** As migrations vivem em `drizzle/`.
- **Não delete o `data/surfsup.db`** se já tiver vendas registradas — backup primeiro.

---

## Quando algo deu errado

| Sintoma | O que provavelmente é | Como verificar |
|---|---|---|
| Mensagem não saiu no horário agendado | Cron desligado ou token Telegram errado | Veja os logs do server (`pnpm dev` mostra `[cron] enabled` no boot). Vá em Configurações → Validar token. |
| Cliente respondeu mas não atualizou status | Webhook do Telegram não chegou no servidor | Veja se a URL pública do webhook está apontando pra `https://seu-dominio/api/integrations/telegram/webhook`. Se rodando local, precisa de ngrok ou similar. |
| Score apareceu como `-1` | Cliente em cooldown | Vá em Clientes, abra o cliente, veja "Cooldown até" — espere passar ou ajuste manualmente no DB |
| Importação falhou com "header errors" | Planilha sem coluna obrigatória | Compare com `templates/surfsup-conversion-template.xlsx` |
| KPI de receita está zerado | Nenhuma venda paga este mês ainda | Confirme em Vendas → Efetivas |

---

## Em caso de dúvida

Fale com a pessoa que instalou o sistema. Ou abra o README.md para a parte técnica.

🏄 Boas vendas.
