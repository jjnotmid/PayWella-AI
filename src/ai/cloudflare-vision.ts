import { AppError } from "../contracts.ts";
import type { Media } from "./media.ts";
import { providerJson } from "./chat-completion.ts";

export const DEFAULT_VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export async function readCloudflareImage(
  media: Media,
  env: NodeJS.ProcessEnv,
  prompt: string,
  schema: unknown,
  fetcher: typeof fetch,
) {
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || "")
  )
    throw new AppError("AI_NOT_CONFIGURED", 503);
  const model = env.CLOUDFLARE_VISION_MODEL || DEFAULT_VISION_MODEL;
  if (
    ![DEFAULT_VISION_MODEL, "@cf/meta/llama-3.2-11b-vision-instruct"].includes(
      model,
    )
  )
    throw new AppError("INVALID_MODEL", 503);
  const data = await providerJson(
    await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25000),
        headers: {
          authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 2400,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    prompt +
                    " Return only one JSON object matching this schema: " +
                    JSON.stringify(schema),
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${media.mime};base64,${media.bytes.toString("base64")}`,
                  },
                },
              ],
            },
          ],
        }),
      },
    ),
  );
  const choice = data.choices?.[0],
    text = choice?.message?.content;
  if (
    choice?.finish_reason === "length" ||
    typeof text !== "string" ||
    text.length > 20000
  )
    throw new AppError("MEDIA_UNREADABLE");
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw new AppError("MEDIA_UNREADABLE");
  }
}
