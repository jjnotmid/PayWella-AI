import { AppError } from "../contracts.ts";
import { createGroqModel } from "./groq.ts";
import { createCloudflareModel } from "./cloudflare.ts";
import { providerFailover } from "./failover.ts";
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  callId?: string;
  calls?: ModelCall[];
  raw?: any;
};
export type ModelCall = { id: string; name: string; arguments: unknown };
export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export interface Model {
  provider: string;
  complete(
    messages: ModelMessage[],
    tools: ToolSpec[],
  ): Promise<{
    text: string;
    calls: ModelCall[];
    raw?: any;
    provider?: string;
  }>;
}
async function result(response: Response) {
  if (!response.ok)
    throw new AppError(
      response.status === 429
        ? "AI_QUOTA"
        : response.status === 401 || response.status === 403
          ? "AI_KEY_REJECTED"
          : "AI_UNAVAILABLE",
      503,
    );
  const text = await response.text();
  if (text.length > 200000) throw new AppError("AI_RESPONSE_LIMIT", 503);
  return JSON.parse(text);
}
export function createModel(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Model {
  const provider = env.AI_PROVIDER || "gemini";
  if (provider === "groq") return createGroqModel(env, fetcher);
  if (provider === "cloudflare") {
    const primary = createCloudflareModel(env, fetcher);
    if (env.AI_FALLBACK_PROVIDER !== "gemini" || !env.GEMINI_API_KEY)
      return primary;
    const secondary = createModel(
      { ...env, AI_PROVIDER: "gemini", AI_FALLBACK_PROVIDER: "" },
      fetcher,
    );
    return {
      provider: primary.provider,
      complete: providerFailover(
        async (messages: ModelMessage[], tools: ToolSpec[]) => ({
          ...(await primary.complete(messages, tools)),
          provider: "cloudflare",
        }),
        async (messages: ModelMessage[], tools: ToolSpec[]) => ({
          ...(await secondary.complete(messages, tools)),
          provider: "gemini",
        }),
      ),
    };
  }
  if (!["gemini", "meta"].includes(provider))
    throw new Error("Unsupported AI_PROVIDER");
  return {
    provider,
    async complete(messages, tools) {
      const key = provider === "meta" ? env.MODEL_API_KEY : env.GEMINI_API_KEY;
      if (!key) throw new AppError("AI_NOT_CONFIGURED", 503);
      if (provider === "meta") {
        const response = await fetcher(
          "https://api.meta.ai/v1/chat/completions",
          {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              authorization: "Bearer " + key,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: env.META_MODEL || "muse-spark-1.3",
              reasoning_effort: "low",
              max_completion_tokens: 4000,
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
                ...(m.calls?.length
                  ? {
                      tool_calls: m.calls.map((c) => ({
                        id: c.id,
                        type: "function",
                        function: {
                          name: c.name,
                          arguments: JSON.stringify(c.arguments),
                        },
                      })),
                    }
                  : {}),
                ...(m.callId ? { tool_call_id: m.callId } : {}),
              })),
              tools: tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              })),
              tool_choice: "auto",
            }),
          },
        );
        const data = await result(response),
          message = data.choices?.[0]?.message;
        if (!message) throw new AppError("AI_INVALID_RESPONSE", 503);
        return {
          text: message.content || "",
          calls: (message.tool_calls || []).map((c: any) => ({
            id: c.id,
            name: c.function.name,
            arguments: JSON.parse(c.function.arguments),
          })),
        };
      }
      const contents: any[] = [];
      for (const m of messages) {
        if (m.role === "system") continue;
        const part =
          m.role === "tool"
            ? {
                functionResponse: {
                  name: m.name,
                  id: m.callId,
                  response: JSON.parse(m.content),
                },
              }
            : { text: m.content };
        if (m.role === "assistant" && Array.isArray(m.raw?.parts)) {
          contents.push(m.raw);
          continue;
        }
        if (m.role === "assistant" && m.calls?.length) {
          contents.push({
            role: "model",
            parts: [
              ...(m.content ? [{ text: m.content }] : []),
              ...m.calls.map((call) => ({
                functionCall: {
                  name: call.name,
                  args: call.arguments,
                  id: call.id,
                },
              })),
            ],
          });
          continue;
        }
        const role = m.role === "assistant" ? "model" : "user";
        if (
          m.role === "tool" &&
          contents.at(-1)?.role === "user" &&
          contents.at(-1)?.parts?.[0]?.functionResponse
        )
          contents.at(-1).parts.push(part);
        else contents.push({ role, parts: [part] });
      }
      const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
      if (!/^[a-z0-9.-]+$/.test(model))
        throw new AppError("INVALID_MODEL", 503);
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            "x-goog-api-key": key,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: messages
                    .filter((m) => m.role === "system")
                    .map((m) => m.content)
                    .join("\n"),
                },
              ],
            },
            contents,
            ...(tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.inputSchema,
                      })),
                    },
                  ],
                }
              : {}),
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 1800,
              ...(/^gemini-3[.-]/.test(model)
                ? { thinkingConfig: { thinkingLevel: "minimal" } }
                : {}),
            },
          }),
        },
      );
      const data = await result(response),
        content = data.candidates?.[0]?.content;
      if (!content) throw new AppError("AI_INVALID_RESPONSE", 503);
      return {
        text: (content.parts || []).map((p: any) => p.text || "").join(""),
        calls: (content.parts || [])
          .filter((p: any) => p.functionCall)
          .map((p: any, i: number) => ({
            id: p.functionCall.id || "call-" + i,
            name: p.functionCall.name,
            arguments: p.functionCall.args || {},
          })),
        raw: content,
      };
    },
  };
}
