import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { connectTools } from "../src/ai/mcp.ts";
import { createModel } from "../src/ai/model.ts";
import type { Model } from "../src/ai/model.ts";
test("independent MCP reads overlap while a later beneficiary read waits for its preceding mutation", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let release = () => {},
    waiting = false,
    overlap = false,
    saved = false,
    round = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timeout = setTimeout(release, 2000);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const funding = core.fundingDetails.bind(core),
      transaction = db.transaction.bind(db),
      save = core.saveBeneficiary.bind(core),
      records = core.records.bind(core);
    core.fundingDetails = async (id) => {
      waiting = true;
      await gate;
      waiting = false;
      return funding(id);
    };
    db.transaction = async (fn) => {
      if (waiting) {
        overlap = true;
        release();
      }
      return transaction(fn);
    };
    core.saveBeneficiary = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const value = await save(...args);
      saved = true;
      return value;
    };
    core.records = async (id, kind) => {
      if (kind === "beneficiary") assert.equal(saved, true);
      return records(id, kind);
    };
    const model: Model = {
      provider: "offline-ordering-fixture",
      async complete(messages) {
        if (round++ === 0)
          return {
            text: "",
            calls: [
              { id: "fund", name: "get_account_details", arguments: {} },
              { id: "balance", name: "get_balance", arguments: {} },
            ],
          };
        if (round === 2) {
          assert.equal(messages.at(-2)!.name, "get_account_details");
          assert.equal(messages.at(-1)!.name, "get_balance");
          return {
            text: "",
            calls: [
              {
                id: "save",
                name: "save_beneficiary",
                arguments: {
                  bankCode: "opay",
                  accountNumber: "0123456789",
                  alias: "Mum",
                },
              },
              { id: "list", name: "list_beneficiaries", arguments: {} },
            ],
          };
        }
        assert.match(messages.at(-1)!.content, /Mum/);
        return {
          text: "The recipient is saved. No payment was made.",
          calls: [],
        };
      },
    };
    const agent = new Agent(
      core,
      model,
      "offline-isolated-concurrent-read-secret",
    );
    const result = await agent.turn(
      owner,
      "Read my balance and funding details, then save this recipient as Mum.",
    );
    assert.equal(overlap, true);
    assert.equal(saved, true);
    assert.match(result.text, /No payment/);
    assert.equal((await core.getUser(owner)).ready, true);
  } finally {
    release();
    clearTimeout(timeout);
    await db.close();
  }
});
test("MCP only exposes owned reads and preparation, with no execution tool or approval capability", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  let tools;
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    let prepared: any;
    tools = await connectTools(core, owner, (value) => {
      prepared = value;
    });
    const listed = await tools.client.listTools();
    assert.ok(listed.tools.some((t) => t.name === "prepare_plan"));
    assert.ok(!listed.tools.some((t) => /execute|approve|pin/i.test(t.name)));
    const forbidden = await tools.call("execute_payment", {});
    assert.equal(forbidden.error, "TOOL_NOT_ALLOWED");
    const invalid = await tools.call("prepare_plan", {
      owner: "someone-else",
      tasks: [],
    });
    assert.equal(invalid.error, "INVALID_TOOL_ARGUMENTS");
    const result = await tools.call("prepare_plan", {
      tasks: [{ kind: "goal_create", name: "Rent", amountKobo: 200000 }],
    });
    assert.equal(result.paymentAuthorized, false);
    assert.ok(prepared.capability);
    assert.equal(JSON.stringify(result).includes(prepared.capability), false);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await tools?.close();
    await db.close();
  }
});
test("clarification keeps the initial amount and account through many turns, then cancellation clears the request", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    let round = 0;
    const model: Model = {
      provider: "offline-fixture",
      async complete(messages) {
        round++;
        const context = JSON.stringify(messages);
        if (round === 14) {
          assert.match(context, /0123456789/);
          assert.match(context, /two thousand/);
          return {
            text: "",
            calls: [
              { id: "cancel", name: "clear_unfinished_request", arguments: {} },
            ],
          };
        }
        if (round === 15) return { text: "Cancelled.", calls: [] };
        if (round === 16) assert.doesNotMatch(context, /0123456789/);
        return { text: "Which bank should I use?", calls: [] };
      },
    };
    const agent = new Agent(
      core,
      model,
      "offline-secret-for-encrypted-test-state",
    );
    await agent.turn(owner, "Send two thousand naira to 0123456789");
    for (let i = 0; i < 12; i++)
      await agent.turn(owner, "Can you clarify what you need?");
    await agent.turn(owner, "Cancel the unfinished request");
    await agent.turn(owner, "I have a different question");
    const memory = JSON.stringify(await core.records(owner, "conversation"));
    assert.equal(memory.includes("0123456789"), false);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});
test("model failures retain the user instruction and absent keys never call the network", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    let requests = 0;
    const model = createModel({ AI_PROVIDER: "gemini" }, async () => {
      requests++;
      throw Error("Unexpected network");
    });
    const agent = new Agent(
      core,
      model,
      "offline-secret-for-encrypted-test-state",
    );
    await assert.rejects(() =>
      agent.turn(owner, "Send two thousand to 0123456789"),
    );
    assert.equal(requests, 0);
    const memory = agent.open(
      (await core.records(owner, "conversation"))[0].sealed,
    );
    assert.match(JSON.stringify(memory), /0123456789/);
  } finally {
    await db.close();
  }
});
