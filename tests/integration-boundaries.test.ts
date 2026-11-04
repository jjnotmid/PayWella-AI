import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "../src/ai/model.ts";
import { createMediaReader, validateMedia } from "../src/ai/media.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { SandboxRail } from "../src/providers/sandbox.ts";
import { statementPdf } from "../src/statements.ts";
import { Agent } from "../src/ai/agent.ts";
import { Worker } from "../src/worker.ts";
import { runtimeConfig } from "../src/config.ts";
import { lagosDate } from "../src/calendar.ts";
test("production configuration rejects insecure approval links and invalid identifiers without revealing key values", () => {
  assert.throws(() =>
    runtimeConfig({
      APP_SECRET: "x".repeat(32),
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "http://paywella.example",
    }),
  );
  assert.throws(() =>
    runtimeConfig({
      APP_SECRET: "x".repeat(32),
      PUBLIC_ORIGIN: "https://user:secret@paywella.example",
    }),
  );
  assert.throws(() =>
    runtimeConfig({
      APP_SECRET: "x".repeat(32),
      WHATSAPP_PHONE_NUMBER_ID: "not-a-phone-id",
    }),
  );
  assert.equal(
    runtimeConfig({
      APP_SECRET: "x".repeat(32),
      PUBLIC_ORIGIN: "https://paywella.example/",
    }).PUBLIC_ORIGIN,
    "https://paywella.example",
  );
  assert.equal(
    runtimeConfig({
      APP_SECRET: "x".repeat(32),
      NODE_ENV: "production",
      RENDER_EXTERNAL_URL: "https://paywella-ai.example",
    }).PUBLIC_ORIGIN,
    "https://paywella-ai.example",
  );
});
test("five-task review completes P2P, airtime, data, electricity and savings with a recipient receipt and electricity token", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001"),
      recipient = await core.userForPhone("2348000000002");
    await core.setup(owner, "Ada Example", "1234");
    await core.setup(recipient, "Bisi Example", "4321");
    const value = await core.prepare(owner, {
      tasks: [
        { kind: "p2p", recipientPhone: "2348000000002", amountKobo: 200000 },
        {
          kind: "service",
          productId: "mtn-airtime",
          customer: "08000000001",
          amountKobo: 100000,
        },
        {
          kind: "service",
          productId: "mtn-data-1",
          customer: "08000000001",
          amountKobo: 100000,
        },
        {
          kind: "service",
          productId: "ikeja-prepaid",
          customer: "12345678901",
          amountKobo: 200000,
        },
        { kind: "goal_create", name: "Rent", amountKobo: 300000 },
      ],
    });
    assert.match(value.plan.spec[3].destination!, /Example · 12345678901/);
    await core.approve(owner, value.plan.id, 1, "1234");
    await core.drain();
    assert.equal((await core.plan(owner, value.plan.id)).status, "SUCCEEDED");
    const sent = await core.workspace(owner),
      received = await core.workspace(recipient);
    assert.equal(sent.balanceKobo, 49100000);
    assert.equal(received.balanceKobo, 50200000);
    assert.equal(received.receipts.length, 1);
    assert.equal(received.receipts[0].direction, "credit");
    assert.equal(sent.receipts.length, 5);
    assert.match(
      sent.receipts.find((row) => row.electricityToken)!.electricityToken,
      /^\d{20}$/,
    );
    const goal = sent.goals[0],
      withdraw = await core.prepare(owner, {
        tasks: [{ kind: "goal_withdraw", goalId: goal.id, amountKobo: 100000 }],
      });
    await core.approve(owner, withdraw.plan.id, 1, "1234");
    await core.drain();
    assert.equal((await core.workspace(owner)).balanceKobo, 49200000);
    const one = await core.saveBeneficiary(owner, "opay", "0123456789"),
      two = await core.saveBeneficiary(owner, "opay", "0123456789");
    assert.equal(one.id, two.id);
    assert.equal((await core.records(owner, "beneficiary")).length, 1);
    assert.equal((await core.records(recipient, "beneficiary")).length, 0);
  } finally {
    await db.close();
  }
});

test("Meta model adapter preserves complete tool-call replay and uses the documented endpoint", async () => {
  let payload: any;
  const model = createModel(
    { AI_PROVIDER: "meta", MODEL_API_KEY: "offline-fixture" },
    async (url, init) => {
      assert.equal(url, "https://api.meta.ai/v1/chat/completions");
      payload = JSON.parse(init!.body as string);
      return Response.json({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-two",
                  type: "function",
                  function: { name: "get_balance", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    },
  );
  const reply = await model.complete(
    [
      { role: "user", content: "Check my balance" },
      {
        role: "assistant",
        content: "",
        calls: [{ id: "call-one", name: "get_balance", arguments: {} }],
      },
      {
        role: "tool",
        name: "get_balance",
        callId: "call-one",
        content: '{"availableKobo":50000000}',
      },
    ],
    [
      {
        name: "get_balance",
        description: "Owned balance",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  );
  assert.equal(payload.model, "muse-spark-1.3");
  assert.equal(payload.reasoning_effort, "low");
  assert.equal(
    payload.messages[1].tool_calls[0].id,
    payload.messages[2].tool_call_id,
  );
  assert.equal(reply.calls[0].name, "get_balance");
  let calls = 0;
  await assert.rejects(
    () =>
      createModel({ AI_PROVIDER: "meta" }, async () => {
        calls++;
        throw Error();
      }).complete([], []),
    (error: any) => error.code === "AI_NOT_CONFIGURED",
  );
  assert.equal(calls, 0);
});
test("Meta media adapters send private inline images and a converted WAV without browser or client keys", async () => {
  const media = validateMedia(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    "image/png",
  );
  let image: any;
  const result = await createMediaReader(
    { MEDIA_PROVIDER: "meta", MODEL_API_KEY: "offline-fixture" },
    async (url, init) => {
      assert.equal(url, "https://api.meta.ai/v1/chat/completions");
      image = JSON.parse(init!.body as string);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "account",
                accountNumber: "0123456789",
                bank: "OPay",
                name: "Ada Example",
                amountKobo: null,
                unclear: false,
              }),
            },
          },
        ],
      });
    },
  ).read(media);
  assert.equal(result.kind, "account");
  assert.match(
    image.messages[0].content[1].image_url.url,
    /^data:image\/png;base64,/,
  );
  assert.equal(image.response_format.type, "json_schema");
  let converted = 0;
  const speech = await createMediaReader(
    { MEDIA_PROVIDER: "meta", MODEL_API_KEY: "offline-fixture" },
    async (url, init) => {
      assert.equal(url, "https://api.meta.ai/v1/asr/transcribe");
      assert.ok(init!.body instanceof FormData);
      assert.ok((init!.body as FormData).get("audio"));
      return Response.json({
        transcript: "Send two thousand naira to my mother.",
      });
    },
    async () => {
      converted++;
      return Buffer.from("RIFFofflineWAVE");
    },
  ).read(validateMedia(Buffer.from("OggSfixture"), "audio/ogg"));
  assert.equal(converted, 1);
  assert.equal(speech.kind, "audio");
});
test("a rejected payment releases only its hold while settled tasks appear in the current Lagos-day statement", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-04T23:30:00Z"),
  });
  const db = await openStore({ file: ":memory:" }),
    rail = new SandboxRail(),
    core = new Core(db, rail);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const value = await core.prepare(owner, {
      tasks: [
        {
          kind: "bank_transfer",
          bankCode: "opay",
          accountNumber: "0123456789",
          amountKobo: 200000,
        },
        { kind: "goal_create", name: "Rent", amountKobo: 300000 },
      ],
    });
    rail.outcomes.set(value.plan.spec[0].id, {
      status: "failed",
      code: "PROVIDER_REJECTED",
    });
    await core.approve(owner, value.plan.id, 1, "1234");
    await core.drain();
    const plan = await core.plan(owner, value.plan.id);
    assert.equal(plan.status, "PARTIAL");
    assert.equal((await core.workspace(owner)).availableKobo, 49700000);
    assert.equal((await core.workspace(owner)).receipts.length, 1);
    const today = lagosDate(),
      statement = await core.statement(
        owner,
        today.slice(0, 4) + "-01-01",
        today,
      );
    assert.equal(today, "2026-11-05");
    assert.equal(statement.closingKobo, 49700000);
    assert.equal(statement.entries.length, 2);
    assert.equal(
      (await statementPdf(statement)).subarray(0, 4).toString(),
      "%PDF",
    );
    await assert.rejects(() =>
      core.statement(owner, "2026-02-30", "2026-03-01"),
    );
    await assert.rejects(() =>
      core.statement(owner, "2020-01-01", "2026-12-31"),
    );
  } finally {
    await db.close();
  }
});
test("language selection leads directly to an introduction and opening link without calling an AI", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let modelCalls = 0;
  const agent = new Agent(
      core,
      {
        provider: "offline-fixture",
        async complete() {
          modelCalls++;
          throw Error("Onboarding must not call the model.");
        },
      },
      "offline-isolated-language-test-secret",
    ),
    worker = new Worker(core, agent, {
      PUBLIC_ORIGIN: "https://paywella.example",
    });
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.enqueue(db, "hello", "agent", owner, {
      sealed: agent.seal({ text: "Hi", channel: "web" }),
    });
    await worker.turn();
    let reply = agent.open((await core.records(owner, "reply"))[0].sealed);
    assert.equal(reply.interactive.action.sections[0].rows.length, 5);
    assert.equal(reply.url, undefined);
    await core.enqueue(db, "choose", "agent", owner, {
      sealed: agent.seal({ text: "", language: "pcm", channel: "web" }),
    });
    await worker.turn();
    reply = agent.open(
      (await core.records(owner, "reply")).find((row) => row.id === "choose")!
        .sealed,
    );
    assert.match(reply.text, /With PayWella/);
    assert.match(reply.url, /https:\/\/paywella.example\/open#/);
    assert.equal((await core.getUser(owner)).language, "pcm");
    assert.equal(modelCalls, 0);
  } finally {
    await worker.stop();
    await db.close();
  }
});
test("temporary conversation and media state expires without deleting receipts or ledger evidence", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    await core.put(db, "expired-conversation", owner, "conversation", {
      updatedAt: "2000-01-01",
      sealed: "old",
    });
    await core.put(db, "expired-progress", owner, "progress", {
      updatedAt: "2000-01-01",
      sealed: "old",
    });
    const value = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    await core.approve(owner, value.plan.id, 1, "1234");
    await core.drain();
    await core.cleanup();
    assert.equal((await core.records(owner, "conversation")).length, 0);
    assert.equal((await core.records(owner, "progress")).length, 0);
    assert.equal((await core.workspace(owner)).receipts.length, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 49800000);
  } finally {
    await db.close();
  }
});
