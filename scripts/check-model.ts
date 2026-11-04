import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createModel } from "../src/ai/model.ts";
import { aiReadiness } from "../src/ai/readiness.ts";
import { Agent } from "../src/ai/agent.ts";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { AppError } from "../src/contracts.ts";
import {
  GROQ_ORIGIN,
  DEFAULT_GROQ_SPEECH_MODEL,
  providerJson,
} from "../src/ai/groq.ts";

const env = { ...process.env };
if (process.argv.includes("--cloudflare")) env.AI_PROVIDER = "cloudflare";
const override = process.argv.indexOf("--model");
if (override !== -1) {
  if (
    !process.argv[override + 1] ||
    process.argv[override + 1].startsWith("--")
  )
    throw Error("--model requires an exact model identifier.");
  if (env.AI_PROVIDER === "cloudflare")
    env.CLOUDFLARE_MODEL = process.argv[override + 1];
  else env.GROQ_MODEL = process.argv[override + 1];
}
const ai = aiReadiness(env),
  provider = ai.aiProvider;
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  provider,
  model: ai.model,
  metaReasoningModel: ai.metaModelSelected,
  credentialPresent: ai.aiKey,
  plannerAvailable: false,
  speechAvailable: false,
  visionAvailable: false,
  inferencePassed: false,
  multiTaskPrepared: false,
  financialMode: "sandbox",
};
try {
  if (!["groq", "cloudflare"].includes(provider))
    throw new AppError("PROVIDER_CHECK_UNSUPPORTED");
  if (env.GROQ_API_KEY) {
    const available = await providerJson(
      await fetch(GROQ_ORIGIN + "/models", {
        headers: { authorization: "Bearer " + env.GROQ_API_KEY },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      }),
    );
    const ids = new Set(
      (available.data || [])
        .filter((m: any) => m.active !== false)
        .map((m: any) => m.id),
    );
    report.speechAvailable = ids.has(
      env.GROQ_SPEECH_MODEL || DEFAULT_GROQ_SPEECH_MODEL,
    );
    report.visionAvailable =
      !!env.GROQ_VISION_MODEL && ids.has(env.GROQ_VISION_MODEL);
    if (provider === "groq") {
      report.plannerAvailable = ids.has(ai.model);
      if (!report.plannerAvailable) throw new AppError("AI_MODEL_UNAVAILABLE");
    }
  }
  if (!ai.aiKey) throw new AppError("AI_NOT_CONFIGURED");
  if (process.argv.includes("--exercise")) {
    const db = await openStore({ file: ":memory:" });
    try {
      const core = new Core(db),
        owner = await core.userForPhone("2348000000001");
      await core.setup(owner, "Ada Example", "1234");
      const agent = new Agent(
        core,
        createModel(env),
        randomBytes(32).toString("hex"),
      );
      const start = Date.now();
      const result = await agent.turn(
        owner,
        "Send 2,000 naira to account 0123456789 at OPay, save 3,000 naira for my laptop and save 2,000 naira for rent. Prepare all three together.",
      );
      report.inferencePassed = true;
      report.plannerAvailable = true;
      report.durationMs = Date.now() - start;
      report.toolsUsed = result.trace.tools;
      const tasks = result.prepared?.plan.spec || [];
      report.multiTaskPrepared =
        tasks.length === 3 &&
        tasks.filter(
          (t) =>
            t.input.kind === "bank_transfer" &&
            t.amountKobo === 200000 &&
            t.recipient?.accountNumber === "0123456789",
        ).length === 1 &&
        tasks.filter(
          (t) =>
            t.input.kind === "goal_create" &&
            t.input.name.toLowerCase() === "laptop" &&
            t.amountKobo === 300000,
        ).length === 1 &&
        tasks.filter(
          (t) =>
            t.input.kind === "goal_create" &&
            t.input.name.toLowerCase() === "rent" &&
            t.amountKobo === 200000,
        ).length === 1;
      const wallet = await core.workspace(owner);
      if (wallet.balanceKobo !== 50000000 || wallet.receipts.length)
        throw new AppError("UNEXPECTED_MONEY_MOVEMENT");
      report.unapprovedMoneyMovement = false;
      if (!report.multiTaskPrepared || !result.prepared)
        throw new AppError("MODEL_EXERCISE_FAILED");
      await core.approve(
        owner,
        result.prepared.plan.id,
        result.prepared.plan.revision,
        "1234",
      );
      await core.drain();
      const completed = await core.plan(owner, result.prepared.plan.id);
      const settled = await core.workspace(owner);
      report.sandboxExecutionPassed =
        completed.status === "SUCCEEDED" &&
        settled.balanceKobo === 49300000 &&
        settled.receipts.length === 3;
      if (!report.sandboxExecutionPassed)
        throw new AppError("MODEL_EXECUTION_CHECK_FAILED");
    } finally {
      await db.close();
    }
  } else if (provider === "cloudflare") {
    const value = await createModel(env).complete(
      [{ role: "user", content: "Reply with OK." }],
      [],
    );
    report.inferencePassed = !!value.text;
    report.plannerAvailable = !!value.text;
  }
} catch (error) {
  report.error =
    error instanceof AppError ? error.code : "PROVIDER_CHECK_FAILED";
  process.exitCode = 1;
}
await mkdir("private", { recursive: true, mode: 0o700 });
await writeFile(
  "private/" + provider + "-readiness.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
