import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { SandboxRail } from "../src/providers/sandbox.ts";
import { balance } from "../src/ledger.ts";
import { checkPin } from "../src/security.ts";
async function fixture() {
  const db = await openStore({ file: ":memory:" }),
    rail = new SandboxRail(),
    core = new Core(db, rail),
    owner = await core.userForPhone("2348000000001");
  await core.setup(owner, "Ada Example", "1234");
  return { db, rail, core, owner };
}
const transfer = {
  kind: "bank_transfer",
  bankCode: "opay",
  accountNumber: "0123456789",
  amountKobo: 200000,
};
test("opening credits once, and concurrent approvals and worker passes cannot duplicate a payment", async () => {
  const { db, core, owner, rail } = await fixture();
  try {
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
    await assert.rejects(() => core.setup(owner, "Ada Example", "1234"));
    const { plan } = await core.prepare(owner, {
      tasks: [
        transfer,
        { kind: "goal_create", name: "Rent", amountKobo: 300000 },
        { kind: "goal_create", name: "Laptop", amountKobo: 100000 },
      ],
    });
    await Promise.all([
      core.approve(owner, plan.id, 1, "1234"),
      core.approve(owner, plan.id, 1, "1234"),
    ]);
    assert.equal((await core.workspace(owner)).availableKobo, 49400000);
    await core.drain();
    await core.drain();
    assert.equal((await core.plan(owner, plan.id)).status, "SUCCEEDED");
    assert.equal((await core.workspace(owner)).balanceKobo, 49400000);
    assert.equal(rail.submissions.size, 1);
    assert.equal(
      (await db.query("SELECT SUM(amount) AS total FROM postings")).rows[0]
        .total,
      0,
    );
    await assert.rejects(() => db.query("DELETE FROM postings"));
    await assert.rejects(() =>
      db.query("UPDATE journals SET reference=$1", ["changed"]),
    );
  } finally {
    await db.close();
  }
});
test("aggregate reservations reject an unaffordable plan and failed PIN attempts remain locked", async () => {
  const { db, core, owner } = await fixture();
  try {
    const { plan } = await core.prepare(owner, {
      tasks: [
        { ...transfer, amountKobo: 30000000 },
        { kind: "goal_create", name: "Rent", amountKobo: 30000000 },
      ],
    });
    await assert.rejects(
      () => core.approve(owner, plan.id, 1, "1234"),
      (e) => (e as any).code === "INSUFFICIENT_FUNDS",
    );
    assert.equal((await core.workspace(owner)).availableKobo, 50000000);
    for (let i = 0; i < 5; i++)
      await assert.rejects(() => checkPin(db, owner, "9999"));
    await assert.rejects(
      () => checkPin(db, owner, "1234"),
      (e) => (e as any).code === "PIN_LOCKED",
    );
    assert.equal((await core.plan(owner, plan.id)).status, "READY");
  } finally {
    await db.close();
  }
});
test("an uncertain provider outcome retains its reservation and reconciles without resubmission", async () => {
  const { db, core, owner, rail } = await fixture();
  try {
    const { plan } = await core.prepare(owner, { tasks: [transfer] });
    rail.outcomes.set(plan.spec[0].id, { status: "pending" });
    await core.approve(owner, plan.id, 1, "1234");
    await core.drain(1);
    assert.equal((await core.plan(owner, plan.id)).status, "PENDING");
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
    assert.equal((await core.workspace(owner)).availableKobo, 49800000);
    rail.outcomes.set(plan.spec[0].id, { status: "settled" });
    await db.query("UPDATE jobs SET lease_until=$1", ["2000-01-01T00:00:00Z"]);
    await core.drain();
    assert.equal((await core.plan(owner, plan.id)).status, "SUCCEEDED");
    assert.equal(rail.submissions.size, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 49800000);
  } finally {
    await db.close();
  }
});
test("cash is an organizer liability, not funded principal; members choose distinct daily rates", async () => {
  const { db, core, owner } = await fixture();
  try {
    await db.query("UPDATE users SET organizer=1 WHERE id=$1", [owner]);
    const book = await core.createBook(owner, "Market savers"),
      member = await core.addMember(owner, book.id, {
        name: "Tunde Example",
        dailyKobo: 20000,
        maturityDate: "2026-10-01",
      });
    const cash = await core.prepare(owner, {
      tasks: [
        {
          kind: "ajo_cash",
          memberId: member.id,
          amountKobo: 100000,
          date: "2026-10-27",
        },
      ],
    });
    await core.approve(owner, cash.plan.id, 1, "1234");
    await core.drain();
    assert.equal(await balance(db, "ajo:" + member.id), 0);
    assert.equal(
      (await core.records(owner, "member"))[0].cashOutstandingKobo,
      100000,
    );
    const replacement = await core.prepare(owner, {
      tasks: [{ kind: "ajo_replace", memberId: member.id, amountKobo: 100000 }],
    });
    await core.approve(owner, replacement.plan.id, 1, "1234");
    await core.drain();
    assert.equal(await balance(db, "ajo:" + member.id), 100000);
    assert.equal(
      (await core.records(owner, "member"))[0].cashOutstandingKobo,
      0,
    );
    const other = await core.userForPhone("2348000000002");
    await core.setup(other, "Bisi Example", "4321");
    const a = await core.joinBook(other, book.invite, 50000, "2026-12-01"),
      b = await core.joinBook(other, book.invite, 50000, "2026-12-01");
    assert.equal(a.id, b.id);
    assert.equal(a.dailyKobo, 50000);
    const receiptId = (await core.workspace(owner)).receipts[0].id;
    await assert.rejects(() => core.receipt(other, receiptId));
  } finally {
    await db.close();
  }
});
test("expired, cancelled and changed reviews never authorize a debit; request keys deduplicate preparations", async () => {
  const { db, core, owner } = await fixture();
  try {
    const first = await core.prepare(
        owner,
        { tasks: [transfer] },
        "request-one",
      ),
      same = await core.prepare(owner, { tasks: [transfer] }, "request-one");
    assert.equal(first.plan.id, same.plan.id);
    await assert.rejects(() => core.approve(owner, first.plan.id, 2, "1234"));
    await core.cancel(owner, first.plan.id);
    await assert.rejects(() => core.approve(owner, first.plan.id, 1, "1234"));
    const expired = await core.prepare(owner, { tasks: [transfer] });
    await db.query("UPDATE plans SET expires_at=$1 WHERE id=$2", [
      "2000-01-01T00:00:00Z",
      expired.plan.id,
    ]);
    await assert.rejects(() => core.approve(owner, expired.plan.id, 1, "1234"));
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});
