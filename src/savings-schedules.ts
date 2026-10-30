import type { Core } from "./core.ts";
import type { Query } from "./db.ts";
import type { QuotedTask, Task } from "./contracts.ts";
import { AppError, naira } from "./contracts.ts";
import { account, available, lockAccount, post } from "./ledger.ts";
import { digest, stamp } from "./security.ts";
import { lagosDate } from "./ajo-allocation.ts";
import { randomUUID } from "node:crypto";
const dayMs = 86400000;
export function namedGoalId(owner: string, name: string) {
  const hash = digest(
    owner + ":goal:" + name.trim().normalize("NFKC").toLocaleLowerCase("en-NG"),
  );
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function day(value: string) {
  const date = Date.parse(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== value
  )
    throw new AppError("SCHEDULE_DATES_INVALID");
  return date;
}
function advance(value: string, days: number) {
  return new Date(day(value) + days * dayMs).toISOString().slice(0, 10);
}
export async function quoteSchedule(
  core: Core,
  owner: string,
  input: Extract<Task, { kind: "goal_schedule" }>,
  goals: Record<string, any>[],
) {
  const matches = goals.filter(
    (goal) => goal.name.toLocaleLowerCase() === input.name?.toLocaleLowerCase(),
  );
  if (matches.length > 1) throw new AppError("AMBIGUOUS_GOAL");
  const existing = input.goalId
    ? await core.owned(core.db, owner, input.goalId, "goal")
    : matches[0];
  const goal = existing || {
    id: namedGoalId(owner, input.name!),
    name: input.name!,
  };
  const span = (day(input.endDate) - day(input.startDate)) / dayMs;
  if (input.startDate <= lagosDate() || span < 0 || span > 365)
    throw new AppError("SCHEDULE_DATES_INVALID");
  const maximumRuns =
    Math.floor(span / (input.frequency === "weekly" ? 7 : 1)) + 1;
  let replacesVersion: number | undefined;
  if (input.replacesId) {
    const before = await core.owned(
      core.db,
      owner,
      input.replacesId,
      "savings_schedule",
    );
    if (before.status !== "ACTIVE") throw new AppError("SCHEDULE_CLOSED");
    replacesVersion = before.version;
  }
  return {
    id: randomUUID(),
    goalId: goal.id,
    goalName: goal.name,
    createGoal: !existing,
    amountKobo: input.amountKobo,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate,
    maximumRuns,
    maximumKobo: maximumRuns * input.amountKobo,
    ...(input.replacesId
      ? { replacesId: input.replacesId, replacesVersion }
      : {}),
  } satisfies NonNullable<QuotedTask["savingsSchedule"]>;
}
export async function activateSchedule(
  core: Core,
  q: Query,
  owner: string,
  task: QuotedTask,
  planId: string,
) {
  const schedule = task.savingsSchedule;
  if (!schedule || task.input.kind !== "goal_schedule")
    throw new AppError("INVALID_TASK");
  if (schedule.createGoal) {
    await account(q, "goal:" + schedule.goalId, owner, "savings");
    await q.query(
      "INSERT INTO records(id,kind,owner,data) VALUES($1,'goal',$2,$3) ON CONFLICT(id) DO NOTHING",
      [schedule.goalId, owner, JSON.stringify({ name: schedule.goalName })],
    );
    await core.owned(q, owner, schedule.goalId, "goal");
  } else await core.owned(q, owner, schedule.goalId, "goal");
  if (schedule.replacesId) {
    if (core.db.postgres)
      await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [
        schedule.replacesId,
      ]);
    const before = await core.owned(
      q,
      owner,
      schedule.replacesId,
      "savings_schedule",
    );
    if (
      before.status !== "ACTIVE" ||
      before.version !== schedule.replacesVersion
    )
      throw new AppError("REVIEW_CHANGED", 409);
    const { id, version, ...data } = before;
    await q.query("UPDATE records SET data=$1,version=version+1 WHERE id=$2", [
      JSON.stringify({
        ...data,
        status: "CANCELLED",
        cancelledAt: stamp(),
        replacedBy: schedule.id,
      }),
      id,
    ]);
  }
  await core.put(q, schedule.id, owner, "savings_schedule", {
    ...schedule,
    status: "ACTIVE",
    nextDate: schedule.startDate,
    authorizedAt: stamp(),
    authorizationPlanId: planId,
    authorizationTaskId: task.id,
  });
}
export async function cancelSchedule(core: Core, owner: string, id: string) {
  return core.db.transaction(async (q) => {
    if (core.db.postgres)
      await q.query(
        "SELECT id FROM records WHERE id=$1 AND owner=$2 FOR UPDATE",
        [id, owner],
      );
    const schedule = await core.owned(q, owner, id, "savings_schedule");
    if (schedule.status === "ACTIVE") {
      const { id: key, version, ...data } = schedule;
      await q.query(
        "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
        [
          JSON.stringify({
            ...data,
            status: "CANCELLED",
            cancelledAt: stamp(),
          }),
          key,
        ],
      );
    }
    return {
      id,
      status: schedule.status === "ACTIVE" ? "CANCELLED" : schedule.status,
      previousTransfersReversed: false,
    };
  });
}
export async function runSchedules(core: Core, at = Date.now()) {
  const today = lagosDate(at),
    status = core.db.postgres
      ? "data::jsonb->>'status'"
      : "json_extract(data,'$.status')",
    next = core.db.postgres
      ? "data::jsonb->>'nextDate'"
      : "json_extract(data,'$.nextDate')";
  const due = (
    await core.db.query(
      "SELECT id,owner FROM records WHERE kind='savings_schedule' AND " +
        status +
        "='ACTIVE' AND " +
        next +
        "<=$1 ORDER BY " +
        next +
        ",id LIMIT 50",
      [today],
    )
  ).rows;
  for (const row of due)
    await core.db.transaction(async (q) => {
      if (core.db.postgres)
        await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [
          row.id,
        ]);
      const original = await core.owned(
        q,
        row.owner,
        row.id,
        "savings_schedule",
      );
      if (original.status !== "ACTIVE" || original.nextDate > today) return;
      const { id, version, ...data } = original,
        step = data.frequency === "weekly" ? 7 : 1;
      let runDate = data.nextDate;
      if (runDate < today) {
        const missed = Math.min(
          Math.ceil((day(today) - day(runDate)) / (step * dayMs)),
          Math.floor((day(data.endDate) - day(runDate)) / (step * dayMs)) + 1,
        );
        if (missed > 0) {
          await core.put(
            q,
            "schedule-missed:" + id + ":" + runDate,
            row.owner,
            "savings_run",
            {
              scheduleId: id,
              status: "SKIPPED_OFFLINE",
              from: runDate,
              missedRuns: missed,
              createdAt: new Date(at).toISOString(),
            },
          );
          runDate = advance(runDate, missed * step);
        }
      }
      if (
        runDate <= data.endDate &&
        runDate === today &&
        at >= Date.parse(runDate + "T09:00:00+01:00")
      ) {
        const runKey = "schedule-run:" + id + ":" + runDate;
        const existing = (
          await q.query("SELECT id FROM records WHERE id=$1", [runKey])
        ).rows[0];
        if (!existing) {
          await lockAccount(q, core.db, "wallet:" + row.owner);
          if ((await available(q, "wallet:" + row.owner)) < data.amountKobo) {
            await core.put(q, runKey, row.owner, "savings_run", {
              scheduleId: id,
              date: runDate,
              amountKobo: data.amountKobo,
              status: "SKIPPED_INSUFFICIENT_FUNDS",
              createdAt: new Date(at).toISOString(),
            });
          } else {
            await core.owned(q, row.owner, data.goalId, "goal");
            const planId = randomUUID(),
              taskId = randomUUID(),
              receiptId = randomUUID(),
              createdAt = stamp();
            const task: QuotedTask = {
              id: taskId,
              input: {
                kind: "goal_deposit",
                goalId: data.goalId,
                amountKobo: data.amountKobo,
              },
              source: "wallet:" + row.owner,
              target: "goal:" + data.goalId,
              amountKobo: data.amountKobo,
              feeKobo: 0,
              label: "Scheduled saving",
              destination: data.goalName,
              goalId: data.goalId,
              dependsOn: [],
            };
            await post(q, taskId, [
              { account: task.source!, amount: -data.amountKobo },
              { account: task.target!, amount: data.amountKobo },
            ]);
            await q.query(
              "INSERT INTO plans(id,owner,revision,status,spec,digest,expires_at,created_at,request_key) VALUES($1,$2,1,'SUCCEEDED',$3,$4,$5,$5,$6)",
              [
                planId,
                row.owner,
                JSON.stringify([task]),
                digest(JSON.stringify([task])),
                createdAt,
                runKey,
              ],
            );
            await q.query(
              "INSERT INTO tasks(id,plan,position,status,receipt) VALUES($1,$2,0,'SETTLED',$3)",
              [taskId, planId, receiptId],
            );
            await core.put(q, receiptId, row.owner, "receipt", {
              planId,
              taskId,
              kind: "goal_deposit",
              status: "SETTLED",
              direction: "debit",
              label: task.label,
              destination: data.goalName,
              amountKobo: data.amountKobo,
              feeKobo: 0,
              reference: "PW-" + taskId,
              createdAt,
              scheduleId: id,
              authorizedByPlanId: data.authorizationPlanId,
            });
            await core.enqueue(q, "receipt:" + taskId, "receipt", row.owner, {
              receiptId,
            });
            await core.put(q, runKey, row.owner, "savings_run", {
              scheduleId: id,
              planId,
              taskId,
              date: runDate,
              amountKobo: data.amountKobo,
              status: "SETTLED",
              createdAt,
            });
          }
        }
        runDate = advance(runDate, step);
      }
      const nextDate = runDate <= data.endDate ? runDate : null,
        nextStatus = runDate <= data.endDate ? "ACTIVE" : "COMPLETED";
      if (nextDate !== data.nextDate || nextStatus !== data.status)
        await q.query(
          "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
          [JSON.stringify({ ...data, nextDate, status: nextStatus }), id],
        );
    });
}
