import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateContribution,
  contributionCapacity,
  lagosDate,
} from "../src/ajo-allocation.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { receiptImage } from "../src/receipt-image.ts";
import { receiptPdf } from "../src/receipts.ts";

test("catch-up contributions cover oldest unpaid dates, complete partial days and stop at the agreed cycle", () => {
  const terms = {
      joinedDate: "2024-02-28",
      maturityDate: "2024-03-02",
      dailyKobo: 20000,
    },
    result = allocateContribution(terms, 10000, 45000);
  assert.deepEqual(result.periods, [
    { date: "2024-02-28", amountKobo: 10000, remainingKobo: 0 },
    { date: "2024-02-29", amountKobo: 20000, remainingKobo: 0 },
    { date: "2024-03-01", amountKobo: 15000, remainingKobo: 5000 },
  ]);
  assert.equal(result.afterKobo, 55000);
  assert.throws(() => allocateContribution(terms, 55000, 25001), {
    code: "AJO_CYCLE_EXCEEDED",
  });
  assert.throws(() =>
    contributionCapacity({ ...terms, maturityDate: "2024-02-30" }),
  );
  assert.throws(() =>
    contributionCapacity({ ...terms, maturityDate: "2028-01-01" }),
  );
  assert.throws(() => allocateContribution(terms, -1, 1));
  assert.equal(lagosDate(Date.parse("2026-10-28T23:30:00Z")), "2026-10-29");
});

async function fixture() {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    organizer = await core.userForPhone("2348000000001"),
    saver = await core.userForPhone("2348000000002");
  await core.setup(organizer, "Ada Example", "1234");
  await core.setup(saver, "Bisi Example", "4321");
  await db.query("UPDATE users SET organizer=1 WHERE id=$1", [organizer]);
  const book = await core.createBook(organizer, "Market savers"),
    member = await core.joinBook(
      saver,
      book.invite,
      20000,
      "2026-11-05",
      "2026-10-20",
    );
  return { db, core, organizer, saver, member };
}

test("cash replacement funds recorded days once, while later wallet contributions continue the same member schedule", async () => {
  const { db, core, organizer, saver, member } = await fixture();
  try {
    const first = await core.prepare(organizer, {
      tasks: [
        {
          kind: "ajo_cash",
          memberId: member.id,
          amountKobo: 55000,
          date: "2026-10-27",
        },
      ],
    });
    assert.equal(first.plan.spec[0].allocation?.periods.length, 3);
    assert.equal(
      (await core.workspace(organizer)).members[0].contribution.contributedKobo,
      0,
    );
    await core.approve(organizer, first.plan.id, 1, "1234");
    await core.drain();
    let current = (await core.workspace(saver)).members[0];
    assert.equal(current.contribution.contributedKobo, 55000);
    assert.equal(current.contribution.nextDayRemainingKobo, 5000);
    assert.equal(current.fundedKobo, 0);
    assert.equal(current.cashOutstandingKobo, 55000);
    const replacement = await core.prepare(organizer, {
      tasks: [{ kind: "ajo_replace", memberId: member.id, amountKobo: 55000 }],
    });
    assert.equal(replacement.plan.spec[0].allocation, undefined);
    await core.approve(organizer, replacement.plan.id, 1, "1234");
    await core.drain();
    const next = await core.prepare(saver, {
      tasks: [
        { kind: "ajo_contribute", memberId: member.id, amountKobo: 5000 },
      ],
    });
    assert.deepEqual(next.plan.spec[0].allocation?.periods, [
      { date: "2026-10-22", amountKobo: 5000, remainingKobo: 0 },
    ]);
    await core.approve(saver, next.plan.id, 1, "4321");
    await core.drain();
    current = (await core.workspace(saver)).members[0];
    assert.equal(current.contribution.paidDays, 3);
    assert.equal(current.contribution.contributedKobo, 60000);
    assert.equal(current.cashOutstandingKobo, 0);
    assert.equal(current.fundedKobo, 60000);
    assert.equal((await core.records(organizer, "contribution")).length, 2);
    const r = (await core.workspace(organizer)).receipts.find(
      (r: any) => r.kind === "ajo_cash",
    );
    assert.equal(r.allocation.afterKobo, 55000);
    assert.ok(receiptImage(r).length > 10000);
    assert.equal((await receiptPdf(r)).subarray(0, 4).toString(), "%PDF");
  } finally {
    await db.close();
  }
});

test("a changed contribution requires fresh review and concurrent approvals cannot silently reassign the covered days", async () => {
  const { db, core, organizer, saver, member } = await fixture();
  try {
    const cash = await core.prepare(organizer, {
        tasks: [
          {
            kind: "ajo_cash",
            memberId: member.id,
            amountKobo: 10000,
            date: "2026-10-27",
          },
        ],
      }),
      wallet = await core.prepare(saver, {
        tasks: [
          { kind: "ajo_contribute", memberId: member.id, amountKobo: 20000 },
        ],
      });
    await Promise.all([
      core.approve(organizer, cash.plan.id, 1, "1234"),
      core.approve(saver, wallet.plan.id, 1, "4321"),
    ]);
    await core.drain();
    const plans = await Promise.all([
      core.plan(organizer, cash.plan.id),
      core.plan(saver, wallet.plan.id),
    ]);
    assert.deepEqual(plans.map((p) => p.status).sort(), [
      "FAILED",
      "SUCCEEDED",
    ]);
    assert.equal(
      plans.flatMap((p) => p.tasks).find((t) => t.status === "FAILED")?.error,
      "AJO_ALLOCATION_CHANGED",
    );
    const state = (await core.workspace(saver)).members[0],
      contributions = await core.records(organizer, "contribution");
    assert.equal(contributions.length, 1);
    assert.equal(
      state.contribution.contributedKobo,
      contributions[0].amountKobo,
    );
    assert.equal(
      (await db.query("SELECT task FROM holds WHERE active=1")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("two collections for the same member in one plan reserve successive days and cancellation records nothing", async () => {
  const { db, core, organizer, member } = await fixture();
  try {
    const task = {
        kind: "ajo_cash",
        memberId: member.id,
        amountKobo: 10000,
        date: "2026-10-27",
      },
      cancelled = await core.prepare(organizer, { tasks: [task] });
    await core.cancel(organizer, cancelled.plan.id);
    assert.equal((await core.records(organizer, "contribution")).length, 0);
    const group = await core.prepare(organizer, {
      tasks: [task, { ...task, amountKobo: 30000 }],
    });
    assert.deepEqual(group.plan.spec[1].dependsOn, [0]);
    assert.equal(group.plan.spec[1].allocation?.beforeKobo, 10000);
    await core.approve(organizer, group.plan.id, 1, "1234");
    await core.drain();
    await db.query(
      "UPDATE jobs SET lease_until=$1 WHERE kind='task' AND status='QUEUED'",
      ["2000-01-01T00:00:00Z"],
    );
    await core.drain();
    assert.equal(
      (await core.plan(organizer, group.plan.id)).status,
      "SUCCEEDED",
    );
    const current = (await core.workspace(organizer)).members[0];
    assert.equal(current.contribution.paidDays, 2);
    assert.equal(current.contribution.contributedKobo, 40000);
    assert.equal(current.fundedKobo, 0);
  } finally {
    await db.close();
  }
});
