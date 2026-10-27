import { randomUUID, createHash } from "node:crypto";
import type { Store, Query, Row } from "./db.ts";
import { AppError, PlanInput, naira, safeInteger } from "./contracts.ts";
import type { Task, QuotedTask, Plan } from "./contracts.ts";
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
          "INSERT INTO users(id,phone,name,language,created_at) VALUES($1,$2,$3,$4,$5)",
          [user.id, phone, "", "en", stamp()],
        );
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
    });
    return this.workspace(owner);
  }
  async records(owner: string, kind: string) {
    return (
      await this.db.query(
        "SELECT id,data,version FROM records WHERE owner=$1 AND kind=$2",
        [owner, kind],
      )
    ).rows.map((row) => ({
      id: row.id,
      ...JSON.parse(row.data),
      version: row.version,
    }));
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
    const user = await this.getUser(owner);
    const ownedMembers = await this.records(owner, "member"),
      linked = (
        await this.db.query(
          "SELECT id,owner,data FROM records WHERE kind='member'",
        )
      ).rows
        .filter((r) => JSON.parse(r.data).userId === owner && r.owner !== owner)
        .map((r) => ({ id: r.id, organizer: r.owner, ...JSON.parse(r.data) }));
    return {
      user,
      balanceKobo: await balance(this.db, `wallet:${owner}`),
      availableKobo: await available(this.db, `wallet:${owner}`),
      goals: await Promise.all(
        (await this.records(owner, "goal")).map(async (g) => ({
          ...g,
          balanceKobo: await balance(this.db, `goal:${g.id}`),
        })),
      ),
      books: await this.records(owner, "book"),
      members: await Promise.all(
        [...ownedMembers, ...linked].map(async (m) => ({
          ...m,
          fundedKobo: await balance(this.db, `ajo:${m.id}`),
        })),
      ),
      plans: (
        await this.db.query(
          "SELECT id,status,created_at FROM plans WHERE owner=$1 ORDER BY created_at DESC LIMIT 20",
          [owner],
        )
      ).rows,
      receipts: (await this.records(owner, "receipt")).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      banks,
      products,
      sandbox: true,
    };
  }
  async onboardingLink(owner: string) {
    return createCapability(this.db, owner, "setup");
  }
  async prepare(
    owner: string,
    input: unknown,
    requestKey: string | null = null,
  ) {
    if (requestKey) {
      const existing = (
        await this.db.query(
          "SELECT id FROM plans WHERE owner=$1 AND request_key=$2",
          [owner, requestKey],
        )
      ).rows[0];
      if (existing)
        return {
          plan: await this.plan(owner, existing.id),
          capability: await createCapability(
            this.db,
            owner,
            "review",
            existing.id,
            1,
          ),
        };
    }
    const { tasks } = PlanInput.parse(input),
      user = await this.getUser(owner);
    if (!user.ready) throw new AppError("SETUP_REQUIRED");
    const id = randomUUID(),
      quoted: QuotedTask[] = [],
      goals = await this.records(owner, "goal");
    for (const task of tasks) {
      let label = "",
        destination = "",
        source: string | null = `wallet:${owner}`,
        target: string | null = "system:clearing",
        feeKobo = 0,
        goalId: string | undefined;
      const dependsOn: number[] = [];
      if (task.kind === "bank_transfer") {
        destination = await this.rail.enquire(
          task.bankCode,
          task.accountNumber,
        );
        label = "Bank transfer";
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
          match[0]?.id || (prior >= 0 ? quoted[prior].goalId : randomUUID());
        if (prior >= 0) dependsOn.push(prior);
        target = `goal:${goalId}`;
        label = "Save for " + task.name;
        destination = task.name;
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
        label = product.name;
        destination = task.customer;
      } else {
        const member = await this.membership(this.db, owner, task.memberId);
        destination = member.name;
        if (task.kind === "ajo_cash") {
          if (member.organizer !== owner) throw new AppError("FORBIDDEN", 403);
          source = null;
          target = null;
          label = "Record cash collected";
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
          if (member.maturityDate > stamp().slice(0, 10))
            throw new AppError("NOT_MATURED");
          source = `ajo:${member.id}`;
          target = `wallet:${member.userId}`;
          label = "Ajo payout";
        }
      }
      quoted.push({
        id: randomUUID(),
        input: task,
        label,
        destination,
        source,
        target,
        amountKobo: task.amountKobo,
        feeKobo,
        goalId,
        dependsOn,
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
      if (open) throw new AppError("REVIEW_ALREADY_OPEN", 409);
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
      return createCapability(q, owner, "review", id, 1);
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
      status: row.status,
      spec: JSON.parse(row.spec),
      digest: row.digest,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      tasks,
    } as Plan;
  }
  async cancel(owner: string, id: string) {
    await this.db.transaction(async (q) => {
      const p = await this.plan(owner, id, q);
      if (p.status === "CANCELLED") return;
      if (p.status !== "READY") throw new AppError("ALREADY_SUBMITTED", 409);
      await q.query("UPDATE plans SET status='CANCELLED' WHERE id=$1", [id]);
      await q.query("UPDATE tasks SET status='CANCELLED' WHERE plan=$1", [id]);
      await q.query("UPDATE capabilities SET used=1 WHERE target=$1", [id]);
    });
    return this.plan(owner, id);
  }
  async approve(owner: string, id: string, revision: number, pin: string) {
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
      const totals = new Map<string, number>();
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
  async createBook(owner: string, name: string) {
    const user = await this.getUser(owner);
    if (!user.organizer) throw new AppError("ORGANIZER_REQUIRED", 403);
    if (!name.trim() || name.length > 60) throw new AppError("INVALID_NAME");
    const id = randomUUID(),
      invite = createHash("sha256")
        .update(randomUUID())
        .digest("hex")
        .slice(0, 8)
        .toUpperCase();
    await this.put(this.db, id, owner, "book", {
      name: name.trim(),
      invite,
      createdAt: stamp(),
    });
    return { id, name, invite };
  }
  async addMember(
    owner: string,
    bookId: string,
    input: {
      name: string;
      dailyKobo: number;
      maturityDate: string;
      userId?: string;
    },
  ) {
    await this.owned(this.db, owner, bookId, "book");
    if (
      !input.name.trim() ||
      !Number.isSafeInteger(input.dailyKobo) ||
      input.dailyKobo < 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.maturityDate)
    )
      throw new AppError("INVALID_MEMBER");
    if (input.userId) await this.getUser(input.userId);
    const id = randomUUID();
    await this.db.transaction(async (q) => {
      await this.put(q, id, owner, "member", {
        ...input,
        bookId,
        cashOutstandingKobo: 0,
        joinedDate: stamp().slice(0, 10),
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
  ) {
    const rows = (
      await this.db.query("SELECT * FROM records WHERE kind='book'")
    ).rows;
    const book = rows.find(
      (r) => JSON.parse(r.data).invite === invite.toUpperCase(),
    );
    if (!book) throw new AppError("INVITE_NOT_FOUND");
    const user = await this.getUser(owner);
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
      const current = (
        await q.query("SELECT data FROM records WHERE id=$1", [id])
      ).rows[0];
      if (current) return { id, ...JSON.parse(current.data) };
      const data = {
        name: user.name,
        userId: owner,
        dailyKobo,
        maturityDate,
        bookId: book.id,
        cashOutstandingKobo: 0,
        joinedDate: stamp().slice(0, 10),
      };
      await this.put(q, id, book.owner, "member", data);
      await account(q, `ajo:${id}`, book.owner, "member_principal");
      return { id, ...data };
    });
  }
  async receipt(owner: string, id: string) {
    return this.owned(this.db, owner, id, "receipt");
  }
  async claim(kind = "task"): Promise<Row | null> {
    return this.db.transaction(async (q) => {
      const row = (
        await q.query(
          "SELECT * FROM jobs WHERE kind=$2 AND ((status='QUEUED' AND (lease_until IS NULL OR lease_until<=$1)) OR (status='RUNNING' AND lease_until<=$1)) AND NOT EXISTS (SELECT 1 FROM jobs active WHERE active.owner=jobs.owner AND active.kind=jobs.kind AND active.kind<>'task' AND active.id<>jobs.id AND active.status='RUNNING' AND active.lease_until>$1) ORDER BY created_at LIMIT 1" +
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
          !["SETTLED", "FAILED", "NOT_STARTED"].includes(p.tasks[i].status),
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
          outcome = await this.rail.submit(task.id, task.input.kind);
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
            await this.put(q, task.goalId!, job.owner, "goal", {
              name: task.input.name,
            });
        }
        if (
          task.input.kind === "ajo_cash" ||
          task.input.kind === "ajo_replace"
        ) {
          const member = await this.membership(
            q,
            job.owner,
            task.input.memberId,
          );
          const delta =
            task.input.kind === "ajo_cash" ? task.amountKobo : -task.amountKobo;
          if (member.cashOutstandingKobo + delta < 0)
            throw new AppError("REPLACEMENT_EXCEEDS_CASH");
          const { id: memberId, organizer, ...data } = member;
          await q.query(
            "UPDATE records SET data=$1,version=version+1 WHERE id=$2",
            [
              JSON.stringify({
                ...data,
                cashOutstandingKobo: member.cashOutstandingKobo + delta,
              }),
              memberId,
            ],
          );
          await this.put(q, task.id, job.owner, "cash_event", {
            memberId,
            delta,
            date:
              task.input.kind === "ajo_cash"
                ? task.input.date
                : stamp().slice(0, 10),
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
            entries.push({ account: "system:fees", amount: task.feeKobo });
          await post(q, task.id, entries);
        }
        const receipt = randomUUID();
        await this.put(q, receipt, job.owner, "receipt", {
          planId: p.id,
          taskId: task.id,
          status: "SETTLED",
          label: task.label,
          amountKobo: task.amountKobo,
          feeKobo: task.feeKobo,
          destination: task.destination,
          createdAt: stamp(),
          reference: "PW-" + task.id,
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
