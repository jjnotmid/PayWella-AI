import { randomUUID } from "node:crypto";
import type { Query, Store } from "./db.ts";
import { AppError, safeInteger } from "./contracts.ts";
import { stamp } from "./security.ts";
export async function account(
  q: Query,
  id: string,
  owner: string,
  kind: string,
) {
  await q.query(
    "INSERT INTO accounts VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
    [id, owner, kind],
  );
}
export async function balance(q: Query, id: string) {
  return safeInteger(
    (
      await q.query(
        "SELECT COALESCE(SUM(amount),0) AS total FROM postings WHERE account=$1",
        [id],
      )
    ).rows[0].total,
  );
}
export async function available(q: Query, id: string) {
  const held = safeInteger(
    (
      await q.query(
        "SELECT COALESCE(SUM(amount),0) AS total FROM holds WHERE account=$1 AND active=1",
        [id],
      )
    ).rows[0].total,
  );
  return (await balance(q, id)) - held;
}
export async function post(
  q: Query,
  reference: string,
  entries: { account: string; amount: number }[],
) {
  if (
    entries.length < 2 ||
    entries.some((e) => !Number.isSafeInteger(e.amount) || e.amount === 0) ||
    entries.reduce((sum, e) => sum + e.amount, 0) !== 0
  )
    throw new AppError("UNBALANCED_JOURNAL");
  if (
    (await q.query("SELECT id FROM journals WHERE reference=$1", [reference]))
      .rows.length
  )
    return false;
  const id = randomUUID();
  await q.query("INSERT INTO journals VALUES($1,$2,$3)", [
    id,
    reference,
    stamp(),
  ]);
  for (const e of entries)
    await q.query("INSERT INTO postings VALUES($1,$2,$3,$4)", [
      randomUUID(),
      id,
      e.account,
      e.amount,
    ]);
  return true;
}
export async function lockAccount(q: Query, db: Store, id: string) {
  const r = await q.query(
    "SELECT id FROM accounts WHERE id=$1" + (db.postgres ? " FOR UPDATE" : ""),
    [id],
  );
  if (!r.rows.length) throw new AppError("ACCOUNT_NOT_FOUND", 404);
}
