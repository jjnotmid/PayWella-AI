import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
export type Row = Record<string, any>;
export interface Query {
  query(sql: string, args?: unknown[]): Promise<{ rows: Row[]; count: number }>;
}
export interface Store extends Query {
  transaction<T>(fn: (db: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  postgres: boolean;
}
const schema = `
CREATE TABLE IF NOT EXISTS paywella_ai_identity(id TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO paywella_ai_identity VALUES('application','paywella-ai-v1') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,phone TEXT UNIQUE NOT NULL,name TEXT NOT NULL,language TEXT NOT NULL,pin_hash TEXT,attempts INTEGER NOT NULL DEFAULT 0,locked_until TEXT,organizer INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS postings(id TEXT PRIMARY KEY,journal TEXT NOT NULL REFERENCES journals(id),account TEXT NOT NULL REFERENCES accounts(id),amount BIGINT NOT NULL CHECK(amount<>0));
CREATE INDEX IF NOT EXISTS posting_account ON postings(account);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS record_owner ON records(owner,kind);
CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,spec TEXT NOT NULL,digest TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,request_key TEXT,UNIQUE(owner,request_key));
CREATE INDEX IF NOT EXISTS plan_owner ON plans(owner,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS one_review ON plans(owner) WHERE status='READY';
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,plan TEXT NOT NULL REFERENCES plans(id),position INTEGER NOT NULL,status TEXT NOT NULL,receipt TEXT,error TEXT,UNIQUE(plan,position));
CREATE TABLE IF NOT EXISTS holds(task TEXT PRIMARY KEY REFERENCES tasks(id),account TEXT NOT NULL REFERENCES accounts(id),amount BIGINT NOT NULL CHECK(amount>=0),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS capabilities(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,purpose TEXT NOT NULL,target TEXT,revision INTEGER,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,purpose TEXT NOT NULL,target TEXT,revision INTEGER,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,lease_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS job_queue ON jobs(status,lease_until,created_at);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,object_id TEXT,created_at TEXT NOT NULL);
`;
export async function openStore({
  url = "",
  file = ".data/paywella.sqlite",
  production = false,
  ca = "",
} = {}): Promise<Store> {
  if (production && !url)
    throw new Error("Production requires a separate PostgreSQL database");
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 5,
      ssl: ca
        ? { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true }
        : undefined,
      connectionTimeoutMillis: 5000,
    });
    const wrap = (client: pg.Pool | pg.PoolClient): Query => ({
      async query(sql, args = []) {
        const r = await client.query(sql, args);
        return { rows: r.rows, count: r.rowCount ?? 0 };
      },
    });
    const query = wrap(pool);
    const init = await pool.connect();
    let initialized = false;
    try {
      await init.query("BEGIN");
      await init.query(
        "SELECT pg_advisory_xact_lock(hashtext('paywella-ai-schema'))",
      );
      const tables = (
        await init.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        )
      ).rows;
      if (tables.length) {
        if (!tables.some((row) => row.tablename === "paywella_ai_identity"))
          throw new Error(
            "Use a separate empty database for PayWella AI. No schema changes were made.",
          );
        const identity = (
          await init.query(
            "SELECT value FROM public.paywella_ai_identity WHERE id='application'",
          )
        ).rows[0];
        if (identity?.value !== "paywella-ai-v1")
          throw new Error("This database belongs to a different application.");
      }
      await init.query(schema);
      await init.query("COMMIT");
      initialized = true;
    } catch (error) {
      await init.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      init.release();
      if (!initialized) await pool.end();
    }
    await query.query(
      `CREATE OR REPLACE FUNCTION deny_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only ledger'; END $$`,
    );
    for (const table of ["postings", "journals"])
      await query.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='immutable_${table}') THEN CREATE TRIGGER immutable_${table} BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION deny_ledger_change(); END IF; END $$`,
      );
    return {
      ...query,
      postgres: true,
      async transaction(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          const r = await fn(wrap(c));
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (tables.length) {
    const known = tables.some((row) => row.name === "paywella_ai_identity");
    if (
      !known ||
      sqlite
        .prepare(
          "SELECT value FROM paywella_ai_identity WHERE id='application'",
        )
        .get()?.value !== "paywella-ai-v1"
    ) {
      sqlite.close();
      throw new Error(
        "Use a separate empty database for PayWella AI. No schema changes were made.",
      );
    }
  }
  sqlite.exec(
    "PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;",
  );
  sqlite.exec(schema);
  for (const table of ["postings", "journals"])
    for (const op of ["UPDATE", "DELETE"])
      sqlite.exec(
        `CREATE TRIGGER IF NOT EXISTS immutable_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Append-only ledger'); END;`,
      );
  const raw: Query = {
    async query(sql, args = []) {
      const bound: unknown[] = [];
      const converted = sql.replace(/\$(\d+)/g, (_, n) => {
        bound.push(args[Number(n) - 1]);
        return "?";
      });
      const statement = sqlite.prepare(converted);
      if (/^\s*(SELECT|WITH)\b/i.test(sql))
        return { rows: statement.all(...(bound as any[])), count: 0 };
      const result = statement.run(...(bound as any[]));
      return { rows: [], count: Number(result.changes) };
    },
  };
  let queue = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => {
    const run = queue.then(work);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  return {
    postgres: false,
    query: (sql, args) => serial(() => raw.query(sql, args)),
    transaction<T>(fn: (db: Query) => Promise<T>) {
      return serial(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const value = await fn(raw);
          sqlite.exec("COMMIT");
          return value;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      });
    },
    async close() {
      await queue;
      sqlite.close();
    },
  };
}
