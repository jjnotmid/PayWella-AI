import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../src/ai/model.ts";
const env = {
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "isolated-language-fixture",
};
test("Gemini supplies current-language metadata without passing it into financial tool arguments", async () => {
  const model = createModel(env, async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
    const tool = body.tools[0].functionDeclarations.find(
      (d: any) => d.name === "prepare_plan",
    );
    assert.ok(tool.parametersJsonSchema.required.includes("replyLanguage"));
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "prepare_plan",
                  args: {
                    replyLanguage: "pcm",
                    tasks: [
                      { kind: "goal_create", name: "Rent", amountKobo: 200000 },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    });
  });
  const result = await model.complete(
    [{ role: "user", content: "Abeg save 2k for rent." }],
    [
      {
        name: "prepare_plan",
        description: "Private proposal only",
        inputSchema: {
          type: "object",
          properties: { tasks: { type: "array" } },
          required: ["tasks"],
          additionalProperties: false,
        },
      },
    ],
  );
  assert.equal(result.language, "pcm");
  assert.equal(result.calls[0].name, "prepare_plan");
  assert.equal((result.calls[0].arguments as any).replyLanguage, undefined);
  assert.equal((result.calls[0].arguments as any).tasks[0].amountKobo, 200000);
});
test("a conversational reply carries language without creating an account action", async () => {
  const model = createModel(env, async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "reply_to_customer",
                  args: {
                    replyLanguage: "pcm",
                    text: "How far! Wetin dey sup?",
                  },
                },
              },
            ],
          },
        },
      ],
    }),
  );
  const result = await model.complete(
    [{ role: "user", content: "Wetin dey sup?" }],
    [],
  );
  assert.equal(result.language, "pcm");
  assert.equal(result.text, "How far! Wetin dey sup?");
  assert.deepEqual(result.calls, []);
});
test("unsupported language metadata and invented execution tools are rejected before MCP", async () => {
  for (const [name, language] of [
    ["reply_to_customer", "es"],
    ["execute_payment", "en"],
  ]) {
    const model = createModel(env, async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name,
                    args: { replyLanguage: language, text: "untrusted" },
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await assert.rejects(
      () => model.complete([{ role: "user", content: "Hello" }], []),
      { code: "AI_INVALID_RESPONSE" },
    );
  }
});
