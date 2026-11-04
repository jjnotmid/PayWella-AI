import { AppError } from "../contracts.ts";
import {
  completionMessages,
  parseChatCompletion,
  providerJson,
} from "./chat-completion.ts";
import type { Model } from "./model.ts";

export const DEFAULT_CLOUDFLARE_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export function cloudflareModelId(env: NodeJS.ProcessEnv) {
  const model = env.CLOUDFLARE_MODEL || DEFAULT_CLOUDFLARE_MODEL;
  if (!/^@cf\/meta\/llama-[a-zA-Z0-9._-]+$/.test(model))
    throw new AppError("INVALID_MODEL", 503);
  return model;
}
export function createCloudflareModel(
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Model {
  const model = cloudflareModelId(env);
  return {
    provider: "cloudflare",
    async complete(messages, tools) {
      if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID)
        throw new AppError("AI_NOT_CONFIGURED", 503);
      if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID))
        throw new AppError("AI_NOT_CONFIGURED", 503);
      const data = await providerJson(
        await fetcher(
          `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(20000),
            headers: {
              authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: completionMessages(messages),
              temperature: 0.15,
              max_tokens: 2400,
              ...(tools.length
                ? {
                    tools: tools.map((tool) => ({
                      type: "function",
                      function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                      },
                    })),
                    tool_choice: "auto",
                  }
                : {}),
            }),
          },
        ),
      );
      return parseChatCompletion(data, tools);
    },
  };
}
