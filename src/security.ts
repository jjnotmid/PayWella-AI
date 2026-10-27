import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "./contracts.ts";
import type { Query, Store } from "./db.ts";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const stamp = () => new Date().toISOString();
export const future = (ms: number) => new Date(Date.now() + ms).toISOString();
export async function hashPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new AppError("INVALID_PIN_FORMAT");
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(pin, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function checkPin(db: Store, owner: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new AppError("INVALID_PIN");
  const row = (await db.query("SELECT * FROM users WHERE id=$1", [owner]))
    .rows[0];
  if (!row?.pin_hash) throw new AppError("SETUP_REQUIRED");
  if (row.locked_until && row.locked_until > stamp())
    throw new AppError("PIN_LOCKED", 423);
  const [salt, expected] = row.pin_hash.split(":");
  const actual = (await derive(pin, salt, 64)) as Buffer;
  const valid = timingSafeEqual(actual, Buffer.from(expected, "hex"));
  await db.transaction(async (q) => {
    const current = (
      await q.query(
        "SELECT * FROM users WHERE id=$1" + (db.postgres ? " FOR UPDATE" : ""),
        [owner],
      )
    ).rows[0];
    if (current.locked_until && current.locked_until > stamp())
      throw new AppError("PIN_LOCKED", 423);
    if (current.pin_hash !== row.pin_hash)
      throw new AppError("CREDENTIAL_CHANGED", 409);
    await q.query("UPDATE users SET attempts=$1,locked_until=$2 WHERE id=$3", [
      valid ? 0 : current.attempts + 1,
      !valid && current.attempts + 1 >= 5 ? future(900000) : null,
      owner,
    ]);
  });
  if (!valid) throw new AppError("INVALID_PIN", 401);
}
export async function createCapability(
  q: Query,
  owner: string,
  purpose: string,
  target: string | null = null,
  revision: number | null = null,
) {
  const secret = token();
  await q.query("INSERT INTO capabilities VALUES($1,$2,$3,$4,$5,$6,0)", [
    digest(secret),
    owner,
    purpose,
    target,
    revision,
    future(300000),
  ]);
  return secret;
}
export function privateText(value: string) {
  return value
    .replace(
      /\b(pin|password|otp|bvn|nin|cvv)\s*(?:is|:|=)?\s*[\d -]{3,}/gi,
      "[private input removed]",
    )
    .replace(/\b\d{11,19}\b/g, (n) =>
      /^(?:0|234)[789]\d{9}$/.test(n) ? n : "[private number removed]",
    )
    .slice(0, 2000);
}
