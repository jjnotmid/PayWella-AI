import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "test",
};
const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => "tests/" + f);
if (!files.length) throw new Error("No tests found");
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  { stdio: "inherit", env },
);
process.exitCode = result.status ?? 1;
