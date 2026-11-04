import test from "node:test";
import assert from "node:assert/strict";
import { providerFailover } from "../src/ai/failover.ts";
import { createModel } from "../src/ai/model.ts";
import { createMediaReader } from "../src/ai/media.ts";
import { AppError } from "../src/contracts.ts";
import { errorCopy } from "../src/copy.ts";
const env = {
  AI_PROVIDER: "cloudflare",
  AI_FALLBACK_PROVIDER: "gemini",
  CLOUDFLARE_API_TOKEN: "isolated-primary",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  GEMINI_API_KEY: "isolated-secondary",
};
const exhausted = () =>
  Response.json(
    {
      errors: [
        { code: 4006, message: "You have used up your daily free allocation." },
      ],
    },
    { status: 429 },
  );
const tools = [
  {
    name: "get_balance",
    description: "Read owned balance",
    inputSchema: { type: "object", properties: {} },
  },
];
test("provider outage uses backup once, temporarily avoids failed primary, then recovers", async () => {
  let time = 1000,
    primaryCalls = 0,
    secondaryCalls = 0,
    healthy = false;
  const run = providerFailover(
    async () => {
      primaryCalls++;
      if (!healthy) throw new AppError("AI_DAILY_QUOTA", 503);
      return "primary";
    },
    async () => {
      secondaryCalls++;
      return "secondary";
    },
    () => time,
  );
  assert.equal(await run(), "secondary");
  assert.equal(await run(), "secondary");
  assert.equal(primaryCalls, 1);
  healthy = true;
  time += 60001;
  assert.equal(await run(), "primary");
  assert.equal(primaryCalls, 2);
  assert.equal(secondaryCalls, 2);
});
test("authorization and malformed-result errors never trigger provider retries", async () => {
  for (const code of [
    "FORBIDDEN",
    "PIN_INVALID",
    "AI_INVALID_RESPONSE",
    "AI_SPLIT_PLAN",
  ]) {
    let backup = false;
    const run = providerFailover(
      async () => {
        throw new AppError(code, 403);
      },
      async () => {
        backup = true;
        return "bad";
      },
    );
    await assert.rejects(run, (e: any) => e.code === code);
    assert.equal(backup, false);
  }
});
test("Gemini fallback preserves previous Llama tool calls and tool results", async () => {
  let primary = 0,
    secondary = 0;
  const model = createModel(env, async (url, init) => {
    if (String(url).includes("cloudflare.com")) {
      primary++;
      return exhausted();
    }
    secondary++;
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(body.contents[1].parts[0].functionCall, {
      name: "get_balance",
      args: {},
      id: "read-1",
    });
    assert.equal(
      body.contents[2].parts[0].functionResponse.response.balanceKobo,
      50000000,
    );
    assert.equal(
      new Headers(init!.headers).get("x-goog-api-key"),
      "isolated-secondary",
    );
    assert.ok(!String(init!.body).includes("isolated-primary"));
    return Response.json({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Your available balance is ₦500,000." }],
          },
        },
      ],
    });
  });
  const messages: any[] = [
    { role: "user", content: "What is my balance?" },
    {
      role: "assistant",
      content: "",
      calls: [{ id: "read-1", name: "get_balance", arguments: {} }],
    },
    {
      role: "tool",
      name: "get_balance",
      callId: "read-1",
      content: JSON.stringify({ balanceKobo: 50000000 }),
    },
  ];
  const answer = await model.complete(messages, tools);
  assert.equal(answer.provider, "gemini");
  assert.match(answer.text, /500,000/);
  await model.complete(messages, tools);
  assert.equal(primary, 1);
  assert.equal(secondary, 2);
});
test("image fallback preserves image bytes and question with validated result", async () => {
  let primary = 0,
    backup = 0;
  const media = {
    bytes: Buffer.from([255, 216, 255, 0]),
    mime: "image/jpeg",
    sha: "fixture",
  };
  const reader = createMediaReader(
    { ...env, IMAGE_PROVIDER: "cloudflare" },
    async (url, init) => {
      if (String(url).includes("cloudflare.com")) {
        primary++;
        return exhausted();
      }
      backup++;
      const body = JSON.parse(init!.body as string);
      assert.equal(
        body.contents[0].parts[1].inlineData.data,
        media.bytes.toString("base64"),
      );
      assert.match(body.contents[0].parts[0].text, /What is this receipt/);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    kind: "image",
                    category: "receipt",
                    description: "A payment receipt, not verified settlement.",
                    unclear: false,
                  }),
                },
              ],
            },
          },
        ],
      });
    },
  );
  assert.equal(
    (await reader.read(media, "What is this receipt?")).kind,
    "image",
  );
  assert.equal(primary, 1);
  assert.equal(backup, 1);
});
test("fallback failure remains an honest temporary outage without customer quota wording", async () => {
  const model = createModel(env, async (url) =>
    String(url).includes("cloudflare.com")
      ? exhausted()
      : Response.json(
          { error: { message: "private provider detail" } },
          { status: 503 },
        ),
  );
  await assert.rejects(
    () => model.complete([{ role: "user", content: "hello" }], []),
    (e: any) => e.code === "AI_UNAVAILABLE",
  );
  for (const code of [
    "AI_DAILY_QUOTA",
    "AI_QUOTA",
    "AI_KEY_REJECTED",
    "AI_MODEL_UNAVAILABLE",
  ]) {
    assert.doesNotMatch(
      errorCopy(code),
      /daily|limit|quota|1:00|cloudflare|provider/i,
    );
    assert.match(errorCopy(code), /temporarily unavailable/);
  }
});
