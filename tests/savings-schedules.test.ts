import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { runSchedules, cancelSchedule } from "../src/savings-schedules.ts";
import { lagosDate } from "../src/ajo-allocation.ts";
import { connectTools } from "../src/ai/mcp.ts";
import { receiptImage } from "../src/receipt-image.ts";
import { Agent } from "../src/ai/agent.ts";
import { createModel } from "../src/ai/model.ts";
import { createApp } from "../src/server.ts";
import { createCapability } from "../src/security.ts";
import { once } from "node:events";
const date = (days: number) => lagosDate(Date.now() + days * 86400000);
const at = (value: string, hour = "09") =>
  Date.parse(value + "T" + hour + ":00:00+01:00");
test("the private HTTP approval requires explicit recurring consent as well as the existing transaction PIN", async () => {
  const { db, core, owner, p } = await fixture();
  const origin = "https://paywella.example",
    server = createApp(
      core,
      new Agent(
        core,
        createModel({}),
        "offline-private-recurring-consent-secret",
      ),
      { PUBLIC_ORIGIN: origin },
    );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const post = (path: string, body: unknown, cookie = "") =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const exchange = await post("exchange", {
        token: await createCapability(db, owner, "review", p.plan.id, 1),
      }),
      cookie = exchange.headers.get("set-cookie")!;
    const path = "plans/" + p.plan.id + "/approve";
    assert.equal(
      (await post(path, { pin: "1234", revision: 1 }, cookie)).status,
      400,
    );
    assert.equal(
      (
        await post(
          path,
          { pin: "0000", revision: 1, standingConsent: true },
          cookie,
        )
      ).status,
      401,
    );
    assert.equal((await core.workspace(owner)).schedules.length, 0);
    assert.equal(
      (
        await post(
          path,
          { pin: "1234", revision: 1, standingConsent: true },
          cookie,
        )
      ).status,
      202,
    );
    await core.drain();
    assert.equal((await core.workspace(owner)).schedules.length, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
async function fixture(
  amountKobo = 200000,
  frequency: "daily" | "weekly" = "daily",
) {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    owner = await core.userForPhone("2348000000001");
  await core.setup(owner, "Ada Example", "1234");
  const request = {
    kind: "goal_schedule" as const,
    name: "Rent",
    amountKobo,
    frequency,
    startDate: date(1),
    endDate: date(16),
  };
  const p = await core.prepare(owner, { tasks: [request] });
  return { db, core, owner, request, p };
}
test("a bounded recurring instruction needs explicit private consent and PIN; concurrent due runs debit once and create normal grouped receipts", async () => {
  const { db, core, owner, p, request } = await fixture();
  try {
    assert.equal(p.plan.spec[0].amountKobo, 0);
    assert.equal(p.plan.spec[0].savingsSchedule!.maximumRuns, 16);
    await assert.rejects(
      () => core.approve(owner, p.plan.id, 1, "1234"),
      /SCHEDULE_CONSENT_REQUIRED/,
    );
    assert.equal((await core.workspace(owner)).schedules.length, 0);
    await core.approve(owner, p.plan.id, 1, "1234", true);
    await core.drain();
    const before = await core.workspace(owner);
    assert.equal(before.balanceKobo, 50000000);
    assert.equal(before.goals[0].balanceKobo, 0);
    assert.equal(before.schedules.length, 1);
    const receipt = before.receipts[0];
    assert.equal(receipt.kind, "goal_schedule");
    assert.equal(
      receiptImage(receipt).subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
    await runSchedules(core, at(request.startDate, "08"));
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
    await Promise.all([
      runSchedules(core, at(request.startDate)),
      runSchedules(core, at(request.startDate)),
    ]);
    const after = await core.workspace(owner);
    assert.equal(after.balanceKobo, 49800000);
    assert.equal(after.goals[0].balanceKobo, 200000);
    const run = after.savingsRuns.find((r) => r.status === "SETTLED")!;
    const plan = await core.plan(owner, run.planId);
    assert.equal(plan.status, "SUCCEEDED");
    assert.equal(plan.tasks.length, 1);
    assert.equal(
      after.receipts.filter((r) => r.kind === "goal_deposit").length,
      1,
    );
    await cancelSchedule(core, owner, after.schedules[0].id);
    await runSchedules(core, at(date(2)));
    assert.equal((await core.workspace(owner)).balanceKobo, 49800000);
  } finally {
    await db.close();
  }
});
test("insufficient spendable funds skip a run without touching a pending reservation or retrying it after later funding", async () => {
  const { db, core, owner, p, request } = await fixture(49900000);
  try {
    await core.approve(owner, p.plan.id, 1, "1234", true);
    await core.drain();
    const hold = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Laptop", amountKobo: 200000 }],
    });
    await core.approve(owner, hold.plan.id, 1, "1234");
    await runSchedules(core, at(request.startDate));
    let workspace = await core.workspace(owner);
    assert.equal(workspace.balanceKobo, 50000000);
    assert.equal(workspace.availableKobo, 49800000);
    assert.equal(workspace.savingsRuns[0].status, "SKIPPED_INSUFFICIENT_FUNDS");
    await core.drain();
    await runSchedules(core, at(request.startDate, "12"));
    workspace = await core.workspace(owner);
    assert.equal(workspace.balanceKobo, 49800000);
    assert.equal(
      workspace.goals.find((g) => g.name === "Rent")!.balanceKobo,
      0,
    );
    assert.equal(workspace.savingsRuns.length, 1);
  } finally {
    await db.close();
  }
});
test("offline days are recorded as skipped instead of catch-up debits, and weekly end dates bound the authorization", async () => {
  const { db, core, owner, p, request } = await fixture(100000, "weekly");
  try {
    await core.approve(owner, p.plan.id, 1, "1234", true);
    await core.drain();
    await runSchedules(core, at(date(15)));
    let workspace = await core.workspace(owner);
    assert.equal(workspace.balanceKobo, 49900000);
    assert.equal(
      workspace.savingsRuns.find((r) => r.status === "SKIPPED_OFFLINE")!
        .missedRuns,
      2,
    );
    assert.equal(workspace.schedules[0].status, "COMPLETED");
    await runSchedules(core, at(date(30)));
    workspace = await core.workspace(owner);
    assert.equal(workspace.balanceKobo, 49900000);
    assert.equal(p.plan.spec[0].savingsSchedule!.maximumRuns, 3);
  } finally {
    await db.close();
  }
});
test("a changed schedule requires a new authorized replacement; cancellation and access remain owner scoped over MCP", async () => {
  const { db, core, owner, p, request } = await fixture();
  let tools: Awaited<ReturnType<typeof connectTools>> | undefined;
  try {
    await core.approve(owner, p.plan.id, 1, "1234", true);
    await core.drain();
    const original = (await core.workspace(owner)).schedules[0];
    const other = await core.userForPhone("2348000000002");
    await core.setup(other, "Bisi Example", "4321");
    await assert.rejects(
      () => cancelSchedule(core, other, original.id),
      /NOT_FOUND/,
    );
    const replacement = await core.prepare(owner, {
      tasks: [{ ...request, amountKobo: 300000, replacesId: original.id }],
    });
    await assert.rejects(
      () => core.approve(owner, replacement.plan.id, 1, "1234"),
      /SCHEDULE_CONSENT_REQUIRED/,
    );
    await core.approve(owner, replacement.plan.id, 1, "1234", true);
    await core.drain();
    const workspace = await core.workspace(owner);
    assert.equal(
      workspace.schedules.filter((s) => s.status === "ACTIVE").length,
      1,
    );
    assert.equal(
      workspace.schedules.find((s) => s.id === original.id)!.status,
      "CANCELLED",
    );
    await runSchedules(core, at(request.startDate));
    assert.equal((await core.workspace(owner)).balanceKobo, 49700000);
    tools = await connectTools(core, owner, () => {});
    const list = await tools.call("list_savings_schedules", {});
    const active = list.schedules.find((s: any) => s.status === "ACTIVE");
    const cancelled = await tools.call("cancel_savings_schedule", {
      id: active.id,
    });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.previousTransfersReversed, false);
  } finally {
    await tools?.close();
    await db.close();
  }
});
test("named schedules and one-time savings share one new goal even when separately approved before either executes", async () => {
  const { db, core, owner, p } = await fixture();
  try {
    await core.approve(owner, p.plan.id, 1, "1234", true);
    const deposit = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 100000 }],
    });
    await core.approve(owner, deposit.plan.id, 1, "1234");
    await Promise.all([core.drain(), core.drain()]);
    const workspace = await core.workspace(owner);
    assert.equal(workspace.goals.length, 1);
    assert.equal(workspace.goals[0].balanceKobo, 100000);
    assert.equal(workspace.schedules[0].goalId, workspace.goals[0].id);
  } finally {
    await db.close();
  }
});
