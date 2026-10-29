import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { balance } from "../src/ledger.ts";
import { Agent } from "../src/ai/agent.ts";
import { createModel } from "../src/ai/model.ts";
import { Worker } from "../src/worker.ts";
import { createApp } from "../src/server.ts";
import { createCapability } from "../src/security.ts";

async function fixture() {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    organizer = await core.userForPhone("2348000000001"),
    saver = await core.userForPhone("2348000000002");
  await core.setup(organizer, "Ada Example", "1234");
  await core.setup(saver, "Bisi Example", "4321");
  await db.query("UPDATE users SET organizer=1 WHERE id=$1", [organizer]);
  const book = await core.createBook(organizer, "October market", {
    feePolicy: { kind: "one_day" },
    rules: "Save your own daily amount. Payout follows your agreed date.",
  });
  const join = () =>
    core.joinBook(saver, book.invite, 100000, "2026-10-28", "2026-10-01", {
      termsVersion: 1,
      consent: true,
    });
  return { db, core, organizer, saver, book, join };
}
test("Ajo invitations expose terms only, require explicit consent, expire, rotate and revoke without changing existing memberships", async () => {
  const { db, core, organizer, saver, book, join } = await fixture();
  try {
    const preview = await core.previewInvitation(saver, book.invite);
    assert.equal(preview.organizerName, "Ada Example");
    assert.equal(preview.feePolicy.kind, "one_day");
    assert.equal("members" in preview, false);
    assert.equal("phone" in preview, false);
    await assert.rejects(
      () =>
        core.joinBook(saver, book.invite, 100000, "2026-10-28", "2026-10-01"),
      /AJO_CONSENT_REQUIRED/,
    );
    await assert.rejects(
      () =>
        core.joinBook(saver, book.invite, 100000, "2026-10-28", "2026-10-01", {
          termsVersion: 2,
          consent: true,
        }),
      /AJO_TERMS_CHANGED/,
    );
    const member = await join();
    assert.equal((await join()).id, member.id);
    await assert.rejects(
      () =>
        core.joinBook(saver, book.invite, 200000, "2026-10-28", "2026-10-01", {
          termsVersion: 1,
          consent: true,
        }),
      /AJO_ALREADY_JOINED/,
    );
    const before = (await core.workspace(saver)).members[0];
    assert.equal(before.agreedFeeKobo, 100000);
    assert.equal(before.agreement.acceptedBy, saver);
    await assert.rejects(() => core.changeInvitation(saver, book.id, "revoke"));
    const rotated = await core.changeInvitation(organizer, book.id, "rotate");
    assert.notEqual(rotated.invite, book.invite);
    await assert.rejects(
      () => core.previewInvitation(saver, book.invite),
      /INVITE_REVOKED/,
    );
    await core.changeInvitation(organizer, book.id, "revoke");
    await assert.rejects(
      () => core.previewInvitation(saver, rotated.invite),
      /INVITE_REVOKED/,
    );
    const renewed = await core.changeInvitation(organizer, book.id, "rotate");
    await db.query("UPDATE records SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...renewed, inviteExpiresAt: "2000-01-01" }),
      book.id,
    ]);
    await assert.rejects(
      () => core.previewInvitation(saver, renewed.invite),
      /INVITE_EXPIRED/,
    );
    assert.equal((await core.workspace(saver)).members[0].id, member.id);
    assert.equal((await core.workspace(saver)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});
test("one agreed Ajo cycle fee goes to the organizer once across two payouts; saver receipts preserve gross, fee and net", async () => {
  const { db, core, organizer, saver, join } = await fixture();
  try {
    const member = await join();
    const deposit = await core.prepare(saver, {
      tasks: [
        { kind: "ajo_contribute", memberId: member.id, amountKobo: 1000000 },
      ],
    });
    await core.approve(saver, deposit.plan.id, 1, "4321");
    await core.drain();
    const payout = await core.prepare(organizer, {
      tasks: [
        { kind: "ajo_payout", memberId: member.id, amountKobo: 500000 },
        { kind: "ajo_payout", memberId: member.id, amountKobo: 500000 },
      ],
    });
    assert.deepEqual(
      payout.plan.spec.map((t) => t.feeKobo),
      [100000, 0],
    );
    assert.deepEqual(payout.plan.spec[1].dependsOn, [0]);
    assert.equal(payout.plan.spec[0].amountKobo, 400000);
    await core.approve(organizer, payout.plan.id, 1, "1234");
    await core.drain();
    assert.equal(
      (await core.plan(organizer, payout.plan.id)).status,
      "SUCCEEDED",
    );
    assert.equal((await core.workspace(organizer)).balanceKobo, 50100000);
    const workspace = await core.workspace(saver);
    assert.equal(workspace.balanceKobo, 49900000);
    assert.equal(workspace.members[0].fundedKobo, 0);
    assert.equal(workspace.members[0].feePaidKobo, 100000);
    assert.equal(await balance(db, "system:fees"), 0);
    const first = workspace.receipts.find(
      (r) => r.kind === "ajo_payout" && r.feeKobo,
    )!;
    assert.equal(first.grossAmountKobo, 500000);
    assert.equal(first.amountKobo, 400000);
    assert.equal(first.feeKobo, 100000);
    await core.approve(organizer, payout.plan.id, 1, "1234");
    await core.drain();
    assert.equal((await core.workspace(organizer)).balanceKobo, 50100000);
  } finally {
    await db.close();
  }
});
test("overlapping payout reviews cannot take a cycle fee twice and a changed fee requires a new review", async () => {
  const { db, core, organizer, saver, join } = await fixture();
  try {
    const member = await join(),
      deposit = await core.prepare(saver, {
        tasks: [
          { kind: "ajo_contribute", memberId: member.id, amountKobo: 1000000 },
        ],
      });
    await core.approve(saver, deposit.plan.id, 1, "4321");
    await core.drain();
    const first = await core.prepare(organizer, {
      tasks: [{ kind: "ajo_payout", memberId: member.id, amountKobo: 600000 }],
    });
    await core.approve(organizer, first.plan.id, 1, "1234");
    const second = await core.prepare(organizer, {
      tasks: [{ kind: "ajo_payout", memberId: member.id, amountKobo: 400000 }],
    });
    await core.approve(organizer, second.plan.id, 1, "1234");
    await core.drain();
    const plans = await Promise.all([
      core.plan(organizer, first.plan.id),
      core.plan(organizer, second.plan.id),
    ]);
    assert.deepEqual(plans.map((p) => p.status).sort(), [
      "FAILED",
      "SUCCEEDED",
    ]);
    assert.equal((await core.workspace(organizer)).balanceKobo, 50100000);
    const remaining = (await core.workspace(saver)).members[0].fundedKobo;
    const final = await core.prepare(organizer, {
      tasks: [
        { kind: "ajo_payout", memberId: member.id, amountKobo: remaining },
      ],
    });
    assert.equal(final.plan.spec[0].feeKobo, 0);
    await core.approve(organizer, final.plan.id, 1, "1234");
    await core.drain();
    assert.equal((await core.workspace(saver)).balanceKobo, 49900000);
  } finally {
    await db.close();
  }
});
test("MCP proposes a private membership review without accepting terms for the saver or exposing its access capability to the model", async () => {
  const { db, core, saver, book } = await fixture();
  let modelCalls = 0;
  const agent = new Agent(
    core,
    {
      provider: "offline-fixture",
      async complete() {
        modelCalls++;
        return {
          text: "",
          calls: [
            {
              id: "join",
              name: "join_ajo_book",
              arguments: {
                invite: book.invite,
                dailyKobo: 100000,
                startDate: "2026-10-01",
                maturityDate: "2026-10-28",
              },
            },
          ],
        };
      },
    },
    "offline-private-membership-review-secret",
  );
  const worker = new Worker(core, agent, {
    PUBLIC_ORIGIN: "https://paywella.example",
  });
  try {
    await core.enqueue(db, "membership-request", "agent", saver, {
      sealed: agent.seal({
        text: "Join my Ajo book with these terms.",
        channel: "web",
      }),
    });
    await worker.turn();
    const reply = agent.open((await core.records(saver, "reply"))[0].sealed);
    assert.equal(modelCalls, 1);
    assert.ok(reply.membershipProposal);
    const url = new URL(reply.url);
    assert.equal(url.searchParams.get("joinRequest"), reply.membershipProposal);
    assert.ok(url.hash.length > 20);
    assert.equal((await core.workspace(saver)).members.length, 0);
    const proposal = await core.membershipProposal(
      saver,
      reply.membershipProposal,
    );
    assert.equal(proposal.book.feePolicy.kind, "one_day");
    assert.equal(proposal.dailyKobo, 100000);
  } finally {
    await worker.stop();
    await db.close();
  }
});
test("private HTTP membership review rejects missing consent and wrong terms before creating a saver, while represented cash members need a declared consent record", async () => {
  const { db, core, saver, organizer, book } = await fixture(),
    agent = new Agent(
      core,
      createModel({}),
      "offline-private-http-membership-secret",
    ),
    origin = "https://paywella.example",
    server = createApp(core, agent, { PUBLIC_ORIGIN: origin });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const post = (path: string, data: unknown, cookie = "") =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    const exchanged = await post("exchange", {
        token: await createCapability(db, saver, "workspace"),
      }),
      cookie = exchanged.headers.get("set-cookie")!;
    assert.equal(
      (
        await fetch(base + "/api/ajo/invitation?code=" + book.invite, {
          headers: { cookie },
        })
      ).status,
      200,
    );
    const input = {
      invite: book.invite,
      dailyKobo: 100000,
      maturityDate: "2026-10-28",
      startDate: "2026-10-01",
      termsVersion: 1,
    };
    assert.equal((await post("ajo/join", input, cookie)).status, 400);
    assert.equal(
      (
        await post(
          "ajo/join",
          { ...input, consent: true, termsVersion: 2 },
          cookie,
        )
      ).status,
      409,
    );
    assert.equal((await core.workspace(saver)).members.length, 0);
    assert.equal(
      (await post("ajo/join", { ...input, consent: true }, cookie)).status,
      201,
    );
    await assert.rejects(
      () =>
        core.addMember(organizer, book.id, {
          name: "Cash saver",
          dailyKobo: 100000,
          maturityDate: "2026-10-28",
          startDate: "2026-10-01",
        } as any),
      /AJO_CONSENT_REQUIRED/,
    );
    await assert.rejects(
      () =>
        core.addMember(organizer, book.id, {
          name: "Cash saver",
          dailyKobo: 100000,
          maturityDate: "2026-10-28",
          startDate: "2026-10-01",
          consentConfirmed: true,
          userId: saver,
        } as any),
      /AJO_PRIVATE_JOIN_REQUIRED/,
    );
    const offline = await core.addMember(organizer, book.id, {
      name: "Cash saver",
      dailyKobo: 100000,
      maturityDate: "2026-10-28",
      startDate: "2026-10-01",
      consentConfirmed: true,
    });
    const member = (await core.workspace(organizer)).members.find(
      (m) => m.id === offline.id,
    )!;
    assert.equal(member.agreement.representedBy, organizer);
    assert.equal(member.userId, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
