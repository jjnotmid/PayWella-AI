import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { Worker } from "../src/worker.ts";
import { createApp } from "../src/server.ts";
import { createModel } from "../src/ai/model.ts";
import { recordDelivery } from "../src/whatsapp-delivery.ts";
import {
  serviceMenu,
  languageMenu,
  messageControl,
  privateAction,
  planMessage,
  whatsappCopy,
} from "../src/whatsapp-ui.ts";
import { sendWhatsApp } from "../src/whatsapp.ts";

const env = {
  PUBLIC_ORIGIN: "https://paywella.example",
  WHATSAPP_APP_SECRET: "offline-isolated-secret",
  WHATSAPP_BUSINESS_ID: "10001",
  WHATSAPP_PHONE_NUMBER_ID: "10002",
  WHATSAPP_ACCESS_TOKEN: "offline-isolated-fixture",
};
const secret = "offline-separate-whatsapp-journey-encryption";

test("signed WhatsApp controls show services, actual reserved balance and private settings without losing unfinished conversation or calling a model", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let modelCalls = 0;
  const agent = new Agent(
    core,
    {
      provider: "offline-fixture",
      async complete() {
        modelCalls++;
        return { text: "I can help with that question.", calls: [] };
      },
    },
    secret,
  );
  const sent: any[] = [];
  const worker = new Worker(core, agent, env, async (_url, init) => {
    const data = JSON.parse(init!.body as string);
    if (data.type) sent.push(data);
    return Response.json({
      messages: [{ id: "wamid.fixture-" + sent.length }],
    });
  });
  const server = createApp(core, agent, env);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  let sequence = 0;
  async function message(value: Record<string, unknown>) {
    const raw = JSON.stringify({
      entry: [
        {
          id: env.WHATSAPP_BUSINESS_ID,
          changes: [
            {
              value: {
                metadata: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
                messages: [
                  {
                    from: "2348000000001",
                    id: "control-" + ++sequence,
                    ...value,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const response = await fetch(base + "/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "x-hub-signature-256":
          "sha256=" +
          createHmac("sha256", env.WHATSAPP_APP_SECRET)
            .update(raw)
            .digest("hex"),
      },
      body: raw,
    });
    assert.equal(response.status, 200);
    await worker.turn();
    await worker.outbound();
    return sent.at(-1);
  }
  const select = (id: string) =>
    message({ type: "interactive", interactive: { list_reply: { id } } });
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    await core.put(db, owner + ":conversation", owner, "conversation", {
      sealed: agent.seal({
        unfinished: ["Send 2000 to 0123456789"],
        messages: [],
      }),
      updatedAt: new Date().toISOString(),
    });
    const before = (await core.records(owner, "conversation"))[0].sealed;
    let reply = await message({ type: "text", text: { body: "Main menu" } });
    assert.equal(reply.interactive.action.button, "Choose service");
    assert.equal(reply.interactive.action.sections[0].rows.length, 9);
    const plan = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    await core.approve(owner, plan.plan.id, 1, "1234");
    reply = await select("service:balance");
    assert.match(reply.text.body, /498,000\.00/);
    assert.match(reply.text.body, /2,000\.00/);
    reply = await select("service:funding");
    assert.match(
      reply.text.body,
      new RegExp((await core.fundingDetails(owner)).accountNumber),
    );
    assert.match(reply.text.body, /Do not send real money/);
    assert.doesNotMatch(reply.text.body, /how much/i);
    reply = await message({
      type: "interactive",
      interactive: { button_reply: { id: "service:settings" } },
    });
    assert.equal(reply.interactive.action.sections[0].rows.length, 5);
    assert.equal(
      reply.interactive.action.sections[1].rows[0].id,
      "service:account",
    );
    reply = await select("service:account");
    const url = reply.interactive.action.parameters.url;
    assert.equal(new URL(url).searchParams.get("view"), "settings");
    assert.ok(new URL(url).hash.length > 20);
    reply = await select("lang:pcm");
    assert.match(reply.text.body, /Pidgin/);
    reply = await select("service:menu");
    assert.match(reply.interactive.body.text, /Wetin/);
    assert.equal((await core.records(owner, "conversation"))[0].sealed, before);
    assert.equal(modelCalls, 0);
    await message({
      type: "text",
      text: { body: "Can I afford to buy a laptop?" },
    });
    assert.equal(modelCalls, 1);
    assert.equal((await core.plan(owner, plan.plan.id)).status, "RUNNING");
  } finally {
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test("account opening queues one localized welcome with the full funding number and a directly usable service list", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    agent = new Agent(core, createModel({}), secret);
  const sent: any[] = [],
    worker = new Worker(core, agent, env, async (_url, init) => {
      sent.push(JSON.parse(init!.body as string));
      return Response.json({ messages: [{ id: "wamid.welcome" }] });
    });
  try {
    const owner = await core.userForPhone("2348000000001");
    await db.query("UPDATE users SET language='pcm' WHERE id=$1", [owner]);
    await core.setup(owner, "Ada Example", "1234");
    await assert.rejects(() => core.setup(owner, "Ada Example", "1234"));
    await worker.welcome();
    await worker.welcome();
    await worker.outbound();
    await worker.outbound();
    assert.equal(sent.length, 1);
    assert.match(sent[0].interactive.body.text, /account don ready/);
    assert.match(
      sent[0].interactive.body.text,
      new RegExp((await core.fundingDetails(owner)).accountNumber),
    );
    assert.equal(sent[0].interactive.action.sections[0].rows.length, 9);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await worker.stop();
    await db.close();
  }
});

test("all five language menus fit WhatsApp limits, while long reviews keep their full text and completed groups are never described as uncharged drafts", async () => {
  for (const language of ["en", "pcm", "yo", "ig", "ha"]) {
    const c = whatsappCopy(language);
    for (const menu of [serviceMenu(language), languageMenu(language)]) {
      assert.ok(menu.body.text.length <= 1024);
      assert.ok(menu.action.button.length <= 20);
      assert.ok(menu.action.sections.flatMap((s) => s.rows).length <= 10);
      assert.ok(
        menu.action.sections
          .flatMap((s) => s.rows)
          .every((row) => row.title.length <= 24),
      );
    }
    assert.ok(c.open.length <= 20);
    assert.ok(c.review.length <= 20);
  }
  assert.equal(
    messageControl({
      type: "text",
      text: { body: "I want settings for my rent savings" },
    }),
    null,
  );
  assert.equal(
    messageControl({
      type: "text",
      interactive: { list_reply: { id: "service:balance" } },
    }),
    null,
  );
  assert.equal(
    messageControl({
      type: "interactive",
      interactive: { list_reply: { id: "service:execute" } },
    }),
    null,
  );
  assert.equal(
    privateAction(
      "a".repeat(1025),
      "https://paywella.example/open#private",
      "Review",
    ),
    undefined,
  );
  let called = false;
  await assert.rejects(() =>
    sendWhatsApp(env, "2348000000001", "a".repeat(4001), async () => {
      called = true;
      return Response.json({});
    }),
  );
  assert.equal(called, false);
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const prepared = await core.prepare(owner, {
      tasks: [
        {
          kind: "bank_transfer",
          bankCode: "opay",
          accountNumber: "0123456789",
          amountKobo: 200000,
        },
      ],
    });
    assert.match(planMessage(prepared.plan, "en"), /0123456789/);
    assert.match(planMessage(prepared.plan, "en"), /Total fees/);
    await core.approve(owner, prepared.plan.id, 1, "1234");
    await core.drain();
    const completed = planMessage(
      await core.plan(owner, prepared.plan.id),
      "en",
    );
    assert.match(completed, /SETTLED/);
    assert.doesNotMatch(completed, /No money has moved/);
  } finally {
    await db.close();
  }
});

test("definitively rejected message sends back off safely; ambiguous network outcomes and reclaimed sends are never automatically repeated", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    agent = new Agent(core, createModel({}), secret);
  let mode = "rate",
    calls = 0;
  const worker = new Worker(core, agent, env, async () => {
    calls++;
    if (mode === "rate")
      return Response.json({ error: { code: 130429 } }, { status: 429 });
    if (mode === "timeout") throw Error("lost acknowledgement");
    if (mode === "blocked") return Response.json({}, { status: 401 });
    return Response.json({ messages: [{ id: "wamid.accepted" }] });
  });
  try {
    const owner = await core.userForPhone("2348000000001");
    const queue = (id: string) =>
      core.enqueue(db, id, "outbox", owner, {
        sealed: agent.seal({
          to: "2348000000001",
          text: "Your private review is ready.",
        }),
      });
    const job = async (id: string) =>
      (await db.query("SELECT * FROM jobs WHERE id=$1", [id])).rows[0];
    await queue("rate");
    await worker.outbound();
    assert.equal((await job("rate")).status, "QUEUED");
    await worker.outbound();
    assert.equal(calls, 1);
    await db.query("UPDATE jobs SET lease_until='2000-01-01' WHERE id='rate'");
    mode = "ok";
    await worker.outbound();
    assert.equal((await job("rate")).status, "DONE");
    assert.equal(
      (await core.records(owner, "whatsapp_delivery"))[0].status,
      "accepted",
    );
    mode = "timeout";
    await queue("unknown");
    await worker.outbound();
    assert.equal((await job("unknown")).status, "UNKNOWN");
    const after = calls;
    await worker.outbound();
    assert.equal(calls, after);
    await queue("crashed");
    await db.query(
      "UPDATE jobs SET status='RUNNING',attempts=1,lease_until='2000-01-01' WHERE id='crashed'",
    );
    await worker.outbound();
    assert.equal((await job("crashed")).status, "UNKNOWN");
    assert.equal(calls, after);
    mode = "blocked";
    await queue("blocked");
    await worker.outbound();
    assert.equal((await job("blocked")).status, "BLOCKED");
    await db.query(
      "UPDATE jobs SET created_at='2000-01-01' WHERE id='blocked'",
    );
    await core.cleanup();
    assert.deepEqual(JSON.parse((await job("blocked")).payload), {});
  } finally {
    await worker.stop();
    await db.close();
  }
});

test("signed delivery webhooks advance monotonically, tolerate status-before-ack and never change funds or create accounts for unknown recipients", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    agent = new Agent(core, createModel({}), secret),
    server = createApp(core, agent, env);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  async function status(state: string, phone = "2348000000001", signed = true) {
    const raw = JSON.stringify({
      entry: [
        {
          id: env.WHATSAPP_BUSINESS_ID,
          changes: [
            {
              value: {
                metadata: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
                statuses: [
                  {
                    id: "wamid.delivery",
                    recipient_id: phone,
                    status: state,
                    errors: [
                      {
                        code: 131026,
                        message: "Do not persist raw provider details",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return fetch(base + "/webhooks/whatsapp", {
      method: "POST",
      body: raw,
      headers: {
        "x-hub-signature-256": signed
          ? "sha256=" +
            createHmac("sha256", env.WHATSAPP_APP_SECRET)
              .update(raw)
              .digest("hex")
          : "sha256=" + "0".repeat(64),
      },
    });
  }
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    assert.equal((await status("read", "2348000000001", false)).status, 403);
    assert.equal((await core.records(owner, "whatsapp_delivery")).length, 0);
    assert.equal((await status("read")).status, 200);
    await db.transaction((q) =>
      recordDelivery(q, owner, "wamid.delivery", "accepted", {
        jobId: "out:fixture",
      }),
    );
    for (const s of ["delivered", "sent", "failed", "read"])
      assert.equal((await status(s)).status, 200);
    const delivery = (await core.records(owner, "whatsapp_delivery"))[0];
    assert.equal(delivery.status, "read");
    assert.equal(delivery.jobId, "out:fixture");
    assert.equal(JSON.stringify(delivery).includes("Do not persist"), false);
    await status("delivered", "2348000000002");
    assert.equal((await db.query("SELECT id FROM users")).rows.length, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test("receipt upload failures retry before sending; a lost send acknowledgement never repeats the receipt or the payment", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    agent = new Agent(core, createModel({}), secret);
  let mode = "upload-failure",
    uploads = 0,
    sends = 0;
  const worker = new Worker(core, agent, env, async (url) => {
    if (String(url).endsWith("/media")) {
      uploads++;
      return mode === "upload-failure"
        ? Response.json({}, { status: 500 })
        : Response.json({ id: "123456" });
    }
    sends++;
    if (mode === "send-timeout") throw Error("acknowledgement lost");
    return Response.json({ messages: [{ id: "wamid.receipt-" + sends }] });
  });
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const prepare = async (name: string) => {
      const p = await core.prepare(owner, {
        tasks: [{ kind: "goal_create", name, amountKobo: 200000 }],
      });
      await core.approve(owner, p.plan.id, 1, "1234");
      await core.drain();
      return p;
    };
    await prepare("Rent");
    await worker.receipt();
    let job = (await db.query("SELECT * FROM jobs WHERE kind='receipt'"))
      .rows[0];
    assert.equal(job.status, "QUEUED");
    assert.equal(uploads, 1);
    assert.equal(sends, 0);
    mode = "ok";
    await db.query("UPDATE jobs SET lease_until='2000-01-01' WHERE id=$1", [
      job.id,
    ]);
    await worker.receipt();
    await worker.receipt();
    assert.equal(uploads, 2);
    assert.equal(sends, 1);
    await prepare("Laptop");
    mode = "send-timeout";
    await worker.receipt();
    await worker.receipt();
    assert.equal(sends, 2);
    job = (
      await db.query(
        "SELECT * FROM jobs WHERE kind='receipt' AND status='UNKNOWN'",
      )
    ).rows[0];
    assert.ok(job);
    const workspace = await core.workspace(owner);
    assert.equal(workspace.balanceKobo, 49600000);
    assert.equal(workspace.receipts.length, 2);
    assert.equal(
      workspace.receipts.every((r) => r.status === "SETTLED"),
      true,
    );
  } finally {
    await worker.stop();
    await db.close();
  }
});
