import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/db.ts";
test("database initialization refuses another application without creating or changing its tables", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paywella-isolation-")),
    file = join(folder, "foreign.sqlite");
  try {
    const other = new DatabaseSync(file);
    other.exec(
      "CREATE TABLE users(id TEXT);INSERT INTO users VALUES('other-owner');",
    );
    other.close();
    await assert.rejects(() => openStore({ file }), /separate empty database/);
    const verify = new DatabaseSync(file);
    assert.deepEqual(
      verify
        .prepare("SELECT id FROM users")
        .all()
        .map((row) => row.id),
      ["other-owner"],
    );
    assert.equal(
      verify
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
        .get()!.n,
      1,
    );
    verify.close();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
