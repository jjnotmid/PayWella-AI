import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./contracts.ts";
export class WhatsAppDeliveryError extends AppError {
  outcome: "retry" | "blocked" | "failed" | "unknown";
  constructor(outcome: WhatsAppDeliveryError["outcome"], code: string) {
    super(code, 503);
    this.outcome = outcome;
  }
}
async function acknowledgement(response: Response): Promise<string> {
  if (!response.ok) {
    let code: number | undefined;
    try {
      code = (await response.json()).error?.code;
    } catch {}
    if (
      response.status === 429 ||
      [4, 17, 32, 613, 130429, 131056].includes(code || 0)
    )
      throw new WhatsAppDeliveryError("retry", "WHATSAPP_RATE_LIMIT");
    if (
      [401, 403].includes(response.status) ||
      [10, 190, 200].includes(code || 0)
    )
      throw new WhatsAppDeliveryError("blocked", "WHATSAPP_ACCESS_REJECTED");
    if (response.status >= 400 && response.status < 500)
      throw new WhatsAppDeliveryError("failed", "WHATSAPP_MESSAGE_REJECTED");
    throw new WhatsAppDeliveryError("unknown", "WHATSAPP_SEND_UNCONFIRMED");
  }
  const data = await response.json();
  const id = data.messages?.[0]?.id;
  if (typeof id !== "string" || !id || id.length > 200)
    throw new WhatsAppDeliveryError("unknown", "WHATSAPP_SEND_UNCONFIRMED");
  return id;
}
export function verifyWhatsApp(
  body: Buffer,
  signature: string,
  secret: string,
) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export async function showTyping(
  env: NodeJS.ProcessEnv,
  messageId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return;
  await fetcher(
    `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || "v24.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
      signal: AbortSignal.timeout(3000),
    },
  );
}
export async function sendWhatsApp(
  env: NodeJS.ProcessEnv,
  to: string,
  text: string,
  fetcher: typeof fetch = fetch,
  interactive?: Record<string, unknown>,
) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    throw new WhatsAppDeliveryError("blocked", "WHATSAPP_NOT_CONFIGURED");
  if (!interactive && text.length > 4000)
    throw new WhatsAppDeliveryError("failed", "WHATSAPP_MESSAGE_TOO_LONG");
  const response = await fetcher(
    `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || "v24.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        ...(interactive
          ? { type: "interactive", interactive }
          : {
              type: "text",
              text: { body: text, preview_url: false },
            }),
      }),
    },
  );
  return acknowledgement(response);
}
export async function sendWhatsAppReceipt(
  env: NodeJS.ProcessEnv,
  to: string,
  image: Buffer,
  fetcher: typeof fetch = fetch,
  caption = "Your task completed successfully. Your PayWella receipt is attached.",
) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    throw new WhatsAppDeliveryError("blocked", "WHATSAPP_NOT_CONFIGURED");
  const base = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || "v24.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}`,
    headers = { authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN },
    file = new FormData();
  file.append("messaging_product", "whatsapp");
  file.append("type", "image/png");
  file.append(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "PayWella-receipt.png",
  );
  let upload: Response;
  try {
    upload = await fetcher(base + "/media", {
      method: "POST",
      headers,
      body: file,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new WhatsAppDeliveryError("retry", "RECEIPT_UPLOAD_FAILED");
  }
  if (!upload.ok)
    throw new WhatsAppDeliveryError(
      [401, 403].includes(upload.status)
        ? "blocked"
        : upload.status === 429 || upload.status >= 500
          ? "retry"
          : "failed",
      "RECEIPT_UPLOAD_FAILED",
    );
  let media: any;
  try {
    media = await upload.json();
  } catch {
    throw new WhatsAppDeliveryError("retry", "RECEIPT_UPLOAD_FAILED");
  }
  if (!/^\d+$/.test(media.id || ""))
    throw new WhatsAppDeliveryError("retry", "RECEIPT_UPLOAD_FAILED");
  const result = await fetcher(base + "/messages", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        id: media.id,
        caption,
      },
    }),
  });
  return acknowledgement(result);
}
