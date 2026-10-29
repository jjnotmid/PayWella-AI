import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { createCapability } from "../src/security.ts";
if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL)
  throw new Error(
    "Local setup only. This script cannot seed a hosted database.",
  );
const db = await openStore(),
  core = new Core(db);
try {
  const owner = await core.userForPhone("2348000000001"),
    user = await core.getUser(owner),
    cap = await createCapability(db, owner, user.ready ? "workspace" : "setup");
  if (process.argv.includes("--organizer"))
    await db.query("UPDATE users SET organizer=1 WHERE id=$1", [owner]);
  process.stdout.write(
    `Local private account link (expires in five minutes):\n${process.env.PUBLIC_ORIGIN || "http://localhost:4317"}/open#${cap}\n`,
  );
} finally {
  await db.close();
}
