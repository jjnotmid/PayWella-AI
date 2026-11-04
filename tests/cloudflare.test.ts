import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../src/ai/model.ts";
import { aiReadiness } from "../src/ai/readiness.ts";
import { runtimeConfig } from "../src/config.ts";
import { structuredArguments } from "../src/ai/chat-completion.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { connectTools } from "../src/ai/mcp.ts";
test("Cloudflare hosts Meta Llama behind the same owned MCP contract without routing credentials through Groq", async () => {
  let requests = 0;
  const env = {
    AI_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "isolated-cloudflare-key",
    GROQ_API_KEY: "separate-media-key",
  };
  const model = createModel(env, async (url, init) => {
    requests++;
    assert.equal(
      url,
      "https://api.cloudflare.com/client/v4/accounts/" +
        env.CLOUDFLARE_ACCOUNT_ID +
        "/ai/v1/chat/completions",
    );
    assert.equal(
      new Headers(init!.headers).get("authorization"),
      "Bearer isolated-cloudflare-key",
    );
    const payload = JSON.parse(init!.body as string);
    assert.equal(payload.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.equal(payload.max_tokens, 2400);
    assert.equal(payload.max_completion_tokens, undefined);
    assert.equal(payload.messages[2].tool_call_id, "balance");
    assert.equal(JSON.stringify(payload).includes("separate-media-key"), false);
    return Response.json({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "goals",
                type: "function",
                function: { name: "list_goals", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
  });
  const result = await model.complete(
    [
      { role: "user", content: "Check my balance and goals." },
      {
        role: "assistant",
        content: "",
        calls: [{ id: "balance", name: "get_balance", arguments: {} }],
      },
      {
        role: "tool",
        name: "get_balance",
        callId: "balance",
        content: '{"availableKobo":50000000}',
      },
    ],
    [
      {
        name: "list_goals",
        description: "Owned goals",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  );
  assert.equal(result.calls[0].name, "list_goals");
  assert.equal(requests, 1);
  const ready = aiReadiness(env);
  assert.equal(ready.metaModelSelected, true);
  assert.equal(ready.mediaProvider, "gemini");
  assert.equal(ready.aiKey, true);
  assert.equal(ready.providerAccessVerified, false);
  assert.equal(
    runtimeConfig({ ...env, APP_SECRET: "s".repeat(32) }).MEDIA_PROVIDER,
    "gemini",
  );
});
test("missing or invalid Cloudflare credentials make no request and capacity/quota failures never switch models", async () => {
  let requests = 0;
  for (const env of [
    { AI_PROVIDER: "cloudflare" },
    {
      AI_PROVIDER: "cloudflare",
      CLOUDFLARE_API_TOKEN: "fixture",
      CLOUDFLARE_ACCOUNT_ID: "../../other",
    },
  ])
    await assert.rejects(
      () =>
        createModel(env, async () => {
          requests++;
          throw Error();
        }).complete([], []),
      (e: any) => e.code === "AI_NOT_CONFIGURED",
    );
  assert.equal(requests, 0);
  assert.throws(() =>
    createModel({
      AI_PROVIDER: "cloudflare",
      CLOUDFLARE_MODEL: "https://other.example",
    }),
  );
  await assert.rejects(
    () =>
      createModel(
        {
          AI_PROVIDER: "cloudflare",
          CLOUDFLARE_API_TOKEN: "fixture",
          CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        },
        async () => {
          requests++;
          return new Response("Quota exceeded", { status: 429 });
        },
      ).complete([], []),
    (e: any) => e.code === "AI_QUOTA",
  );
  assert.equal(requests, 1);
});

test("JSON-encoded task arrays are decoded only where the declared schema requires structure; strict money and ownership validation still apply", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let tools;
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    let prepared: any;
    tools = await connectTools(core, owner, (value) => {
      prepared = value;
    });
    const schema = tools.specs.find(
      (tool) => tool.name === "prepare_plan",
    )!.inputSchema;
    const tasks = [
      {
        kind: "bank_transfer",
        bankCode: "OPay",
        accountNumber: "0123456789",
        amountKobo: 200000,
      },
      { kind: "goal_create", name: "Laptop", amountKobo: 300000 },
      { kind: "goal_create", name: "Rent", amountKobo: 200000 },
    ];
    const decoded = structuredArguments(
      { tasks: JSON.stringify(tasks) },
      schema,
    ) as any;
    assert.deepEqual(decoded.tasks, tasks);
    const result = await tools.call("prepare_plan", decoded);
    assert.equal(result.paymentAuthorized, false);
    assert.equal(prepared.plan.spec.length, 3);
    assert.equal(prepared.plan.spec[0].input.bankCode, "opay");
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
    await core.cancel(owner, prepared.plan.id);
    const invalid = structuredArguments(
      { tasks: JSON.stringify([{ ...tasks[0], amountKobo: "200000" }]) },
      schema,
    );
    const rejected = await tools.call("prepare_plan", invalid);
    assert.equal(rejected.error, "INVALID_TOOL_ARGUMENTS");
    assert.ok(rejected.fields.length);
    assert.equal((await core.workspace(owner)).receipts.length, 0);
    const unknown = await tools.call(
      "prepare_plan",
      structuredArguments(
        { tasks: JSON.stringify([{ ...tasks[0], owner: "someone-else" }]) },
        schema,
      ),
    );
    assert.equal(unknown.error, "INVALID_TOOL_ARGUMENTS");
    assert.throws(() => structuredArguments({ tasks: "not-json" }, schema));
  } finally {
    await tools?.close();
    await db.close();
  }
});
