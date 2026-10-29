import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { SandboxRail } from "../src/providers/sandbox.ts";
import { Agent } from "../src/ai/agent.ts";
import type { Model } from "../src/ai/model.ts";
import { Worker } from "../src/worker.ts";
import { createApp } from "../src/server.ts";

test("signed WhatsApp voice note → one editable private review → one approval → partial/pending recovery → web and WhatsApp receipts", async () => {
  const db = await openStore({ file: ":memory:" }),
    rail = new SandboxRail(),
    core = new Core(db, rail);
  const env = {
    PUBLIC_ORIGIN: "https://paywella.example",
    WHATSAPP_APP_SECRET: "offline-webhook-secret",
    WHATSAPP_BUSINESS_ID: "10001",
    WHATSAPP_PHONE_NUMBER_ID: "10002",
    WHATSAPP_ACCESS_TOKEN: "offline-fixture",
    GEMINI_API_KEY: "offline-fixture",
  };
  const sent: any[] = [];
  let mediaCalls = 0,
    modelCalls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    if (address.includes("graph.facebook.com") && address.endsWith("/9999"))
      return Response.json({
        url: "https://lookaside.fbsbx.com/fixture",
        mime_type: "audio/ogg",
        file_size: 12,
      });
    if (address === "https://lookaside.fbsbx.com/fixture")
      return new Response("OggSfixture");
    if (address.includes("generativelanguage.googleapis.com")) {
      mediaCalls++;
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    kind: "audio",
                    transcript:
                      "Press my mama 2k for OP. Her aza na 0123456789. Save 3k for Rent and 2k for Laptop.",
                    unclear: false,
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    if (address.endsWith("/media")) return Response.json({ id: "123456" });
    if (address.endsWith("/messages")) {
      const message = JSON.parse(init!.body as string);
      if (message.type) sent.push(message);
      else {
        assert.equal(message.status, "read");
        assert.equal(message.typing_indicator.type, "text");
      }
      return Response.json({
        messages: [{ id: "offline-response-" + sent.length }],
      });
    }
    throw Error("Unexpected outbound request");
  };
  const model: Model = {
    provider: "offline-contract-fixture",
    async complete(messages) {
      modelCalls++;
      const text = messages.at(-1)!.content;
      assert.match(text, /0123456789/);
      assert.match(text, /Save 3k for Rent/);
      return {
        text: "",
        calls: [
          {
            id: "group",
            name: "prepare_plan",
            arguments: {
              tasks: [
                {
                  kind: "bank_transfer",
                  bankCode: "opay",
                  accountNumber: "0123456789",
                  amountKobo: 200000,
                },
                { kind: "goal_create", name: "Rent", amountKobo: 300000 },
                { kind: "goal_create", name: "Laptop", amountKobo: 200000 },
              ],
            },
          },
        ],
      };
    },
  };
  const agent = new Agent(
      core,
      model,
      "offline-secret-for-isolated-end-to-end",
    ),
    worker = new Worker(core, agent, env, fetcher),
    server = createApp(core, agent, env);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const post = (path: string, body: unknown, cookie = "") =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: {
        origin: env.PUBLIC_ORIGIN,
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify(body),
    });
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const event = {
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
                      id: "wamid.offline-e2e",
                      type: "audio",
                      audio: { id: "9999" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      raw = JSON.stringify(event),
      signature =
        "sha256=" +
        createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
    const inbound = () =>
      fetch(base + "/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        body: raw,
      });
    assert.equal((await inbound()).status, 200);
    assert.equal((await inbound()).status, 200);
    assert.equal(mediaCalls, 0);
    assert.equal(modelCalls, 0);
    assert.equal(
      (await db.query("SELECT id FROM jobs WHERE kind='agent'")).rows.length,
      1,
    );
    await worker.turn();
    await worker.outbound();
    assert.equal(mediaCalls, 1);
    assert.equal(modelCalls, 1);
    const body = sent[0].interactive?.body.text || sent[0].text.body;
    assert.match(body, /0123456789/);
    assert.match(body, /Laptop/);
    assert.match(body, /No money has moved/);
    const link =
        sent[0].interactive?.action.parameters.url ||
        sent[0].text.body.split("\n").at(-1),
      exchange = await post("exchange", { token: new URL(link).hash.slice(1) }),
      cookie = exchange.headers.get("set-cookie")!;
    const target = (await exchange.json()).target;
    const review = await (
      await fetch(base + "/api/plans/" + target, { headers: { cookie } })
    ).json();
    assert.equal(review.spec.length, 3);
    const revised = await post(
      "plans/" + target + "/edit",
      {
        revision: 1,
        tasks: review.spec.map((row: any, index: number) =>
          index === 0
            ? { ...row.input, bankCode: "wema", accountNumber: "1234567890" }
            : row.input,
        ),
      },
      cookie,
    );
    assert.equal(revised.status, 200);
    const changed = await revised.json();
    assert.equal(changed.revision, 2);
    assert.match(changed.spec[0].destination, /Wema Bank · 1234567890/);
    assert.equal(
      (
        await post(
          "plans/" + target + "/approve",
          { revision: 1, pin: "1234" },
          cookie,
        )
      ).status,
      409,
    );
    const bankTask = changed.spec[0].id;
    rail.outcomes.set(bankTask, { status: "pending" });
    assert.equal(
      (
        await post(
          "plans/" + target + "/approve",
          { revision: 2, pin: "1234" },
          cookie,
        )
      ).status,
      202,
    );
    await core.drain();
    let plan = await core.plan(owner, target);
    assert.equal(plan.status, "PENDING");
    assert.equal(plan.tasks.filter((t) => t.status === "SETTLED").length, 2);
    assert.equal((await core.workspace(owner)).balanceKobo, 49500000);
    assert.equal((await core.workspace(owner)).availableKobo, 49300000);
    rail.outcomes.set(bankTask, { status: "settled" });
    await db.query(
      "UPDATE jobs SET lease_until='2000-01-01' WHERE kind='task'",
    );
    await core.drain();
    plan = await core.plan(owner, target);
    assert.equal(plan.status, "SUCCEEDED");
    for (const task of plan.tasks) {
      const png = await fetch(base + "/api/receipts/" + task.receipt + ".png", {
        headers: { cookie },
      });
      assert.equal(png.status, 200);
      assert.equal(
        Buffer.from(await png.arrayBuffer())
          .subarray(0, 8)
          .toString("hex"),
        "89504e470d0a1a0a",
      );
      await worker.receipt();
    }
    assert.equal(sent.filter((message) => message.type === "image").length, 3);
    const bankReceipt = await (
      await fetch(base + "/api/receipts/" + plan.tasks[0].receipt, {
        headers: { cookie },
      })
    ).json();
    assert.match(bankReceipt.destination, /1234567890/);
    assert.equal(
      (
        await post(
          "plans/" + target + "/approve",
          { revision: 2, pin: "1234" },
          cookie,
        )
      ).status,
      202,
    );
    await core.drain();
    assert.equal(rail.submissions.size, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 49300000);
  } finally {
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});

test("a slow assistant cannot block payment settlement or receipt delivery in another worker lane", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    waiting = new Promise<void>((resolve) => (release = resolve));
  const agent = new Agent(
      core,
      {
        provider: "offline-fixture",
        async complete() {
          entered();
          await waiting;
          return { text: "Ready to help.", calls: [] };
        },
      },
      "offline-isolated-worker-lane-secret",
    ),
    worker = new Worker(core, agent, {});
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    await core.enqueue(db, "slow-agent", "agent", owner, {
      sealed: agent.seal({ text: "What can you do?", channel: "web" }),
    });
    const first = worker.tick();
    await started;
    const review = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    await core.approve(owner, review.plan.id, 1, "1234");
    await worker.tick();
    assert.equal((await core.plan(owner, review.plan.id)).status, "SUCCEEDED");
    release();
    await first;
  } finally {
    release?.();
    await worker.stop();
    await db.close();
  }
});
