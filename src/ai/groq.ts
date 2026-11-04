import {
  completionMessages,
  parseChatCompletion,
  providerJson,
} from "./chat-completion.ts";
import { AppError } from "../contracts.ts";
import type { Model, ModelMessage, ToolSpec } from "./model.ts";

export const GROQ_ORIGIN = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GROQ_SPEECH_MODEL = "whisper-large-v3";

export function groqModelId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,150}$/.test(value))
    throw new AppError("INVALID_MODEL", 503);
  return value;
}

export function isMetaReasoningModel(id: string) {
  return (
    (!/prompt-guard/i.test(id) && /^(?:meta-llama\/)?llama-/.test(id)) ||
    id === "meta-models/muse-spark-open"
  );
}

export { providerJson } from "./chat-completion.ts";

export function createGroqModel(
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Model {
  const model = groqModelId(env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
  if (/prompt-guard/i.test(model)) throw new AppError("INVALID_MODEL", 503);
  return {
    provider: "groq",
    async complete(messages: ModelMessage[], tools: ToolSpec[]) {
      if (!env.GROQ_API_KEY) throw new AppError("AI_NOT_CONFIGURED", 503);
      const data = await providerJson(
        await fetcher(GROQ_ORIGIN + "/chat/completions", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            authorization: "Bearer " + env.GROQ_API_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: completionMessages(messages),
            temperature: 0.15,
            max_completion_tokens: 2400,
            ...(tools.length
              ? {
                  tools: tools.map((t) => ({
                    type: "function",
                    function: {
                      name: t.name,
                      description: t.description,
                      parameters: t.inputSchema,
                    },
                  })),
                  tool_choice: "auto",
                }
              : {}),
          }),
        }),
      );
      return parseChatCompletion(data, tools);
    },
  };
}
