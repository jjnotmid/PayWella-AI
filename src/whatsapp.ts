import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./contracts.ts";
export function verifyWhatsApp(
  body: Buffer,
  signature: string,
  secret: string,
) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export async function sendWhatsApp(
  env: NodeJS.ProcessEnv,
  to: string,
  text: string,
) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    throw new AppError("WHATSAPP_NOT_CONFIGURED", 503);
  const response = await fetch(
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
        type: "text",
        text: { body: text.slice(0, 4000), preview_url: false },
      }),
    },
  );
  if (!response.ok) throw new AppError("WHATSAPP_SEND_UNCONFIRMED", 503);
}
export async function sendWhatsAppReceipt(
  env: NodeJS.ProcessEnv,
  to: string,
  image: Buffer,
) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    throw new AppError("WHATSAPP_NOT_CONFIGURED", 503);
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
  const upload = await fetch(base + "/media", {
    method: "POST",
    headers,
    body: file,
    signal: AbortSignal.timeout(15000),
  });
  if (!upload.ok) throw new AppError("RECEIPT_UPLOAD_FAILED", 503);
  const media = await upload.json();
  if (!/^\d+$/.test(media.id || ""))
    throw new AppError("RECEIPT_UPLOAD_FAILED", 503);
  const result = await fetch(base + "/messages", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        id: media.id,
        caption:
          "Your task completed successfully. Your PayWella receipt is attached.",
      },
    }),
  });
  if (!result.ok) throw new AppError("RECEIPT_SEND_UNCONFIRMED", 503);
}
