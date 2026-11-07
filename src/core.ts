import { randomUUID, createHash } from "node:crypto";
import type { Store, Query, Row } from "./db.ts";
import { AppError, PlanInput, naira, safeInteger } from "./contracts.ts";
import type {
  Task,
  QuotedTask,
  Plan,
  PreparationProgress,
} from "./contracts.ts";
import { account, available, balance, lockAccount, post } from "./ledger.ts";
import {
  stamp,
  future,
  digest,
  hashPin,
  checkPin,
  createCapability,
} from "./security.ts";
import { SandboxRail, banks, products } from "./providers/sandbox.ts";
import type { Rail } from "./providers/sandbox.ts";
import {
  allocateContribution,
  contributionCapacity,
  contributionSummary,
  lagosDate,
} from "./ajo-allocation.ts";
import {
  FeePolicy,
  Agreement,
  acceptedTerms,
  invitationCode,
  bookRules,
} from "./ajo-terms.ts";
import {
  quoteSchedule,
  activateSchedule,
  namedGoalId,
} from "./savings-schedules.ts";

const runnableJobs =
  "((status='QUEUED' AND (lease_until IS NULL OR lease_until<=$1)) OR (status='RUNNING' AND lease_until<=$1)) AND NOT EXISTS (SELECT 1 FROM jobs active WHERE active.owner=jobs.owner AND active.kind=jobs.kind AND active.kind<>'task' AND active.id<>jobs.id AND active.status='RUNNING' AND active.lease_until>$1) AND (jobs.kind<>'task' OR NOT EXISTS (SELECT 1 FROM task_dependencies edge JOIN tasks prerequisite ON prerequisite.id=edge.dependency WHERE edge.task=jobs.id AND prerequisite.status NOT IN ('SETTLED','FAILED','NOT_STARTED','CANCELLED')))";

export class Core {
  db: Store;
  rail: Rail;
  constructor(db: Store, rail: Rail = new SandboxRail(db)) {
    this.db = db;
    this.rail = rail;
  }
  async getUser(id: string): Promise<{
    id: string;
    phone: string;
    name: string;
    language: string;
    organizer: number;
    ready: boolean;
  }> {
    const user = (
      await this.db.query(
        "SELECT id,phone,name,language,organizer,pin_hash FROM users WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!user) throw new AppError("NOT_FOUND", 404);
    const { pin_hash, ...publicUser } = user;
    return { ...publicUser, ready: !!pin_hash } as any;
  }
  async userForPhone(phone: string) {
    if (!/^234\d{10}$/.test(phone)) throw new AppError("INVALID_PHONE");
    return this.db.transaction(async (q) => {
      let user = (await q.query("SELECT id FROM users WHERE phone=$1", [phone]))
        .rows[0];
      if (!user) {
        user = { id: randomUUID() };
        await q.query(
          "INSERT INTO users(id,phone,name,language,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(phone) DO NOTHING",
          [user.id, phone, "", "en", stamp()],
        );
        user = (await q.query("SELECT id FROM users WHERE phone=$1", [phone]))
          .rows[0];
      }
      return user.id as string;
    });
  }
  async setup(owner: string, name: string, pin: string) {
    if (name.trim().length < 2 || name.length > 100)
      throw new AppError("INVALID_NAME");
    const hashed = await hashPin(pin);
    await this.db.transaction(async (q) => {
      const user = (
        await q.query(
          "SELECT * FROM users WHERE id=$1" +
            (this.db.postgres ? " FOR UPDATE" : ""),
          [owner],
        )
      ).rows[0];
      if (!user) throw new AppError("NOT_FOUND", 404);
      if (user.pin_hash) throw new AppError("ALREADY_OPEN", 409);
      await q.query("UPDATE users SET name=$1,pin_hash=$2 WHERE id=$3", [
        name.trim(),
        hashed,
        owner,
      ]);
      await account(q, `wallet:${owner}`, owner, "wallet");
      await account(q, "system:seed", "system", "sandbox");
      await account(q, "system:clearing", "system", "clearing");
      await account(q, "system:fees", "system", "fees");
      await post(q, "opening:" + owner, [
        { account: "system:seed", amount: -50_000_000 },
        { account: `wallet:${owner}`, amount: 50_000_000 },
      ]);
      await this.enqueue(q, "welcome:" + owner, "welcome", owner, {});
    });
    return this.workspace(owner);
  }
  async records(owner: string, kind: string) {
    return (
      await this.db.query(
        "SELECT id,data,version FROM records WHERE owner=$1 AND kind=$2",
        [owner, kind],
      )
    ).rows
      .map((row) => ({
        id: row.id,
        ...JSON.parse(row.data),
        version: row.version,
      }))
      .filter(
        (row) =>
          !["conversation", "reply", "media_result", "progress"].includes(
            kind,
          ) || row.updatedAt > future(-86400000),
      );
  }
  async owned(q: Query, owner: string, id: string, kind: string) {
    const row = (
      await q.query(
        "SELECT * FROM records WHERE id=$1 AND owner=$2 AND kind=$3",
        [id, owner, kind],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return { id: row.id, ...JSON.parse(row.data), version: row.version };
  }
  async put(q: Query, id: string, owner: string, kind: string, data: unknown) {
    await q.query(
      "INSERT INTO records(id,kind,owner,data) VALUES($1,$2,$3,$4)",
      [id, kind, owner, JSON.stringify(data)],
    );
  }
  async membership(q: Query, actor: string, id: string) {
    const row = (
      await q.query("SELECT * FROM records WHERE id=$1 AND kind='member'", [id])
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    const value = { id: row.id, organizer: row.owner, ...JSON.parse(row.data) };
    if (value.organizer !== actor && value.userId !== actor)
      throw new AppError("FORBIDDEN", 403);
    return value;
  }
  async workspace(owner: string) {
    const memberOwner = this.db.postgres
      ? "data::jsonb->>'userId'"
      : "json_extract(data,'$.userId')";
    const [
      user,
      goals,
      members,
      linked,
      books,
      receipts,
      plans,
      imports,
      importRows,
      balances,
      beneficiaries,
      schedules,
      savingsRuns,
      organizerApplications,
    ] = await Promise.all([
      this.getUser(owner),
      this.records(owner, "goal"),
      this.records(owner, "member"),
      this.db.query(
        "SELECT id,owner,data FROM records WHERE kind='member' AND " +
          memberOwner +
          "=$1 AND owner<>$1",
        [owner],
      ),
      this.records(owner, "book"),
      this.records(owner, "receipt"),
      this.db.query(
        "SELECT id,status,created_at FROM plans WHERE owner=$1 ORDER BY created_at DESC LIMIT 20",
        [owner],
      ),
      this.records(owner, "import"),
      this.records(owner, "import_row"),
      this.db.query(
        "WITH l AS (SELECT account,SUM(amount) AS total FROM postings GROUP BY account),h AS (SELECT account,SUM(amount) AS total FROM holds WHERE active=1 GROUP BY account) SELECT a.id,COALESCE(l.total,0) AS balance,COALESCE(l.total,0)-COALESCE(h.total,0) AS available FROM accounts a LEFT JOIN l ON l.account=a.id LEFT JOIN h ON h.account=a.id WHERE a.owner=$1 OR a.id IN (SELECT 'ajo:' || id FROM records WHERE kind='member' AND " +
          memberOwner +
          "=$1)",
        [owner],
      ),
      this.records(owner, "beneficiary"),
      this.records(owner, "savings_schedule"),
      this.records(owner, "savings_run"),
      this.records(owner, "organizer_application"),
    ]);
    const totals = new Map(
      balances.rows.map((row) => [
        row.id,
        {
          balance: safeInteger(row.balance),
          available: safeInteger(row.available),
        },
      ]),
    );
    const memberRows = [
      ...members.map((row) => ({ ...row, organizer: owner })),
      ...linked.rows.map((row) => ({
        id: row.id,
        organizer: row.owner,
        ...JSON.parse(row.data),
      })),
    ];
    return {
      user,
      beneficiaries,
      schedules,
      organizerApplications: organizerApplications.map(
        ({ sealed, ...application }) => application,
      ),
      savingsRuns: savingsRuns
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
      funding: await this.fundingDetails(owner),
      balanceKobo: totals.get("wallet:" + owner)?.balance || 0,
      availableKobo: totals.get("wallet:" + owner)?.available || 0,
      goals: goals.map((goal) => ({
        ...goal,
        balanceKobo: totals.get("goal:" + goal.id)?.balance || 0,
      })),
      books,
      members: memberRows.map((member) => ({
        ...member,
        fundedKobo: totals.get("ajo:" + member.id)?.balance || 0,
        contribution:
          member.contributedKobo === undefined
            ? null
            : contributionSummary(member, member.contributedKobo),
      })),
      plans: plans.rows,
      receipts: receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      imports: imports.map((candidate) => ({
        ...candidate,
        rows: importRows.filter((row) => row.importId === candidate.id),
      })),
      banks,
      products,
      sandbox: true,
    };
  }
  async fundingDetails(owner: string) {
    const user = await this.getUser(owner);
    const bytes = createHash("sha256").update(owner).digest();
    return {
      name: user.name,
      accountNumber:
        "8" + [...bytes.subarray(0, 9)].map((value) => value % 10).join(""),
      bankName: "PayWella sandbox bank",
      currency: "NGN",
      payable: false,
    };
  }
  async statement(owner: string, start: string, end: string) {
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (
      !date.test(start) ||
      !date.test(end) ||
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      start > end ||
      Date.parse(end) - Date.parse(start) > 366 * 86400000
    )
      throw new AppError("INVALID_STATEMENT_PERIOD");
    if (
      new Date(start).toISOString().slice(0, 10) !== start ||
      new Date(end).toISOString().slice(0, 10) !== end
    )
      throw new AppError("INVALID_STATEMENT_PERIOD");
    const from = new Date(start + "T00:00:00+01:00").toISOString(),
      until = new Date(
        Date.parse(end + "T00:00:00+01:00") + 86400000,
      ).toISOString();
    return this.db.transaction(async (q) => {
      const user = (
        await q.query("SELECT name,phone FROM users WHERE id=$1", [owner])
      ).rows[0];
      if (!user) throw new AppError("NOT_FOUND", 404);
      const opening = safeInteger(
        (
          await q.query(
            "SELECT COALESCE(SUM(p.amount),0) AS total FROM postings p JOIN journals j ON j.id=p.journal WHERE p.account=$1 AND j.created_at<$2",
            ["wallet:" + owner, from],
          )
        ).rows[0].total,
      );
      const rows = (
        await q.query(
          "SELECT j.id,j.reference,j.created_at,SUM(p.amount) AS amount FROM postings p JOIN journals j ON j.id=p.journal WHERE p.account=$1 AND j.created_at>=$2 AND j.created_at<$3 GROUP BY j.id,j.reference,j.created_at ORDER BY j.created_at,j.id LIMIT 1001",
          ["wallet:" + owner, from, until],
        )
      ).rows;
      if (rows.length > 1000) throw new AppError("STATEMENT_TOO_LARGE");
      const details = new Map<string, Row>(
        (
          await q.query(
            "SELECT data FROM records WHERE owner=$1 AND kind='receipt'",
            [owner],
          )
        ).rows.map((row) => {
          const receipt = JSON.parse(row.data);
          return [receipt.taskId, receipt];
        }),
      );
      let running = opening;
      const entries = rows.map((row) => {
        const amount = safeInteger(row.amount);
        running += amount;
        return {
          reference: row.reference,
          date: row.created_at,
          creditKobo: Math.max(0, amount),
          debitKobo: Math.max(0, -amount),
          balanceKobo: running,
          status: "POSTED",
          description: row.reference.startsWith("opening:")
            ? "Opening test credit"
            : details.has(row.reference)
              ? details.get(row.reference)!.label +
                " · " +
                (details.get(row.reference)!.destination || "Your account")
              : amount > 0
                ? "Wallet credit"
                : "Wallet debit",
        };
      });
      return {
        name: user.name,
        start,
        end,
        openingKobo: opening,
        closingKobo: running,
        entries,
        generatedAt: stamp(),
        sandbox: true,
      };
    });
  }
  async saveBeneficiary(
    owner: string,
    bankCode: string,
    accountNumber: string,
    alias?: string,
  ) {
    const name = await this.rail.enquire(bankCode, accountNumber),
      id = digest(owner + ":" + bankCode + ":" + accountNumber);
    if (alias && alias.trim().length > 60) throw new AppError("INVALID_NAME");
    const data = {
      name,
      bankCode,
      accountNumber,
      ...(alias?.trim() ? { alias: alias.trim() } : {}),
      updatedAt: stamp(),
    };
    await this.db.query(
      "INSERT INTO records(id,kind,owner,data) VALUES($1,'beneficiary',$2,$3) ON CONFLICT(id) DO UPDATE SET data=$3,version=records.version+1",
      [id, owner, JSON.stringify(data)],
    );
    return { id, ...data };
  }
  async onboardingLink(owner: string) {
    return createCapability(
      this.db,
      owner,
      (await this.getUser(owner)).ready ? "workspace" : "setup",
    );
  }
  async cleanup() {
    const cutoff = future(-86400000),
      now = stamp(),
      field = this.db.postgres
        ? "data::jsonb->>'updatedAt'"
        : "json_extract(data,'$.updatedAt')";
    await this.db.transaction(async (q) => {
      await q.query(
        "DELETE FROM records WHERE kind IN ('conversation','reply','media_result','progress','membership_proposal') AND " +
          field +
          "<$1",
        [cutoff],
      );
      await q.query(
        "UPDATE jobs SET payload='{}' WHERE status IN ('DONE','FAILED','UNKNOWN','BLOCKED') AND created_at<$1",
        [cutoff],
      );
      await q.query("DELETE FROM capabilities WHERE expires_at<$1", [cutoff]);
      await q.query("DELETE FROM sessions WHERE expires_at<$1", [now]);
      await q.query(
        "UPDATE tasks SET status='CANCELLED' WHERE status='DRAFT' AND plan IN (SELECT id FROM plans WHERE status='READY' AND expires_at<=$1)",
        [now],
      );
      await q.query(
        "UPDATE plans SET status='EXPIRED' WHERE status='READY' AND expires_at<=$1",
        [now],
      );
    });
  }
  async prepare(
    owner: string,
    input: unknown,
    requestKey: string | null = null,
    edit?: { id: string; revision: number },
    progress: (value: PreparationProgress) => Promise<void> = async () => {},
  ) {
    if (requestKey && !edit) {
      const existing = (
        await this.db.query(
          "SELECT id FROM plans WHERE owner=$1 AND request_key=$2",
          [owner, requestKey],
        )
      ).rows[0];
      if (existing) {
        const plan = await this.plan(owner, existing.id);
        return {
          plan,
          capability: await createCapability(
            this.db,
            owner,
            "review",
            existing.id,
            plan.revision,
          ),
        };
      }
    }
    const { tasks } = PlanInput.parse(input),
      user = await this.getUser(owner);
    for (const task of tasks)
      if (task.kind === "bank_transfer") {
        const supplied = task.bankCode.trim().toLowerCase();
        const bank = banks.find(
          (bank) =>
            bank.code.toLowerCase() === supplied ||
            bank.name.toLowerCase() === supplied,
        );
        if (!bank) throw new AppError("INVALID_RECIPIENT");
        task.bankCode = bank.code;
      }
    if (!user.ready) throw new AppError("SETUP_REQUIRED");
    const id = edit?.id || randomUUID(),
      quoted: QuotedTask[] = [],
      goals = await this.records(owner, "goal");
    const contributions = new Map<string, number>(),
      payoutFees = new Map<string, number>();
    for (const task of tasks) {
      await progress({
        stage: "checking",
        taskCount: tasks.length,
        tasks: [
          ...quoted.map((row) => ({
            label: row.label,
            status: "ready" as const,
          })),
          {
            label: task.kind.startsWith("goal_")
              ? "Savings task"
              : task.kind.startsWith("ajo_")
                ? "Ajo task"
                : task.kind === "service"
                  ? "Bill payment"
                  : "Transfer",
            status: "checking",
          },
        ],
      });
      let label = "",
        destination = "",
        source: string | null = `wallet:${owner}`,
        target: string | null = "system:clearing",
        feeKobo = 0,
        goalId: string | undefined;
      let recipient: QuotedTask["recipient"];
      let allocation: QuotedTask["allocation"];
      let savingsSchedule: QuotedTask["savingsSchedule"];
      let amountKobo = task.amountKobo,
        feeTarget: string | undefined,
        cycleFeeBeforeKobo: number | undefined;
      const dependsOn: number[] = [];
      if (task.kind === "bank_transfer") {
        destination = await this.rail.enquire(
          task.bankCode,
          task.accountNumber,
        );
        label = "Bank transfer";
        recipient = {
          name: destination,
          bankCode: task.bankCode,
          bankName: banks.find((bank) => bank.code === task.bankCode)!.name,
          accountNumber: task.accountNumber,
        };
        destination += ` · ${banks.find((b) => b.code === task.bankCode)?.name} · ${task.accountNumber}`;
      } else if (task.kind === "p2p") {
        const recipient = (
          await this.db.query(
            "SELECT id,name,pin_hash FROM users WHERE phone=$1",
            [task.recipientPhone],
          )
        ).rows[0];
        if (!recipient?.pin_hash || recipient.id === owner)
          throw new AppError("RECIPIENT_NOT_AVAILABLE");
        target = `wallet:${recipient.id}`;
        label = "PayWella transfer";
        destination = recipient.name;
      } else if (task.kind === "goal_create") {
        const match = goals.filter(
          (g) => g.name.toLocaleLowerCase() === task.name.toLocaleLowerCase(),
        );
        if (match.length > 1) throw new AppError("AMBIGUOUS_GOAL");
        const prior = quoted.findIndex(
          (q) =>
            q.input.kind === "goal_create" &&
            q.input.name.toLocaleLowerCase() === task.name.toLocaleLowerCase(),
        );
        goalId =
          match[0]?.id ||
          (prior >= 0 ? quoted[prior].goalId : namedGoalId(owner, task.name));
        if (prior >= 0) dependsOn.push(prior);
        target = `goal:${goalId}`;
        label = "Save for " + task.name;
        destination = task.name;
        const previousGoalTask = quoted.findLastIndex(
          (row) => row.goalId === goalId,
        );
        if (previousGoalTask >= 0 && !dependsOn.includes(previousGoalTask))
          dependsOn.push(previousGoalTask);
        if (!goals.some((goal) => goal.id === goalId))
          goals.push({ id: goalId, name: task.name });
      } else if (
        task.kind === "goal_deposit" ||
        task.kind === "goal_withdraw"
      ) {
        const g = await this.owned(this.db, owner, task.goalId, "goal");
        goalId = g.id;
        destination = g.name;
        label =
          task.kind === "goal_deposit" ? "Add to savings" : "Withdraw savings";
        if (task.kind === "goal_deposit") target = `goal:${g.id}`;
        else {
          source = `goal:${g.id}`;
          target = `wallet:${owner}`;
          if (g.lockedUntil && g.lockedUntil > stamp())
            throw new AppError("GOAL_LOCKED");
        }
      } else if (task.kind === "goal_schedule") {
        savingsSchedule = await quoteSchedule(this, owner, task, goals);
        goalId = savingsSchedule.goalId;
        source = null;
        target = null;
        amountKobo = 0;
        label = `Schedule ${naira(task.amountKobo)} ${task.frequency}`;
        destination = savingsSchedule.goalName;
        const previous = quoted.findLastIndex((row) => row.goalId === goalId);
        if (previous >= 0) dependsOn.push(previous);
        if (!goals.some((goal) => goal.id === goalId))
          goals.push({ id: goalId, name: savingsSchedule.goalName });
        if (
          task.replacesId &&
          quoted.some(
            (row) => row.savingsSchedule?.replacesId === task.replacesId,
          )
        )
          throw new AppError("REQUEST_INVALID");
      } else if (task.kind === "service") {
        const product = products.find((p) => p.id === task.productId);
        if (
          !product ||
          task.amountKobo < product.min ||
          task.amountKobo > product.max
        )
          throw new AppError("PRODUCT_QUOTE_CHANGED");
        if (
          product.category !== "electricity" &&
          !/^0[789]\d{9}$/.test(task.customer)
        )
          throw new AppError("INVALID_CUSTOMER_NUMBER");
        const validation = await this.rail.validateService(
          task.productId,
          task.customer,
        );
        label = product.name;
        destination =
          (validation.name ? validation.name + " · " : "") + task.customer;
      } else {
        if (task.kind !== "ajo_contribute" && !user.organizer)
          throw new AppError("ORGANIZER_REQUIRED", 403);
        const member = await this.membership(this.db, owner, task.memberId);
        destination = member.name;
        if (task.kind === "ajo_cash" || task.kind === "ajo_contribute") {
          if (member.contributedKobo === undefined)
            throw new AppError("AJO_RECORD_REVIEW_REQUIRED", 409);
          allocation = allocateContribution(
            member,
            contributions.get(member.id) ?? member.contributedKobo,
            task.amountKobo,
          );
          contributions.set(member.id, allocation.afterKobo);
          const previous = quoted.findLastIndex(
            (row) =>
              (row.input.kind === "ajo_cash" ||
                row.input.kind === "ajo_contribute") &&
              row.input.memberId === member.id,
          );
          if (previous >= 0) dependsOn.push(previous);
        }
        if (task.kind === "ajo_cash") {
          if (member.organizer !== owner) throw new AppError("FORBIDDEN", 403);
          if (task.date > lagosDate())
            throw new AppError("INVALID_COLLECTION_DATE");
          if (task.sourceRow) {
            const row = await this.owned(
              this.db,
              owner,
              task.sourceRow,
              "import_row",
            );
            if (row.status !== "PENDING")
              throw new AppError("IMPORT_ALREADY_RECORDED", 409);
          }
          source = null;
          target = null;
          label = "Record cash collected";
          destination = member.name + " · " + task.date;
        }
        if (task.kind === "ajo_contribute") {
          if (member.userId !== owner) throw new AppError("FORBIDDEN", 403);
          target = `ajo:${member.id}`;
          label = "Ajo contribution";
        }
        if (task.kind === "ajo_replace") {
          if (member.organizer !== owner) throw new AppError("FORBIDDEN", 403);
          if (task.amountKobo > member.cashOutstandingKobo)
            throw new AppError("REPLACEMENT_EXCEEDS_CASH");
          target = `ajo:${member.id}`;
          label = "Fund collected cash";
        }
        if (task.kind === "ajo_payout") {
          if (member.organizer !== owner || !member.userId)
            throw new AppError("MEMBER_ACCOUNT_REQUIRED");
          if (member.maturityDate > lagosDate())
            throw new AppError("NOT_MATURED");
          source = `ajo:${member.id}`;
          target = `wallet:${member.userId}`;
          label = "Ajo payout";
          const feeBefore = safeInteger(
            payoutFees.get(member.id) ?? member.feePaidKobo ?? 0,
          );
          cycleFeeBeforeKobo = feeBefore;
          feeKobo = Math.max(0, (member.agreedFeeKobo || 0) - feeBefore);
          if (task.amountKobo <= feeKobo)
            throw new AppError("AJO_PAYOUT_TOO_SMALL");
          amountKobo = task.amountKobo - feeKobo;
          feeTarget = `wallet:${owner}`;
          payoutFees.set(member.id, feeBefore + feeKobo);
          const previous = quoted.findLastIndex(
            (row) =>
              row.input.kind === "ajo_payout" &&
              row.input.memberId === member.id,
          );
          if (previous >= 0) dependsOn.push(previous);
        }
      }
      quoted.push({
        id: randomUUID(),
        input: task,
        label,
        destination,
        source,
        target,
        amountKobo,
        feeKobo,
        goalId,
        dependsOn,
        ...(recipient ? { recipient } : {}),
        ...(allocation ? { allocation } : {}),
        ...(feeTarget ? { feeTarget, cycleFeeBeforeKobo } : {}),
        ...(savingsSchedule ? { savingsSchedule } : {}),
      });
      await progress({
        stage: "checking",
        taskCount: tasks.length,
        tasks: quoted.map((row) => ({ label: row.label, status: "ready" })),
      });
    }
    const now = stamp(),
      expires = future(300000),
      hash = digest(JSON.stringify(quoted));
    const capability = await this.db.transaction(async (q) => {
      await q.query(
        "UPDATE plans SET status='EXPIRED' WHERE owner=$1 AND status='READY' AND expires_at<=$2",
        [owner, now],
      );
      const open = (
        await q.query(
          "SELECT id FROM plans WHERE owner=$1 AND status='READY' AND expires_at>$2",
          [owner, now],
        )
      ).rows[0];
      if (open && open.id !== edit?.id)
        throw new AppError("REVIEW_ALREADY_OPEN", 409);
      let revision = 1;
      if (edit) {
        if (this.db.postgres)
          await q.query(
            "SELECT id FROM plans WHERE id=$1 AND owner=$2 FOR UPDATE",
            [id, owner],
          );
        const current = await this.plan(owner, id, q);
        if (current.status !== "READY")
          throw new AppError("REVIEW_CLOSED", 409);
        if (current.revision !== edit.revision)
          throw new AppError("REVIEW_CHANGED", 409);
        if (current.expiresAt <= now) throw new AppError("REVIEW_EXPIRED", 409);
        revision = current.revision + 1;
        await q.query(
          "UPDATE plans SET revision=$1,spec=$2,digest=$3,expires_at=$4 WHERE id=$5",
          [revision, JSON.stringify(quoted), hash, expires, id],
        );
        await q.query("DELETE FROM tasks WHERE plan=$1 AND status='DRAFT'", [
          id,
        ]);
        await q.query("UPDATE capabilities SET used=1 WHERE target=$1", [id]);
      } else
        await q.query("INSERT INTO plans VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)", [
          id,
          owner,
          "READY",
          JSON.stringify(quoted),
          hash,
          expires,
          now,
          requestKey,
        ]);
      for (let i = 0; i < quoted.length; i++)
        await q.query(
          "INSERT INTO tasks(id,plan,position,status) VALUES($1,$2,$3,$4)",
          [quoted[i].id, id, i, "DRAFT"],
        );
      return createCapability(q, owner, "review", id, revision);
    });
    return { plan: await this.plan(owner, id), capability };
  }
  async plan(owner: string, id: string, q: Query = this.db): Promise<Plan> {
    const row = (
      await q.query("SELECT * FROM plans WHERE id=$1 AND owner=$2", [id, owner])
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    const tasks = (
      await q.query(
        "SELECT id,status,receipt,error FROM tasks WHERE plan=$1 ORDER BY position",
        [id],
      )
    ).rows;
    return {
      id: row.id,
      owner,
      revision: row.revision,
      status:
        row.status === "READY" && row.expires_at <= stamp()
          ? "EXPIRED"
          : row.status,
      spec: JSON.parse(row.spec),
      digest: row.digest,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      tasks,
    } as Plan;
  }
  async cancel(owner: string, id: string) {
    await this.db.transaction(async (q) => {
      if (this.db.postgres)
        await q.query(
          "SELECT id FROM plans WHERE id=$1 AND owner=$2 FOR UPDATE",
          [id, owner],
        );
      const p = await this.plan(owner, id, q);
      if (p.status === "CANCELLED") return;
      if (p.status !== "READY") throw new AppError("ALREADY_SUBMITTED", 409);
      await q.query("UPDATE plans SET status='CANCELLED' WHERE id=$1", [id]);
      await q.query("UPDATE tasks SET status='CANCELLED' WHERE plan=$1", [id]);
      await q.query("UPDATE capabilities SET used=1 WHERE target=$1", [id]);
    });
    return this.plan(owner, id);
  }
  async approve(
    owner: string,
    id: string,
    revision: number,
    pin: string,
    standingConsent = false,
  ) {
    const current = await this.plan(owner, id);
    if (current.status !== "READY") {
      if (
        current.revision === revision &&
        ["RUNNING", "PENDING", "SUCCEEDED", "PARTIAL", "FAILED"].includes(
          current.status,
        )
      )
        return current;
      throw new AppError("REVIEW_CLOSED", 409);
    }
    if (
      current.spec.some((task) => task.input.kind === "goal_schedule") &&
      !standingConsent
    )
      throw new AppError("SCHEDULE_CONSENT_REQUIRED");
    await checkPin(this.db, owner, pin);
    await this.db.transaction(async (q) => {
      if (this.db.postgres)
        await q.query("SELECT id FROM plans WHERE id=$1 FOR UPDATE", [id]);
      const p = await this.plan(owner, id, q);
      if (p.status !== "READY") return;
      if (p.revision !== revision) throw new AppError("REVIEW_CHANGED", 409);
      if (p.expiresAt <= stamp()) throw new AppError("REVIEW_EXPIRED", 409);
      if (digest(JSON.stringify(p.spec)) !== p.digest)
        throw new AppError("REVIEW_CHANGED", 409);
      const contributionTotals = new Map<string, number>();
      for (const memberId of [
        ...new Set(
          p.spec.flatMap((task) =>
            task.allocation &&
            (task.input.kind === "ajo_cash" ||
              task.input.kind === "ajo_contribute")
              ? [task.input.memberId]
              : [],
          ),
        ),
      ].sort()) {
        if (this.db.postgres)
          await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [
            memberId,
          ]);
        const member = await this.membership(q, owner, memberId);
        contributionTotals.set(memberId, member.contributedKobo);
      }
      for (const task of p.spec)
        if (
          task.allocation &&
          (task.input.kind === "ajo_cash" ||
            task.input.kind === "ajo_contribute")
        ) {
          const member = await this.membership(q, owner, task.input.memberId),
            next = allocateContribution(
              member,
              contributionTotals.get(member.id)!,
              task.amountKobo,
            );
          if (JSON.stringify(next) !== JSON.stringify(task.allocation))
            throw new AppError("AJO_ALLOCATION_CHANGED", 409);
          contributionTotals.set(member.id, next.afterKobo);
        }
      const totals = new Map<string, number>();
      for (const task of p.spec)
        if (task.savingsSchedule?.replacesId) {
          const before = await this.owned(
            q,
            owner,
            task.savingsSchedule.replacesId,
            "savings_schedule",
          );
          if (
            before.status !== "ACTIVE" ||
            before.version !== task.savingsSchedule.replacesVersion
          )
            throw new AppError("REVIEW_CHANGED", 409);
        }
      const checkedFees = new Map<string, number>();
      for (const task of p.spec)
        if (task.input.kind === "ajo_payout") {
          const member = await this.membership(q, owner, task.input.memberId);
          const paid = checkedFees.get(member.id) ?? member.feePaidKobo ?? 0;
          if (
            paid !== task.cycleFeeBeforeKobo ||
            task.feeKobo !== Math.max(0, (member.agreedFeeKobo || 0) - paid)
          )
            throw new AppError("AJO_PAYOUT_CHANGED", 409);
          checkedFees.set(member.id, paid + task.feeKobo);
        }
      for (const task of p.spec)
        if (task.source)
          totals.set(
            task.source,
            (totals.get(task.source) || 0) + task.amountKobo + task.feeKobo,
          );
      for (const [source, total] of [...totals].sort()) {
        await lockAccount(q, this.db, source);
        if ((await available(q, source)) < total)
          throw new AppError("INSUFFICIENT_FUNDS");
      }
      for (const task of p.spec) {
        if (task.source)
          await q.query("INSERT INTO holds VALUES($1,$2,$3,1)", [
            task.id,
            task.source,
            task.amountKobo + task.feeKobo,
          ]);
        await q.query("UPDATE tasks SET status='QUEUED' WHERE id=$1", [
          task.id,
        ]);
        for (const dependency of task.dependsOn)
          await q.query(
            "INSERT INTO task_dependencies(task,dependency) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [task.id, p.spec[dependency].id],
          );
        await this.enqueue(q, task.id, "task", owner, {
          planId: id,
          taskId: task.id,
        });
      }
      await q.query("UPDATE plans SET status='RUNNING' WHERE id=$1", [id]);
      await q.query("UPDATE capabilities SET used=1 WHERE target=$1", [id]);
    });
    return this.plan(owner, id);
  }
  async enqueue(
    q: Query,
    id: string,
    kind: string,
    owner: string,
    payload: unknown,
  ) {
    await q.query(
      "INSERT INTO jobs(id,kind,owner,payload,status,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [id, kind, owner, JSON.stringify(payload), "QUEUED", stamp()],
    );
  }
  async createBook(
    owner: string,
    name: string,
    options: { feePolicy: FeePolicy; rules?: string } = {
      feePolicy: { kind: "none" },
    },
  ) {
    const user = await this.getUser(owner);
    if (!user.organizer) throw new AppError("ORGANIZER_REQUIRED", 403);
    if (!name.trim() || name.length > 60) throw new AppError("INVALID_NAME");
    const id = randomUUID(),
      data = {
        name: name.trim(),
        invite: invitationCode(),
        inviteExpiresAt: future(7 * 86400000),
        inviteRevokedAt: null,
        termsVersion: 1,
        feePolicy: FeePolicy.parse(options.feePolicy),
        rules: bookRules(options.rules),
        createdAt: stamp(),
      };
    await this.put(this.db, id, owner, "book", data);
    return { id, ...data };
  }
  async invitation(q: Query, invite: string) {
    if (!/^[A-Za-z0-9]{8}$/.test(invite))
      throw new AppError("INVITE_NOT_FOUND");
    const field = this.db.postgres
      ? "data::jsonb->>'invite'"
      : "json_extract(data,'$.invite')";
    const row = (
      await q.query(
        "SELECT id,owner,data FROM records WHERE kind='book' AND " +
          field +
          "=$1",
        [invite.toUpperCase()],
      )
    ).rows[0];
    if (!row) {
      const revoked = (
        await q.query(
          "SELECT id FROM records WHERE id=$1 AND kind='invite_revocation'",
          ["revoked-invite:" + digest(invite.toUpperCase())],
        )
      ).rows[0];
      throw new AppError(revoked ? "INVITE_REVOKED" : "INVITE_NOT_FOUND");
    }
    const book = { ...JSON.parse(row.data), id: row.id, organizer: row.owner };
    if (book.inviteRevokedAt) throw new AppError("INVITE_REVOKED");
    if (!book.termsVersion || !book.inviteExpiresAt)
      throw new AppError("AJO_TERMS_REVIEW_REQUIRED");
    if (book.inviteExpiresAt <= stamp()) throw new AppError("INVITE_EXPIRED");
    return book;
  }
  async previewInvitation(owner: string, invite: string) {
    const user = await this.getUser(owner);
    if (!user.ready) throw new AppError("SETUP_REQUIRED");
    const book = await this.invitation(this.db, invite),
      organizer = await this.getUser(book.organizer);
    return {
      id: book.id,
      name: book.name,
      organizerName: organizer.name,
      invite: book.invite,
      inviteExpiresAt: book.inviteExpiresAt,
      termsVersion: book.termsVersion,
      rules: book.rules,
      feePolicy: book.feePolicy,
      model: "individual_daily_thrift",
      noGuaranteedYield: true,
    };
  }
  async proposeMembership(
    owner: string,
    input: {
      invite: string;
      dailyKobo: number;
      maturityDate: string;
      startDate?: string;
    },
  ) {
    const book = await this.previewInvitation(owner, input.invite),
      startDate = input.startDate || lagosDate();
    acceptedTerms(
      book,
      {
        dailyKobo: input.dailyKobo,
        maturityDate: input.maturityDate,
        joinedDate: startDate,
      },
      { consent: true, termsVersion: book.termsVersion },
    );
    const id = randomUUID();
    await this.put(this.db, id, owner, "membership_proposal", {
      ...input,
      startDate,
      termsVersion: book.termsVersion,
      expiresAt: future(300000),
      updatedAt: stamp(),
    });
    return { id, book, privateAgreementRequired: true };
  }
  async membershipProposal(owner: string, id: string) {
    const proposal = await this.owned(
      this.db,
      owner,
      id,
      "membership_proposal",
    );
    if (proposal.expiresAt <= stamp())
      throw new AppError("REVIEW_EXPIRED", 410);
    const book = await this.previewInvitation(owner, proposal.invite);
    if (proposal.termsVersion !== book.termsVersion)
      throw new AppError("AJO_TERMS_CHANGED", 409);
    return { ...proposal, book };
  }
  async changeInvitation(
    owner: string,
    bookId: string,
    action: "rotate" | "revoke",
  ) {
    if (!(await this.getUser(owner)).organizer)
      throw new AppError("ORGANIZER_REQUIRED", 403);
    return this.db.transaction(async (q) => {
      if (this.db.postgres)
        await q.query(
          "SELECT id FROM records WHERE id=$1 AND owner=$2 FOR UPDATE",
          [bookId, owner],
        );
      const book = await this.owned(q, owner, bookId, "book");
      await q.query(
        "INSERT INTO records(id,kind,owner,data) VALUES($1,'invite_revocation',$2,$3) ON CONFLICT(id) DO NOTHING",
        [
          "revoked-invite:" + digest(book.invite),
          owner,
          JSON.stringify({ bookId, revokedAt: stamp() }),
        ],
      );
      const { id, version, ...before } = book;
      const data = {
        ...before,
        termsVersion: before.termsVersion || 1,
        rules: before.rules || bookRules(),
        feePolicy: before.feePolicy || { kind: "none" },
        ...(action === "rotate"
          ? {
              invite: invitationCode(),
              inviteExpiresAt: future(7 * 86400000),
              inviteRevokedAt: null,
            }
          : { inviteRevokedAt: stamp() }),
      };
      await q.query(
        "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
        [JSON.stringify(data), id],
      );
      await this.put(q, randomUUID(), owner, "book_event", {
        bookId,
        action,
        createdAt: stamp(),
      });
      return { id, ...data };
    });
  }
  async addMember(
    owner: string,
    bookId: string,
    input: {
      name: string;
      dailyKobo: number;
      maturityDate: string;
      startDate?: string;
      consentConfirmed: true;
    },
  ) {
    if (!(await this.getUser(owner)).organizer)
      throw new AppError("ORGANIZER_REQUIRED", 403);
    const book = await this.owned(this.db, owner, bookId, "book");
    if (input.consentConfirmed !== true)
      throw new AppError("AJO_CONSENT_REQUIRED");
    if (
      !input.name.trim() ||
      !Number.isSafeInteger(input.dailyKobo) ||
      input.dailyKobo < 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.maturityDate)
    )
      throw new AppError("INVALID_MEMBER");
    if ("userId" in input) throw new AppError("AJO_PRIVATE_JOIN_REQUIRED");
    const joinedDate = input.startDate || lagosDate();
    const agreement = acceptedTerms(
      book,
      { ...input, joinedDate },
      { termsVersion: book.termsVersion, consent: true },
    );
    const id = randomUUID();
    await this.db.transaction(async (q) => {
      await this.put(q, id, owner, "member", {
        ...input,
        bookId,
        cashOutstandingKobo: 0,
        joinedDate,
        contributedKobo: 0,
        agreement: { ...agreement, acceptedAt: stamp(), representedBy: owner },
        agreedFeeKobo: agreement.agreedFeeKobo,
        feePaidKobo: 0,
      });
      await account(q, `ajo:${id}`, owner, "member_principal");
    });
    return { id, ...input };
  }
  async joinBook(
    owner: string,
    invite: string,
    dailyKobo: number,
    maturityDate: string,
    startDate = lagosDate(),
    agreement?: Agreement,
  ) {
    const book = await this.invitation(this.db, invite);
    const user = await this.getUser(owner);
    if (!user.ready) throw new AppError("SETUP_REQUIRED");
    const terms = acceptedTerms(
      book,
      { joinedDate: startDate, maturityDate, dailyKobo },
      agreement,
    );
    if (
      !Number.isSafeInteger(dailyKobo) ||
      dailyKobo < 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(maturityDate)
    )
      throw new AppError("INVALID_MEMBER");
    const hash = createHash("sha256")
        .update(book.id + owner)
        .digest("hex"),
      id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return this.db.transaction(async (q) => {
      if (this.db.postgres)
        await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [
          book.id,
        ]);
      const currentBook = await this.invitation(q, invite);
      if (
        currentBook.id !== book.id ||
        currentBook.termsVersion !== terms.termsVersion
      )
        throw new AppError("AJO_TERMS_CHANGED", 409);
      const current = (
        await q.query("SELECT data FROM records WHERE id=$1", [id])
      ).rows[0];
      if (current) {
        const data = JSON.parse(current.data);
        if (
          data.dailyKobo !== dailyKobo ||
          data.maturityDate !== maturityDate ||
          data.joinedDate !== startDate
        )
          throw new AppError("AJO_ALREADY_JOINED", 409);
        return { id, ...data };
      }
      const data = {
        name: user.name,
        userId: owner,
        dailyKobo,
        maturityDate,
        bookId: book.id,
        cashOutstandingKobo: 0,
        joinedDate: startDate,
        contributedKobo: 0,
        agreement: { ...terms, acceptedAt: stamp(), acceptedBy: owner },
        agreedFeeKobo: terms.agreedFeeKobo,
        feePaidKobo: 0,
      };
      await this.put(q, id, book.organizer, "member", data);
      await account(q, `ajo:${id}`, book.organizer, "member_principal");
      return { id, ...data };
    });
  }
  async receipt(owner: string, id: string) {
    return this.owned(this.db, owner, id, "receipt");
  }
  async runnableJobKinds(): Promise<Set<string>> {
    const result = await this.db.query(
      "SELECT DISTINCT kind FROM jobs WHERE " + runnableJobs,
      [stamp()],
    );
    return new Set(result.rows.map((row) => row.kind));
  }
  async nextJobRetry(): Promise<number | null> {
    const row = (
      await this.db.query(
        "SELECT MIN(lease_until) AS due FROM jobs WHERE status='QUEUED' AND lease_until>$1",
        [stamp()],
      )
    ).rows[0];
    return row?.due ? Date.parse(row.due) : null;
  }
  async claim(kind = "task"): Promise<Row | null> {
    return this.db.transaction(async (q) => {
      const row = (
        await q.query(
          "SELECT * FROM jobs WHERE kind=$2 AND " +
            runnableJobs +
            " ORDER BY created_at LIMIT 1" +
            (this.db.postgres ? " FOR UPDATE SKIP LOCKED" : ""),
          [stamp(), kind],
        )
      ).rows[0];
      if (!row) return null;
      await q.query(
        "UPDATE jobs SET status='RUNNING',lease_until=$1,attempts=attempts+1 WHERE id=$2",
        [future(120000), row.id],
      );
      return { ...row, payload: JSON.parse(row.payload) };
    });
  }
  async refreshPlan(q: Query, id: string) {
    const statuses = (
      await q.query("SELECT status FROM tasks WHERE plan=$1", [id])
    ).rows.map((t) => t.status);
    const status = statuses.every((s) => s === "SETTLED")
      ? "SUCCEEDED"
      : statuses.some((s) => ["QUEUED", "PENDING"].includes(s))
        ? "PENDING"
        : statuses.some((s) => s === "SETTLED")
          ? "PARTIAL"
          : "FAILED";
    await q.query("UPDATE plans SET status=$1 WHERE id=$2", [status, id]);
  }
  async execute(job: Row) {
    const p = await this.plan(job.owner, job.payload.planId),
      task = p.spec.find((t) => t.id === job.payload.taskId)!;
    if (!task) throw new AppError("INVALID_TASK");
    const state = p.tasks.find((t) => t.id === task.id)!;
    if (
      ["SETTLED", "FAILED", "CANCELLED", "NOT_STARTED"].includes(state.status)
    ) {
      await this.db.query("UPDATE jobs SET status='DONE' WHERE id=$1", [
        job.id,
      ]);
      return;
    }
    if (
      task.dependsOn.some(
        (i) =>
          !["SETTLED", "FAILED", "NOT_STARTED", "CANCELLED"].includes(
            p.tasks[i].status,
          ),
      )
    ) {
      await this.db.query(
        "UPDATE jobs SET status='QUEUED',lease_until=$1 WHERE id=$2",
        [future(500), job.id],
      );
      return;
    }
    let outcome: { status: string; code?: string; token?: string } = {
      status: "settled",
    };
    if (task.dependsOn.some((i) => p.tasks[i].status !== "SETTLED"))
      outcome = { status: "failed", code: "DEPENDENCY_FAILED" };
    else if (["bank_transfer", "service"].includes(task.input.kind)) {
      const operation = (
        await this.db.query(
          "SELECT id FROM records WHERE id=$1 AND kind='operation'",
          [task.id],
        )
      ).rows[0];
      try {
        if (operation) outcome = await this.rail.lookup(task.id);
        else {
          await this.put(this.db, task.id, job.owner, "operation", {
            reference: task.id,
            plan: p.id,
          });
          outcome = await this.rail.submit(task.id, task.input);
        }
      } catch {
        outcome = { status: "pending", code: "PROVIDER_UNCONFIRMED" };
      }
    }
    await this.db.transaction(async (q) => {
      if (this.db.postgres)
        await q.query("SELECT id FROM plans WHERE id=$1 FOR UPDATE", [p.id]);
      const fresh = (
        await q.query("SELECT status FROM tasks WHERE id=$1", [task.id])
      ).rows[0];
      if (
        ["SETTLED", "FAILED", "CANCELLED", "NOT_STARTED"].includes(fresh.status)
      )
        return;
      if (outcome.status === "pending") {
        await q.query(
          "UPDATE tasks SET status='PENDING',error=$1 WHERE id=$2",
          [outcome.code || null, task.id],
        );
        await q.query(
          "UPDATE jobs SET status='QUEUED',lease_until=$1 WHERE id=$2",
          [future(3000), job.id],
        );
      } else if (outcome.status === "failed") {
        await q.query("UPDATE tasks SET status='FAILED',error=$1 WHERE id=$2", [
          outcome.code || "PROVIDER_REJECTED",
          task.id,
        ]);
        await q.query("UPDATE holds SET active=0 WHERE task=$1", [task.id]);
        await q.query("UPDATE jobs SET status='DONE' WHERE id=$1", [job.id]);
      } else {
        if (task.input.kind === "goal_create") {
          await account(q, task.target!, job.owner, "savings");
          if (
            !(
              await q.query(
                "SELECT id FROM records WHERE id=$1 AND kind='goal'",
                [task.goalId],
              )
            ).rows.length
          )
            await q.query(
              "INSERT INTO records(id,kind,owner,data) VALUES($1,'goal',$2,$3) ON CONFLICT(id) DO NOTHING",
              [
                task.goalId!,
                job.owner,
                JSON.stringify({ name: task.input.name }),
              ],
            );
        }
        if (task.input.kind === "goal_schedule")
          await activateSchedule(this, q, job.owner, task, p.id);
        if (
          task.input.kind === "ajo_cash" ||
          task.input.kind === "ajo_contribute" ||
          task.input.kind === "ajo_replace" ||
          task.input.kind === "ajo_payout"
        ) {
          if (this.db.postgres)
            await q.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [
              task.input.memberId,
            ]);
          const member = await this.membership(
            q,
            job.owner,
            task.input.memberId,
          );
          if (
            task.input.kind === "ajo_payout" &&
            ((member.feePaidKobo || 0) !== task.cycleFeeBeforeKobo ||
              task.feeKobo !==
                Math.max(
                  0,
                  (member.agreedFeeKobo || 0) - (member.feePaidKobo || 0),
                ))
          )
            throw new AppError("AJO_PAYOUT_CHANGED", 409);
          if (task.allocation) {
            const actual = allocateContribution(
              member,
              member.contributedKobo,
              task.amountKobo,
            );
            if (JSON.stringify(actual) !== JSON.stringify(task.allocation))
              throw new AppError("AJO_ALLOCATION_CHANGED", 409);
            await this.put(
              q,
              task.id + ":contribution",
              member.organizer,
              "contribution",
              {
                memberId: member.id,
                taskId: task.id,
                planId: p.id,
                source: task.input.kind === "ajo_cash" ? "cash" : "wallet",
                amountKobo: task.amountKobo,
                allocation: actual,
                createdAt: stamp(),
              },
            );
          }
          if (task.input.kind === "ajo_cash" && task.input.sourceRow) {
            const row = await this.owned(
              q,
              job.owner,
              task.input.sourceRow,
              "import_row",
            );
            if (row.status !== "PENDING")
              throw new AppError("IMPORT_ALREADY_RECORDED", 409);
            const { id, version, ...data } = row;
            await q.query(
              "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
              [
                JSON.stringify({
                  ...data,
                  status: "RECORDED",
                  taskId: task.id,
                }),
                id,
              ],
            );
          }
          const delta =
            task.input.kind === "ajo_cash"
              ? task.amountKobo
              : task.input.kind === "ajo_replace"
                ? -task.amountKobo
                : 0;
          if (member.cashOutstandingKobo + delta < 0)
            throw new AppError("REPLACEMENT_EXCEEDS_CASH");
          const { id: memberId, organizer, ...data } = member;
          await q.query(
            "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
            [
              JSON.stringify({
                ...data,
                cashOutstandingKobo: member.cashOutstandingKobo + delta,
                ...(task.allocation
                  ? { contributedKobo: task.allocation.afterKobo }
                  : {}),
                ...(task.input.kind === "ajo_payout"
                  ? {
                      feePaidKobo: (member.feePaidKobo || 0) + task.feeKobo,
                      paidOutPrincipalKobo:
                        (member.paidOutPrincipalKobo || 0) +
                        task.amountKobo +
                        task.feeKobo,
                    }
                  : {}),
              }),
              memberId,
            ],
          );
          if (delta)
            await this.put(q, task.id, job.owner, "cash_event", {
              memberId,
              delta,
              date:
                task.input.kind === "ajo_cash" ? task.input.date : lagosDate(),
            });
        }
        if (task.source && task.amountKobo) {
          await lockAccount(q, this.db, task.source);
          if ((await balance(q, task.source)) < task.amountKobo + task.feeKobo)
            throw new AppError("INSUFFICIENT_FUNDS");
          const entries = [
            { account: task.source, amount: -task.amountKobo - task.feeKobo },
            { account: task.target!, amount: task.amountKobo },
          ];
          if (task.feeKobo)
            entries.push({
              account: task.feeTarget || "system:fees",
              amount: task.feeKobo,
            });
          await post(q, task.id, entries);
        }
        const receipt = randomUUID();
        await this.put(q, receipt, job.owner, "receipt", {
          planId: p.id,
          taskId: task.id,
          status: "SETTLED",
          direction: task.input.kind === "goal_withdraw" ? "credit" : "debit",
          label: task.label,
          amountKobo: task.amountKobo,
          feeKobo: task.feeKobo,
          ...(task.input.kind === "ajo_payout"
            ? {
                grossAmountKobo: task.amountKobo + task.feeKobo,
                feeLabel: "Organizer cycle fee",
              }
            : {}),
          destination: task.destination,
          ...(task.recipient ? { recipient: task.recipient } : {}),
          createdAt: stamp(),
          reference: "PW-" + task.id,
          ...(task.allocation ? { allocation: task.allocation } : {}),
          kind: task.input.kind,
          ...(task.savingsSchedule
            ? { savingsSchedule: task.savingsSchedule }
            : {}),
          ...(task.input.kind === "service" &&
          task.input.productId.endsWith("prepaid")
            ? { electricityToken: outcome.token }
            : {}),
        });
        await q.query(
          "UPDATE tasks SET status='SETTLED',receipt=$1,error=NULL WHERE id=$2",
          [receipt, task.id],
        );
        await this.enqueue(q, "receipt:" + task.id, "receipt", job.owner, {
          receiptId: receipt,
        });
        if (
          task.target?.startsWith("wallet:") &&
          task.target !== "wallet:" + job.owner
        ) {
          const recipient = task.target.slice(7),
            incoming = randomUUID(),
            sender = (
              await q.query("SELECT name FROM users WHERE id=$1", [job.owner])
            ).rows[0];
          await this.put(q, incoming, recipient, "receipt", {
            planId: p.id,
            taskId: task.id,
            status: "SETTLED",
            direction: "credit",
            kind: task.input.kind,
            label:
              task.input.kind === "ajo_payout"
                ? "Ajo payout received"
                : "PayWella transfer received",
            destination: "From " + sender.name,
            amountKobo: task.amountKobo,
            feeKobo: task.input.kind === "ajo_payout" ? task.feeKobo : 0,
            ...(task.input.kind === "ajo_payout"
              ? {
                  grossAmountKobo: task.amountKobo + task.feeKobo,
                  feeLabel: "Organizer cycle fee",
                }
              : {}),
            createdAt: stamp(),
            reference: "PW-" + task.id,
          });
          await this.enqueue(
            q,
            "incoming-receipt:" + task.id,
            "receipt",
            recipient,
            { receiptId: incoming },
          );
        }
        await q.query("UPDATE holds SET active=0 WHERE task=$1", [task.id]);
        await q.query("UPDATE jobs SET status='DONE' WHERE id=$1", [job.id]);
      }
      await this.refreshPlan(q, p.id);
    });
  }
  async drain(limit = 20) {
    for (let i = 0; i < limit; i++) {
      const group = (
        await Promise.all([this.claim(), this.claim(), this.claim()])
      ).filter((job): job is Row => job !== null);
      if (!group.length) return;
      await Promise.all(
        group.map(async (job) => {
          try {
            await this.execute(job);
          } catch (e) {
            if (e instanceof AppError) {
              await this.db.transaction(async (q) => {
                await q.query(
                  "UPDATE tasks SET status='FAILED',error=$1 WHERE id=$2",
                  [e.code, job.payload.taskId],
                );
                await q.query("UPDATE holds SET active=0 WHERE task=$1", [
                  job.payload.taskId,
                ]);
                await q.query("UPDATE jobs SET status='DONE' WHERE id=$1", [
                  job.id,
                ]);
                await this.refreshPlan(q, job.payload.planId);
              });
            } else
              await this.db.query(
                "UPDATE jobs SET status='QUEUED',lease_until=$1 WHERE id=$2",
                [future(3000), job.id],
              );
          }
        }),
      );
    }
  }
}
