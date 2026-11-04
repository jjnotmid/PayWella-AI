import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../src/ai/model.ts";
import { createMediaReader, validateMedia } from "../src/ai/media.ts";
import { aiReadiness } from "../src/ai/readiness.ts";
import { providerJson } from "../src/ai/groq.ts";

const tools = [
  {
    name: "get_balance",
    description: "Owned balance",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];
const call = {
  id: "one",
  type: "function",
  function: { name: "get_balance", arguments: "{}" },
};
test("Groq Llama replays MCP calls with no unsupported provider settings and no secret in payload", async () => {
  let payload: any;
  const model = createModel(
    { AI_PROVIDER: "groq", GROQ_API_KEY: "isolated-key" },
    async (url, init) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(init!.redirect, "error");
      assert.equal(
        new Headers(init!.headers).get("authorization"),
        "Bearer isolated-key",
      );
      payload = JSON.parse(init!.body as string);
      return Response.json({
        choices: [
          {
            message: { content: null, tool_calls: [call] },
            finish_reason: "tool_calls",
          },
        ],
      });
    },
  );
  const result = await model.complete(
    [
      { role: "user", content: "What is my balance?" },
      {
        role: "assistant",
        content: "",
        calls: [{ id: "old", name: "get_balance", arguments: {} }],
      },
      {
        role: "tool",
        name: "get_balance",
        callId: "old",
        content: '{"availableKobo":50000000}',
      },
    ],
    tools,
  );
  assert.equal(payload.model, "llama-3.3-70b-versatile");
  assert.equal(
    payload.messages[1].tool_calls[0].id,
    payload.messages[2].tool_call_id,
  );
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.tools[0].function.name, "get_balance");
  assert.equal(JSON.stringify(payload).includes("isolated-key"), false);
  assert.deepEqual(result.calls, [
    { id: "one", name: "get_balance", arguments: {} },
  ]);
});

test("Groq rejects the entire response before tools run if any call is malformed, unknown, duplicated or truncated", async () => {
  for (const message of [
    {
      tool_calls: [
        { ...call, function: { name: "get_balance", arguments: "broken" } },
      ],
    },
    {
      tool_calls: [
        call,
        {
          ...call,
          id: "two",
          function: { name: "execute_payment", arguments: "{}" },
        },
      ],
    },
    { tool_calls: [call, call] },
    {
      tool_calls: [
        { ...call, function: { name: "get_balance", arguments: "[]" } },
      ],
    },
    { content: { unexpected: true } },
  ]) {
    const model = createModel(
      { AI_PROVIDER: "groq", GROQ_API_KEY: "fixture" },
      async () => Response.json({ choices: [{ message }] }),
    );
    await assert.rejects(
      () => model.complete([], tools),
      (e: any) => e.code === "AI_INVALID_RESPONSE",
    );
  }
  const truncated = createModel(
    { AI_PROVIDER: "groq", GROQ_API_KEY: "fixture" },
    async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { tool_calls: [call] } }],
      }),
  );
  await assert.rejects(() => truncated.complete([], tools));
});

test("Groq has no silent model fallback, missing credentials make no request, and provider errors are sanitized", async () => {
  let requests = 0;
  const missing = createModel({ AI_PROVIDER: "groq" }, async () => {
    requests++;
    throw Error();
  });
  await assert.rejects(
    () => missing.complete([], tools),
    (e: any) => e.code === "AI_NOT_CONFIGURED",
  );
  assert.equal(requests, 0);
  for (const [status, code] of [
    [401, "AI_KEY_REJECTED"],
    [403, "AI_MODEL_UNAVAILABLE"],
    [404, "AI_MODEL_UNAVAILABLE"],
    [429, "AI_QUOTA"],
    [413, "AI_REQUEST_TOO_LARGE"],
    [500, "AI_UNAVAILABLE"],
  ] as const) {
    const model = createModel(
      { AI_PROVIDER: "groq", GROQ_API_KEY: "fixture" },
      async () => {
        requests++;
        return new Response("sensitive-provider-payload", { status });
      },
    );
    const before: number = requests;
    await assert.rejects(
      () => model.complete([], tools),
      (e: any) => e.code === code && !e.message.includes("sensitive"),
    );
    assert.equal(requests, before + 1);
  }
  await assert.rejects(
    () => providerJson(new Response("x".repeat(200001))),
    (e: any) => e.code === "AI_RESPONSE_LIMIT",
  );
  await assert.rejects(
    () =>
      providerJson(
        Response.json(
          {
            errors: [
              {
                code: 4006,
                message:
                  "You have used up your daily free allocation of 10,000 neurons.",
              },
            ],
          },
          { status: 429 },
        ),
      ),
    (e: any) => e.code === "AI_DAILY_QUOTA" && !e.message.includes("neurons"),
  );
  assert.throws(() =>
    createModel({
      AI_PROVIDER: "groq",
      GROQ_MODEL: "meta-llama/llama-prompt-guard-2-22m",
    }),
  );
});

test("Groq speech keeps exact digits and code switching, rejects silence and flags uncertain sections", async () => {
  const media = validateMedia(Buffer.from("OggSfixture"), "audio/ogg");
  let converted = 0;
  const read = (value: unknown) =>
    createMediaReader(
      { MEDIA_PROVIDER: "groq", GROQ_API_KEY: "fixture" },
      async (url, init) => {
        assert.equal(
          url,
          "https://api.groq.com/openai/v1/audio/transcriptions",
        );
        const data = init!.body as FormData;
        assert.ok(data.get("file") instanceof Blob);
        assert.equal(data.get("model"), "whisper-large-v3");
        assert.equal(data.get("language"), null);
        assert.equal(data.get("response_format"), "verbose_json");
        return Response.json(value);
      },
      async () => {
        converted++;
        return Buffer.from("RIFFfixture");
      },
    ).read(media);
  const sentence = "Press my mama 2k, aza 0123456789, OP. Save 3k for laptop.";
  assert.deepEqual(
    await read({
      text: sentence,
      duration: 5,
      segments: [{ text: sentence, avg_logprob: -0.2, no_speech_prob: 0.02 }],
    }),
    { kind: "audio", transcript: sentence, unclear: false },
  );
  assert.deepEqual(
    await read({
      text: "invented words",
      segments: [{ text: "invented words", no_speech_prob: 0.99 }],
    }),
    { kind: "unreadable" },
  );
  const uncertain = await read({
    text: sentence,
    segments: [{ text: sentence, avg_logprob: -1.4 }],
  });
  assert.equal(uncertain.kind === "audio" && uncertain.unclear, true);
  await assert.rejects(
    () => read({ text: sentence, duration: 91 }),
    (e: any) => e.code === "AUDIO_TOO_LONG",
  );
  assert.equal(converted, 4);
});

test("Groq photos require an explicit vision model and extracted ledger rows remain typed candidates", async () => {
  const media = validateMedia(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    "image/png",
  );
  let requests = 0;
  const noVision = createMediaReader(
    { MEDIA_PROVIDER: "groq", GROQ_API_KEY: "fixture" },
    async () => {
      requests++;
      throw Error();
    },
  );
  await assert.rejects(
    () => noVision.read(media),
    (e: any) => e.code === "VISION_NOT_CONFIGURED",
  );
  assert.equal(requests, 0);
  const read = (value: unknown) =>
    createMediaReader(
      {
        MEDIA_PROVIDER: "groq",
        GROQ_API_KEY: "fixture",
        GROQ_VISION_MODEL: "qwen/qwen3.8-27b",
      },
      async (_, init) => {
        const sent = JSON.parse(init!.body as string);
        assert.equal(sent.model, "qwen/qwen3.8-27b");
        assert.equal(sent.response_format.type, "json_object");
        assert.match(
          sent.messages[0].content[1].image_url.url,
          /^data:image\/png;base64,/,
        );
        return Response.json({
          choices: [{ message: { content: JSON.stringify(value) } }],
        });
      },
    ).read(media);
  assert.equal(
    (
      await read({
        kind: "ledger",
        rows: [{ name: "Ada", amountKobo: 200000, date: null, unclear: true }],
      })
    ).kind,
    "ledger",
  );
  await assert.rejects(() =>
    read({
      kind: "ledger",
      rows: [{ name: "Ada", amountKobo: "2000", date: null, unclear: false }],
    }),
  );
});

test("readiness distinguishes Meta model selection from credentials, vision and proven account access", () => {
  const ready = aiReadiness({ AI_PROVIDER: "groq", GROQ_API_KEY: "fixture" });
  assert.equal(ready.metaModelSelected, true);
  assert.equal(ready.aiKey, true);
  assert.equal(ready.visionConfigured, false);
  assert.equal(ready.providerAccessVerified, false);
  assert.equal(
    aiReadiness({ AI_PROVIDER: "groq", GROQ_MODEL: "openai/gpt-oss-120b" })
      .metaModelSelected,
    false,
  );
  assert.equal(
    aiReadiness({
      AI_PROVIDER: "groq",
      GROQ_MODEL: "meta-llama/llama-prompt-guard-2-22m",
    }).metaModelSelected,
    false,
  );
});
