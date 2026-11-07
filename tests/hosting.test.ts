import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { Worker } from "../src/worker.ts";
import { BackgroundRunner } from "../src/background.ts";
import { createRequestHandler } from "../src/server.ts";
import { future } from "../src/security.ts";

async function fixture() {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  const agent = new Agent(
    core,
    {
      provider: "offline-hosting-fixture",
      async complete() {
        return { text: "How can I help?", calls: [] };
      },
    },
    "offline-secret-for-request-driven-hosting",
  );
  const worker = new Worker(core, agent, {});
  worker.lastScheduleCheck = Date.now();
  return { db, core, agent, worker, runner: new BackgroundRunner(worker) };
}

test("an idle invocation probes once, makes no claim transactions and stops all database traffic", async () => {
  const f = await fixture();
  let queries = 0,
    transactions = 0;
  const query = f.db.query.bind(f.db),
    transaction = f.db.transaction.bind(f.db);
  f.db.query = (...args) => {
    queries++;
    return query(...args);
  };
  f.db.transaction = async (fn) => {
    transactions++;
    return transaction(fn);
  };
  try {
    await f.runner.wake();
    assert.equal(queries, 2);
    assert.equal(transactions, 0);
    await delay(70);
    assert.equal(
      queries,
      2,
      "no interval continues after the request finishes",
    );
    assert.equal(f.worker.busy, false);
  } finally {
    await f.worker.stop();
    await f.db.close();
  }
});

test("a request-driven batch settles once and leaves unapproved drafts untouched", async () => {
  const f = await fixture();
  try {
    const owner = await f.core.userForPhone("2348000000001");
    await f.core.setup(owner, "Ada Example", "1234");
    const prepared = await f.core.prepare(owner, {
      tasks: [
        { kind: "goal_create", name: "Rent", amountKobo: 200000 },
        { kind: "goal_create", name: "Laptop", amountKobo: 300000 },
      ],
    });
    await f.runner.wake();
    assert.equal((await f.core.plan(owner, prepared.plan.id)).status, "READY");
    await f.core.approve(owner, prepared.plan.id, 1, "1234");
    await Promise.all([f.runner.wake(), f.runner.wake(), f.runner.wake()]);
    const result = await f.core.plan(owner, prepared.plan.id);
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.tasks.filter((task: any) => task.receipt).length, 2);
    assert.equal((await f.core.workspace(owner)).balanceKobo, 49500000);
    await f.runner.wake();
    assert.equal((await f.core.workspace(owner)).balanceKobo, 49500000);
  } finally {
    await f.worker.stop();
    await f.db.close();
  }
});

test("near-term retries are drained but distant retries stay durable without keeping a function alive", async () => {
  const f = await fixture();
  try {
    const owner = await f.core.userForPhone("2348000000001");
    await f.core.setup(owner, "Ada Example", "1234");
    const prepared = await f.core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    await f.core.approve(owner, prepared.plan.id, 1, "1234");
    await f.db.query("UPDATE jobs SET lease_until=$1 WHERE kind='task'", [
      future(40),
    ]);
    await new BackgroundRunner(f.worker, 1000, 100).wake();
    assert.equal(
      (await f.core.plan(owner, prepared.plan.id)).status,
      "SUCCEEDED",
    );
    const later = await f.core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "School", amountKobo: 100000 }],
    });
    await f.core.approve(owner, later.plan.id, 1, "1234");
    await f.db.query(
      "UPDATE jobs SET lease_until=$1 WHERE kind='task' AND status='QUEUED'",
      [future(60000)],
    );
    await new BackgroundRunner(f.worker, 1000, 100).wake();
    assert.equal((await f.core.plan(owner, later.plan.id)).status, "RUNNING");
    assert.equal(
      (
        await f.db.query(
          "SELECT id FROM jobs WHERE status='QUEUED' AND kind='task'",
        )
      ).rows.length,
      1,
    );
  } finally {
    await f.worker.stop();
    await f.db.close();
  }
});

test("signed WhatsApp and private approval requests wake durable work without a server loop", async () => {
  const f = await fixture(),
    origin = "https://paywella.example";
  const env = {
    PUBLIC_ORIGIN: origin,
    WHATSAPP_APP_SECRET: "offline-signature",
    WHATSAPP_BUSINESS_ID: "10001",
    WHATSAPP_PHONE_NUMBER_ID: "10002",
  };
  let scheduled = 0,
    pending: Promise<void> = Promise.resolve();
  const server = createServer(
    createRequestHandler(f.core, f.agent, env, () => {
      scheduled++;
      pending = f.runner.wake();
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const post = (path: string, data: unknown, cookie = "") =>
    fetch(base + path, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    const owner = await f.core.userForPhone("2348000000001");
    await f.core.setup(owner, "Ada Example", "1234");
    const raw = JSON.stringify({
      entry: [
        {
          id: "10001",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "10002" },
                messages: [
                  {
                    id: "request-driven-message",
                    from: "2348000000001",
                    type: "text",
                    text: { body: "Hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature =
      "sha256=" +
      createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
    assert.equal(
      (
        await fetch(base + "/webhooks/whatsapp", {
          method: "POST",
          headers: { "x-hub-signature-256": "sha256=bad" },
          body: raw,
        })
      ).status,
      403,
    );
    assert.equal(scheduled, 0);
    assert.equal(
      (
        await fetch(base + "/webhooks/whatsapp", {
          method: "POST",
          headers: { "x-hub-signature-256": signature },
          body: raw,
        })
      ).status,
      200,
    );
    await pending;
    assert.equal(
      (
        await f.db.query(
          "SELECT status FROM jobs WHERE id='wa:request-driven-message'",
        )
      ).rows[0].status,
      "DONE",
    );
    const cap = await f.core.onboardingLink(owner);
    const exchange = await post("/api/exchange", { token: cap }),
      cookie = exchange.headers.get("set-cookie")!;
    const prepared = await f.core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    const path = "/api/plans/" + prepared.plan.id + "/approve",
      before = scheduled;
    assert.equal(
      (await post(path, { revision: 1, pin: "0000" }, cookie)).status,
      401,
    );
    assert.equal(scheduled, before);
    const approved = await post(path, { revision: 1, pin: "1234" }, cookie);
    assert.equal(approved.status, 202);
    assert.equal(approved.headers.get("cache-control"), "no-store");
    await pending;
    assert.equal(
      (await f.core.plan(owner, prepared.plan.id)).status,
      "SUCCEEDED",
    );
    const font = await fetch(base + "/fonts/Manrope-Regular.ttf");
    assert.equal(font.status, 200);
    assert.match(font.headers.get("cache-control")!, /public, max-age=86400/);
  } finally {
    await pending;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.worker.stop();
    await f.db.close();
  }
});
