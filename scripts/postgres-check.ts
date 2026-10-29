import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";

const source = process.env.PG_TEST_URL;
if (!source)
  throw Error("Set PG_TEST_URL to a local disposable PostgreSQL server.");
const url = new URL(source);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/postgres"
)
  throw Error(
    "This check only accepts a loopback PostgreSQL server and creates its own disposable database.",
  );
const database = "paywella_ai_test_" + randomUUID().replaceAll("-", ""),
  admin = new pg.Client({ connectionString: source });
await admin.connect();
let created = false,
  db: Awaited<ReturnType<typeof openStore>> | undefined;
try {
  await admin.query(`CREATE DATABASE ${database}`);
  created = true;
  url.pathname = "/" + database;
  db = await openStore({ url: url.toString() });
  const core = new Core(db),
    owner = await core.userForPhone("2348000000001");
  await core.setup(owner, "Ada Example", "1234");
  const result = await core.prepare(owner, {
    tasks: [
      {
        kind: "bank_transfer",
        bankCode: "opay",
        accountNumber: "0123456789",
        amountKobo: 200000,
      },
      { kind: "goal_create", name: "Rent", amountKobo: 300000 },
      { kind: "goal_create", name: "Laptop", amountKobo: 100000 },
    ],
  });
  await Promise.all([
    core.approve(owner, result.plan.id, 1, "1234"),
    core.approve(owner, result.plan.id, 1, "1234"),
  ]);
  await Promise.all([core.drain(), core.drain()]);
  assert.equal((await core.plan(owner, result.plan.id)).status, "SUCCEEDED");
  assert.equal((await core.workspace(owner)).balanceKobo, 49400000);
  await assert.rejects(() => db!.query("DELETE FROM postings"));
  const invalidJournal = randomUUID();
  await assert.rejects(() =>
    db!.transaction(async (q) => {
      await q.query("INSERT INTO journals VALUES($1,$2,$3)", [
        invalidJournal,
        "unbalanced-fixture",
        new Date().toISOString(),
      ]);
      await q.query("INSERT INTO postings VALUES($1,$2,$3,$4)", [
        randomUUID(),
        invalidJournal,
        "wallet:" + owner,
        100,
      ]);
    }),
  );
  assert.equal(
    (await db.query("SELECT id FROM journals WHERE id=$1", [invalidJournal]))
      .rows.length,
    0,
  );
  await db.transaction(async (q) => {
    await q.query("SET LOCAL ROLE pg_read_all_data");
    assert.equal((await q.query("SELECT id FROM users")).rows.length, 0);
  });
  const tables = (
    await db.query(
      "SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('users','postings','capabilities','sessions','jobs')",
    )
  ).rows;
  assert.equal(tables.length, 5);
  assert.ok(tables.every((row) => row.relrowsecurity));
  const next = await core.prepare(owner, {
    tasks: [{ kind: "goal_create", name: "School", amountKobo: 100000 }],
  });
  const revision = await core.prepare(
    owner,
    { tasks: [{ kind: "goal_create", name: "School", amountKobo: 150000 }] },
    null,
    { id: next.plan.id, revision: 1 },
  );
  assert.equal(revision.plan.revision, 2);
  await core.approve(owner, revision.plan.id, 2, "1234");
  await core.drain();
  const statement = await core.statement(owner, "2020-01-01", "2020-12-31");
  assert.equal(statement.entries.length, 0);
  const today = new Date().toISOString().slice(0, 10),
    current = await core.statement(owner, today.slice(0, 4) + "-01-01", today);
  assert.equal(current.closingKobo, 49250000);
  await db.query("UPDATE users SET organizer=1 WHERE id=$1", [owner]);
  const saver = await core.userForPhone("2348000000002");
  await core.setup(saver, "Bisi Example", "4321");
  const book = await core.createBook(owner, "PostgreSQL collection check"),
    member = await core.joinBook(
      saver,
      book.invite,
      20000,
      "2026-12-31",
      "2026-01-01",
    ),
    cash = await core.prepare(owner, {
      tasks: [
        {
          kind: "ajo_cash",
          memberId: member.id,
          amountKobo: 10000,
          date: "2026-10-27",
        },
      ],
    }),
    digital = await core.prepare(saver, {
      tasks: [
        { kind: "ajo_contribute", memberId: member.id, amountKobo: 20000 },
      ],
    });
  await Promise.all([
    core.approve(owner, cash.plan.id, 1, "1234"),
    core.approve(saver, digital.plan.id, 1, "4321"),
  ]);
  await Promise.all([core.drain(), core.drain()]);
  const outcomes = await Promise.all([
    core.plan(owner, cash.plan.id),
    core.plan(saver, digital.plan.id),
  ]);
  assert.deepEqual(outcomes.map((plan) => plan.status).sort(), [
    "FAILED",
    "SUCCEEDED",
  ]);
  const collection = (await core.workspace(saver)).members[0];
  assert.equal(
    collection.contribution.contributedKobo,
    collection.fundedKobo + collection.cashOutstandingKobo,
  );
  assert.equal((await core.records(owner, "contribution")).length, 1);
  process.stdout.write(
    "PostgreSQL checks passed: concurrent approval, parallel settlement, revisions, statements, Ajo allocation races, RLS and immutable ledger.\n",
  );
} finally {
  await db?.close();
  if (created) await admin.query(`DROP DATABASE ${database}`);
  await admin.end();
}
