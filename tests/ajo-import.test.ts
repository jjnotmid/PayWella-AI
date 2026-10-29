import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { Worker } from "../src/worker.ts";
test("a ledger picture creates review candidates only, preserves uncertain rows, deduplicates the file and requires a private cash approval", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db),
    agent = new Agent(
      core,
      {
        provider: "offline-fixture",
        async complete() {
          throw Error("Ledger candidates are not free-form payments.");
        },
      },
      "offline-ledger-import-secret-for-test",
    );
  let reads = 0;
  const fetcher: typeof fetch = async (url) => {
    const address = String(url);
    if (address.endsWith("/12345"))
      return Response.json({
        url: "https://lookaside.fbsbx.com/ledger-fixture",
        mime_type: "image/png",
      });
    if (address === "https://lookaside.fbsbx.com/ledger-fixture")
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    if (address.includes("generativelanguage.googleapis.com")) {
      reads++;
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    kind: "ledger",
                    rows: [
                      {
                        name: "Tunde Example",
                        amountKobo: 60000,
                        date: "2026-10-27",
                        unclear: false,
                      },
                      {
                        name: "Unclear name",
                        amountKobo: null,
                        date: null,
                        unclear: true,
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    throw Error("Unexpected external request");
  };
  const worker = new Worker(
    core,
    agent,
    {
      PUBLIC_ORIGIN: "https://paywella.example",
      WHATSAPP_ACCESS_TOKEN: "offline-fixture",
      GEMINI_API_KEY: "offline-fixture",
    },
    fetcher,
  );
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    await db.query("UPDATE users SET organizer=1 WHERE id=$1", [owner]);
    const book = await core.createBook(owner, "Market savers"),
      member = await core.addMember(owner, book.id, {
        name: "Tunde Example",
        dailyKobo: 20000,
        maturityDate: "2027-01-01",
      });
    for (const id of ["first-photo", "same-photo"]) {
      await core.enqueue(db, id, "agent", owner, {
        sealed: agent.seal({
          text: "Record this notebook",
          channel: "web",
          media: { id: "12345", type: "image" },
        }),
      });
      await worker.turn();
    }
    assert.equal(reads, 2);
    const workspace = await core.workspace(owner);
    assert.equal(workspace.imports.length, 1);
    assert.equal(workspace.imports[0].rows.length, 2);
    assert.equal(workspace.members[0].cashOutstandingKobo, 0);
    assert.equal(workspace.members[0].fundedKobo, 0);
    assert.equal(workspace.balanceKobo, 50000000);
    const row = workspace.imports[0].rows.find((item: any) => !item.unclear),
      plan = await core.prepare(owner, {
        tasks: [
          {
            kind: "ajo_cash",
            memberId: member.id,
            amountKobo: row.amountKobo,
            date: row.date,
            sourceRow: row.id,
          },
        ],
      });
    await core.approve(owner, plan.plan.id, 1, "1234");
    await core.drain();
    const after = await core.workspace(owner);
    assert.equal(after.members[0].cashOutstandingKobo, 60000);
    assert.equal(after.members[0].fundedKobo, 0);
    assert.equal(
      after.imports[0].rows.filter((item: any) => item.status === "PENDING")
        .length,
      1,
    );
  } finally {
    await worker.stop();
    await db.close();
  }
});
