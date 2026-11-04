import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Agent } from "../src/ai/agent.ts";
import { createModel } from "../src/ai/model.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { AppError } from "../src/contracts.ts";
import { aiReadiness } from "../src/ai/readiness.ts";

const ai = aiReadiness(process.env);
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  provider: ai.aiProvider,
  model: ai.model,
  metaReasoningModel: ai.metaModelSelected,
  financialMode: "isolated sandbox",
  checks: [],
};
const checks: Record<string, unknown>[] = [];
const db = await openStore({ file: ":memory:" });
try {
  if (!ai.aiKey) throw new AppError("AI_NOT_CONFIGURED");
  const core = new Core(db),
    owner = await core.userForPhone("2348000000001");
  await core.setup(owner, "Ada Example", "1234");
  const agent = new Agent(
    core,
    createModel(process.env),
    randomBytes(32).toString("hex"),
  );
  let result = await agent.turn(
    owner,
    "Send 2,000 naira to my mother, account 0123456789. Also save 3,000 naira for Laptop and 2,000 naira for Rent. I will tell you her bank next.",
  );
  assert.equal(
    result.prepared,
    undefined,
    "A missing bank must not become a partial financial review.",
  );
  assert.match(
    result.text,
    /bank/i,
    "The assistant must identify the missing bank.",
  );
  checks.push({
    name: "specific bank clarification",
    passed: true,
    durationMs: result.trace.durationMs,
  });
  result = await agent.turn(owner, "OPay.");
  assert.ok(
    result.prepared,
    "The follow-up must retain the original account and all three tasks.",
  );
  const first = result.prepared.plan;
  assert.equal(first.spec.length, 3);
  assert.equal(
    first.spec.filter(
      (t) =>
        t.input.kind === "bank_transfer" &&
        t.recipient?.accountNumber === "0123456789" &&
        t.amountKobo === 200000,
    ).length,
    1,
  );
  assert.equal(
    first.spec.filter(
      (t) => t.input.kind === "goal_create" && t.amountKobo === 300000,
    ).length,
    1,
  );
  assert.equal(
    first.spec.filter(
      (t) => t.input.kind === "goal_create" && t.amountKobo === 200000,
    ).length,
    1,
  );
  checks.push({
    name: "follow-up retains the whole three-task request",
    passed: true,
    durationMs: result.trace.durationMs,
  });
  result = await agent.turn(
    owner,
    "Change only Rent to 1,500 naira. Keep the transfer and Laptop saving unchanged.",
  );
  assert.ok(
    result.prepared,
    "A correction should produce a revised private review.",
  );
  assert.equal(result.prepared.plan.id, first.id);
  assert.equal(result.prepared.plan.revision, first.revision + 1);
  assert.equal(result.prepared.plan.spec.length, 3);
  assert.equal(
    result.prepared.plan.spec.filter(
      (t) =>
        t.input.kind === "goal_create" &&
        t.input.name.toLowerCase() === "rent" &&
        t.amountKobo === 150000,
    ).length,
    1,
  );
  checks.push({
    name: "edit one task and preserve the other tasks",
    passed: true,
    durationMs: result.trace.durationMs,
  });
  result = await agent.turn(
    owner,
    "Cancel all those tasks. Do not move any money.",
  );
  assert.equal((await core.plan(owner, first.id)).status, "CANCELLED");
  checks.push({
    name: "cancel the review without moving funds",
    passed: true,
    durationMs: result.trace.durationMs,
  });
  result = await agent.turn(owner, "Wetin dey sup?");
  assert.ok(result.text.trim());
  assert.equal(result.prepared, undefined);
  assert.doesNotMatch(result.text, /0123456789/);
  checks.push({
    name: "Pidgin greeting after cancellation has no stale payment",
    passed: true,
    durationMs: result.trace.durationMs,
  });
  const w = await core.workspace(owner);
  assert.equal(w.balanceKobo, 50000000);
  assert.equal(w.receipts.length, 0);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error =
    error instanceof AppError
      ? error.code
      : error instanceof assert.AssertionError
        ? error.message.split("\n")[0]
        : "AGENT_CHECK_FAILED";
  process.exitCode = 1;
} finally {
  await db.close();
}
report.checks = checks;
await mkdir("private", { recursive: true, mode: 0o700 });
await writeFile(
  "private/agent-quality.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
