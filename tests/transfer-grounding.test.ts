import test from "node:test";
import assert from "node:assert/strict";
import {
  suppliedAccounts,
  assertBankSources,
} from "../src/ai/bank-grounding.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import type { Task } from "../src/contracts.ts";

test("a model cannot invent a bank or shorten a phone number into a destination; owned recipient and review references remain usable", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    const task: Task = {
      kind: "bank_transfer",
      bankCode: "opay",
      accountNumber: "0123456789",
      amountKobo: 200000,
    };
    await assert.rejects(
      () =>
        assertBankSources(core, owner, [task], {
          customerMessages: [
            "Send 2,000 to 0123456789. I will tell you the bank next.",
          ],
          reviewedTasks: [],
        }),
      (e: any) => e.code === "BANK_CONFIRMATION_REQUIRED",
    );
    await assertBankSources(core, owner, [task], {
      customerMessages: ["Send 2,000 to 0123456789.", "OPay"],
      reviewedTasks: [],
    });
    await assert.rejects(
      () =>
        assertBankSources(
          core,
          owner,
          [{ ...task, accountNumber: "8124966881" }],
          {
            customerMessages: ["My mother uses OP, account 08124966881."],
            reviewedTasks: [],
          },
        ),
      (e: any) => e.code === "ACCOUNT_CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(
      [
        ...suppliedAccounts([
          "Account zero one two three four five six seven eight nine at OP.",
        ]),
      ],
      ["0123456789"],
    );
    assert.deepEqual(
      [...suppliedAccounts(["08124966881", "2348124966881"])],
      [],
    );
    assert.deepEqual([...suppliedAccounts(["012 345 6789"])], ["0123456789"]);
    await core.saveBeneficiary(owner, "opay", "0123456789", "Mum");
    await assertBankSources(core, owner, [task], {
      customerMessages: ["Send Mum 2k"],
      reviewedTasks: [],
    });
    await assertBankSources(core, owner, [task], {
      customerMessages: ["Change only the amount"],
      reviewedTasks: [task],
    });
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});

test("a missing transfer field stops preparation retries and asks a model-generated clarification; the next turn retains every task", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000001");
    await core.setup(owner, "Ada Example", "1234");
    let round = 0;
    const tasks = [
      {
        kind: "bank_transfer",
        bankCode: "opay",
        accountNumber: "0123456789",
        amountKobo: 200000,
      },
      { kind: "goal_create", name: "Laptop", amountKobo: 300000 },
      { kind: "goal_create", name: "Rent", amountKobo: 200000 },
    ];
    const agent = new Agent(
      core,
      {
        provider: "offline-grounding",
        async complete(messages, tools) {
          round++;
          if (round === 2) {
            assert.equal(tools.length, 0);
            assert.match(messages.at(-1)!.content, /which bank/);
            return {
              text: "Which bank is your mother’s account with? I have her account, ₦2,000 transfer and both savings amounts.",
              calls: [],
            };
          }
          if (round === 3) {
            const context = JSON.stringify(messages);
            assert.match(context, /0123456789/);
            assert.match(context, /Laptop/);
            assert.match(context, /Rent/);
          }
          return {
            text: "",
            calls: [
              {
                id: "prepare-" + round,
                name: "prepare_plan",
                arguments: { tasks },
              },
            ],
          };
        },
      },
      "isolated-transfer-grounding-test-secret",
    );
    const first = await agent.turn(
      owner,
      "Send my mother 2,000 at 0123456789. Save 3,000 for Laptop and 2,000 for Rent. I will send the bank next.",
    );
    assert.equal(first.prepared, undefined);
    assert.match(first.text, /Which bank/);
    assert.equal((await core.workspace(owner)).plans.length, 0);
    const next = await agent.turn(owner, "OPay");
    assert.equal(next.prepared?.plan.spec.length, 3);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});

test("an explicitly supplied ten-digit mobile-wallet account is valid without inventing or dropping a digit", async () => {
  const db = await openStore({ file: ":memory:" }),
    core = new Core(db);
  try {
    const owner = await core.userForPhone("2348000000013");
    await core.setup(owner, "Ada Example", "1234");
    const task: Task = {
      kind: "bank_transfer",
      bankCode: "opay",
      accountNumber: "8000000001",
      amountKobo: 200000,
    };
    await assertBankSources(core, owner, [task], {
      customerMessages: [
        "Press my mama 2k. Her aza is 8000000001, bank na OP.",
      ],
      reviewedTasks: [],
    });
    const agent = new Agent(
      core,
      {
        provider: "offline",
        async complete(messages) {
          const context = JSON.parse(messages[1].content);
          assert.deepEqual(context.suppliedAccountCandidates, ["8000000001"]);
          assert.equal(context.suppliedBankReferences[0].code, "opay");
          return {
            text: "",
            calls: [
              {
                id: "prepare-wallet",
                name: "prepare_plan",
                arguments: { tasks: [task] },
              },
            ],
          };
        },
      },
      "isolated-mobile-wallet-context-secret",
    );
    const r = await agent.turn(
      owner,
      "Press my mama 2k. Her aza is 8000000001, bank na OP.",
    );
    assert.equal(r.prepared?.plan.spec.length, 1);
    assert.equal((await core.workspace(owner)).balanceKobo, 50000000);
  } finally {
    await db.close();
  }
});
