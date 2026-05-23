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
