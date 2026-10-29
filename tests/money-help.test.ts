import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { connectTools } from "../src/ai/mcp.ts";
import { recordDelivery } from "../src/whatsapp-delivery.ts";

test("MCP affordability uses fresh spendable funds, respects pending reservations and a requested buffer, and cannot reserve or spend money", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let tools: Awaited<ReturnType<typeof connectTools>> | undefined;
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    tools = await connectTools(core, owner, () => {});
    const listed = await tools.client.listTools();
    assert.equal(
      listed.tools.find((t) => t.name === "check_affordability")?.annotations
        ?.readOnlyHint,
      true,
    );
    let result = await tools.call("check_affordability", {
      priceKobo: 45000000,
      keepAvailableKobo: 5000000,
    });
    assert.equal(result.canAfford, true);
    assert.equal(result.remainingAfterPurchaseKobo, 5000000);
    const plan = await core.prepare(owner, {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 10000000 }],
    });
    await core.approve(owner, plan.plan.id, 1, "1234");
    result = await tools.call("check_affordability", {
      priceKobo: 35000000,
      keepAvailableKobo: 6000000,
    });
    assert.equal(result.availableKobo, 40000000);
    assert.equal(result.canAfford, false);
    assert.equal(result.shortfallKobo, 1000000);
    assert.equal(result.fundsReserved, false);
    assert.equal(result.paymentAuthorized, false);
    assert.equal(
      (await tools.call("check_affordability", { priceKobo: -100 })).error,
      "INVALID_TOOL_ARGUMENTS",
    );
    assert.equal(
      (
        await tools.call("check_affordability", {
          owner: "someone-else",
          priceKobo: 100,
        })
      ).error,
      "INVALID_TOOL_ARGUMENTS",
    );
    const beforeSettlement = await core.workspace(owner);
    assert.equal(beforeSettlement.balanceKobo, 50000000);
    assert.equal(beforeSettlement.availableKobo, 40000000);
    await core.drain();
    result = await tools.call("check_affordability", { priceKobo: 45000000 });
    assert.equal(result.availableKobo, 40000000);
    assert.equal(result.canAfford, false);
    assert.equal((await core.workspace(owner)).goals[0].balanceKobo, 10000000);
  } finally {
    await tools?.close();
    await db.close();
  }
});

test("MCP receipt support distinguishes settled money from unconfirmed delivery and refuses another customer's receipt", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let tools: Awaited<ReturnType<typeof connectTools>> | undefined;
  try {
    const owner = await core.userForPhone("2348000000001"),
      other = await core.userForPhone("2348000000002");
    await core.setup(owner, "Ada Example", "1234");
    await core.setup(other, "Bisi Example", "4321");
    const prepare = async (id: string, pin: string) => {
      const p = await core.prepare(id, {
        tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
      });
      await core.approve(id, p.plan.id, 1, pin);
      await core.drain();
      return p;
    };
    const p = await prepare(owner, "1234");
    await prepare(other, "4321");
    const receipt = (await core.workspace(owner)).receipts[0],
      otherReceipt = (await core.workspace(other)).receipts[0];
    const jobId = "receipt:" + p.plan.spec[0].id;
    await db.query("UPDATE jobs SET status='DONE' WHERE id=$1", [jobId]);
    await db.transaction((q) =>
      recordDelivery(q, owner, "wamid.private-receipt", "accepted", { jobId }),
    );
    tools = await connectTools(core, owner, () => {});
    let result = await tools.call("get_notification_status", {
      receiptId: receipt.id,
    });
    assert.equal(result.paymentStatus, "SETTLED");
    assert.equal(result.privateReceiptAvailable, true);
    assert.equal(result.notifications.length, 1);
    assert.equal(result.notifications[0].processingStatus, "DONE");
    assert.equal(result.notifications[0].deliveryStatus, "accepted");
    assert.equal(
      JSON.stringify(result).includes("wamid.private-receipt"),
      false,
    );
    await db.transaction((q) =>
      recordDelivery(q, owner, "wamid.private-receipt", "read"),
    );
    result = await tools.call("get_notification_status", {
      receiptId: receipt.id,
    });
    assert.equal(result.notifications[0].deliveryStatus, "read");
    assert.equal(
      (
        await tools.call("get_notification_status", {
          receiptId: otherReceipt.id,
        })
      ).error,
      "NOT_FOUND",
    );
    assert.equal((await core.workspace(owner)).balanceKobo, 49800000);
    assert.equal((await core.workspace(other)).balanceKobo, 49800000);
  } finally {
    await tools?.close();
    await db.close();
  }
});
