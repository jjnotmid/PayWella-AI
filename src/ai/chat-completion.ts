import { AppError } from "../contracts.ts";
import type { ModelMessage, ToolSpec } from "./model.ts";

export async function providerJson(response: Response): Promise<any> {
  if (!response.ok) {
    let dailyQuota = false;
    if (response.status === 429) {
      try {
        const failure = await boundedJson(response, 4096);
        dailyQuota =
          Array.isArray(failure.errors) &&
          failure.errors.some(
            (error: any) =>
              error.code === 4006 &&
              typeof error.message === "string" &&
              error.message.includes("daily free allocation"),
          );
      } catch {}
    } else await response.body?.cancel();
    throw new AppError(
      dailyQuota
        ? "AI_DAILY_QUOTA"
        : response.status === 413
          ? "AI_REQUEST_TOO_LARGE"
          : response.status === 429
            ? "AI_QUOTA"
            : response.status === 401
              ? "AI_KEY_REJECTED"
              : response.status === 403 || response.status === 404
                ? "AI_MODEL_UNAVAILABLE"
                : "AI_UNAVAILABLE",
      503,
    );
  }
  return boundedJson(response, 200000);
}

async function boundedJson(response: Response, max: number): Promise<any> {
  if (!response.body) throw new AppError("AI_INVALID_RESPONSE", 503);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new AppError("AI_RESPONSE_LIMIT", 503);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new AppError("AI_INVALID_RESPONSE", 503);
    }
  } finally {
    reader.releaseLock();
  }
}

export function completionMessages(messages: ModelMessage[]) {
  return messages.map((m) => ({
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
  }));
}

export function structuredArguments(
  value: unknown,
  schema: any,
  depth = 0,
): unknown {
  if (depth > 12) throw new AppError("AI_INVALID_RESPONSE", 503);
  if (typeof value === "string" && ["array", "object"].includes(schema?.type)) {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AppError("AI_INVALID_RESPONSE", 503);
    }
  }
  if (Array.isArray(value) && schema?.type === "array")
    return value.map((item) =>
      structuredArguments(item, schema.items, depth + 1),
    );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    let expected = schema;
    if (schema?.anyOf) {
      const discriminator = (value as Record<string, unknown>).kind;
      expected =
        schema.anyOf.find(
          (candidate: any) =>
            candidate.properties?.kind?.const === discriminator,
        ) || schema;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expected?.properties?.[key]
          ? structuredArguments(item, expected.properties[key], depth + 1)
          : item,
      ]),
    );
  }
  return value;
}

export function parseChatCompletion(data: any, tools: ToolSpec[]) {
  const choice = data.choices?.[0],
    message = choice?.message;
  if (
    !message ||
    choice.finish_reason === "length" ||
    (message.content != null && typeof message.content !== "string") ||
    (message.tool_calls != null && !Array.isArray(message.tool_calls)) ||
    (message.tool_calls?.length || 0) > 8
  )
    throw new AppError("AI_INVALID_RESPONSE", 503);
  const ids = new Set<string>();
  const calls = (message.tool_calls || []).map((call: any) => {
    if (
      call.type !== "function" ||
      typeof call.id !== "string" ||
      !call.id ||
      call.id.length > 200 ||
      ids.has(call.id) ||
      !tools.some((t) => t.name === call.function?.name) ||
      typeof call.function?.arguments !== "string"
    )
      throw new AppError("AI_INVALID_RESPONSE", 503);
    ids.add(call.id);
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new AppError("AI_INVALID_RESPONSE", 503);
    }
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new AppError("AI_INVALID_RESPONSE", 503);
    const tool = tools.find((tool) => tool.name === call.function.name)!;
    return {
      id: call.id,
      name: call.function.name,
      arguments: structuredArguments(args, tool.inputSchema),
    };
  });
  return { text: message.content || "", calls };
}
