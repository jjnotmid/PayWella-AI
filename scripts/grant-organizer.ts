import pg from "pg";
import { readFileSync } from "node:fs";
const phone = process.argv[process.argv.indexOf("--phone") + 1];
if (!process.argv.includes("--phone") || !/^234\d{10}$/.test(phone || ""))
  throw Error(
    "Pass --phone with the already-opened test account’s Nigerian number.",
  );
if (!process.env.DATABASE_URL)
  throw Error(
    "A dedicated PayWella AI database connection is required. For local SQLite use npm run seed -- --organizer.",
  );
const url = new URL(process.env.DATABASE_URL);
for (const key of ["sslmode", "sslrootcert", "sslkey", "sslcert"])
  url.searchParams.delete(key);
const db = new pg.Client({
  connectionString: url.toString(),
  ssl: {
    rejectUnauthorized: true,
    ...(process.env.DATABASE_SSL_CA
      ? { ca: readFileSync(process.env.DATABASE_SSL_CA, "utf8") }
      : {}),
  },
});
await db.connect();
try {
  const identity = (
    await db.query(
      "SELECT value FROM public.paywella_ai_identity WHERE id='application'",
    )
  ).rows[0];
  if (identity?.value !== "paywella-ai-v1")
    throw Error(
      "This database does not belong to PayWella AI. Nothing was changed.",
    );
  const user = (
    await db.query("SELECT id,pin_hash FROM users WHERE phone=$1", [phone])
  ).rows[0];
  if (!user?.pin_hash)
    throw Error(
      "Open this test account through WhatsApp first. Nothing was changed.",
    );
  await db.query("UPDATE users SET organizer=1 WHERE id=$1", [user.id]);
  process.stdout.write(
    "Organizer access granted for the isolated test account.\n",
  );
} finally {
  await db.end();
}
