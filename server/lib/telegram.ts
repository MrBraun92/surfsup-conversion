/**
 * telegram.ts — wrapper minimal sobre Telegram Bot API.
 *
 * Modo dry-run: se TELEGRAM_DRY_RUN === '1', não chama HTTP, apenas loga.
 * Retorna { messageId: -1 } em dry-run.
 */
import axios from "axios";

export interface SendMessageInput {
  chatId: string;
  text: string;
  token: string;
}

export async function sendMessage(input: SendMessageInput): Promise<{ messageId: number }> {
  if (process.env.TELEGRAM_DRY_RUN === "1") {
    // eslint-disable-next-line no-console
    console.log("[telegram dry-run]", input.chatId, input.text);
    return { messageId: -1 };
  }
  const url = `https://api.telegram.org/bot${input.token}/sendMessage`;
  const response = await axios.post(url, {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: "HTML",
  });
  const messageId = response.data?.result?.message_id;
  if (typeof messageId !== "number") {
    throw new Error("Telegram não retornou message_id válido");
  }
  return { messageId };
}

export async function getMe(token: string): Promise<{ ok: boolean; username?: string }> {
  if (process.env.TELEGRAM_DRY_RUN === "1") {
    return { ok: true, username: "dryrun_bot" };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/getMe`;
    const response = await axios.get(url);
    if (response.data?.ok) {
      return { ok: true, username: response.data.result?.username };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface DiscoveredChat {
  chatId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  lastMessage: string;
  lastMessageAt: number; // unix seconds
}

/**
 * getUpdates — busca os últimos updates do bot e extrai chats únicos.
 * Útil para o operador descobrir chat_ids de pessoas que mandaram /start no bot.
 *
 * IMPORTANTE: este método é INCOMPATÍVEL com setWebhook ativo. Se o bot tiver webhook
 * configurado, getUpdates retorna 409 Conflict. Em prod com webhook, capture os chat_ids
 * via o handler do webhook em vez disso.
 */
export async function discoverChats(token: string): Promise<DiscoveredChat[]> {
  if (process.env.TELEGRAM_DRY_RUN === "1") {
    return [
      {
        chatId: "999",
        firstName: "Dry",
        lastName: "Run",
        username: "dryrun",
        lastMessage: "/start",
        lastMessageAt: Math.floor(Date.now() / 1000),
      },
    ];
  }
  const url = `https://api.telegram.org/bot${token}/getUpdates?limit=100`;
  const response = await axios.get(url, { timeout: 10_000 });
  if (!response.data?.ok) {
    throw new Error(
      response.data?.description ?? "Telegram getUpdates falhou (verifique o token).",
    );
  }
  const updates: any[] = response.data.result ?? [];
  const byChat = new Map<string, DiscoveredChat>();
  for (const u of updates) {
    const m = u.message ?? u.edited_message;
    if (!m?.chat) continue;
    const chat = m.chat;
    const id = String(chat.id);
    byChat.set(id, {
      chatId: id,
      firstName: chat.first_name ?? chat.title ?? "(sem nome)",
      lastName: chat.last_name,
      username: chat.username,
      lastMessage: typeof m.text === "string" ? m.text : "(sem texto)",
      lastMessageAt: m.date ?? Math.floor(Date.now() / 1000),
    });
  }
  return [...byChat.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}
