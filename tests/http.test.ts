import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { createModel } from "../src/ai/model.ts";
import { createApp } from "../src/server.ts";
test("private links are single-use, cookies are protected, review access is owner-scoped and cross-origin approval is rejected", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    origin = "https://paywella.example",
    agent = new Agent(
      core,
      createModel({}),
      "offline-secret-for-encrypted-test-state",
    ),
    server = createApp(core, agent, { PUBLIC_ORIGIN: origin });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  async function request(path: string, data: unknown, cookie = "") {
    return fetch(base + "/api/" + path, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie },
      body: JSON.stringify(data),
    });
  }
  try {
    const owner = await core.userForPhone("2348000000001"),
      cap = await core.onboardingLink(owner),
      exchange = await request("exchange", { token: cap });
    assert.equal(exchange.status, 200);
    const cookie = exchange.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await request("exchange", { token: cap })).status, 401);
    const setup = await request(
        "setup",
        { name: "Ada Example", pin: "1234", confirmation: "1234" },
        cookie,
      ),
      auth = setup.headers.get("set-cookie")!;
    assert.equal(setup.status, 200);
    assert.equal((await setup.json()).balanceKobo, 50000000);
    const prepared = await request(
      "plans",
      { tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }] },
      auth,
    );
    assert.equal(prepared.status, 201);
    const p = (await prepared.json()).plan;
    const forged = await fetch(base + "/api/plans/" + p.id + "/approve", {
      method: "POST",
      headers: {
        origin: "https://elsewhere.example",
        "content-type": "application/json",
        cookie: auth,
      },
      body: JSON.stringify({ revision: 1, pin: "1234" }),
    });
    assert.equal(forged.status, 403);
    assert.equal((await core.plan(owner, p.id)).status, "READY");
    const accepted = await request(
      "plans/" + p.id + "/approve",
      { revision: 1, pin: "1234" },
      auth,
    );
    assert.equal(accepted.status, 202);
    await core.drain();
    const done = await core.plan(owner, p.id),
      receipt = done.tasks[0].receipt;
    const pdf = await fetch(base + "/api/receipts/" + receipt + ".pdf", {
      headers: { cookie: auth },
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.ok((await pdf.arrayBuffer()).byteLength > 1000);
    const other = await core.userForPhone("2348000000002");
    await core.setup(other, "Tunde Example", "4321");
    const otherPlan = await core.prepare(other, {
      tasks: [{ kind: "goal_create", name: "School", amountKobo: 100000 }],
    });
    assert.equal(
      (
        await fetch(base + "/api/plans/" + otherPlan.plan.id, {
          headers: { cookie: auth },
        })
      ).status,
      404,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
  }
});
