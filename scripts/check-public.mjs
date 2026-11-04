import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 30_000_000 });
const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
const rules = [
  ["Groq credential", /gsk_[A-Za-z0-9]{20,}/],
  ["Cloudflare credential", /cfut_[A-Za-z0-9_-]{24,}/],
  ["GitHub credential", /(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/],
  ["Google API credential", /AIza[A-Za-z0-9_-]{30,}/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const failures = new Set();
const privatePath = path => /(?:^|\/)(?:\.env(?:\..+)?|private|\.data)(?:\/|$)/.test(path) && path !== ".env.example" || /\.(?:sqlite\w*|docx|pptx|xlsx|pem|key)$/i.test(path);
function scan(path, data, revision = "working tree") {
  if (privatePath(path)) failures.add(revision + ": private file " + path);
  if (data.length > 3_000_000 || /\.(?:png|ttf|woff2?)$/i.test(path)) return;
  const text = data.toString("utf8");
  for (const [label, pattern] of rules) if (pattern.test(text)) failures.add(revision + ": " + label + " in " + path);
}
for (const file of files) {
  let data;
  try { data = readFileSync(file); }
  catch { continue; }
  scan(file, data);
}
const commits = git("rev-list", "--all").trim().split("\n").filter(Boolean);
const seen = new Set();
for (const commit of commits) {
  const entries = git("ls-tree", "-r", "-z", commit).split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/s);
    if (!match) continue;
    const [, hash, path] = match;
    if (privatePath(path)) failures.add(commit.slice(0, 8) + ": private file " + path);
    if (seen.has(hash)) continue;
    seen.add(hash);
    scan(path, execFileSync("git", ["cat-file", "blob", hash], { maxBuffer: 20_000_000 }), commit.slice(0, 8));
  }
}
if (failures.size) {
  for (const failure of failures) process.stderr.write(failure + "\n");
  process.exitCode = 1;
} else process.stdout.write(`Public-source checks passed for ${files.length} files and ${commits.length} available commits. No matched credential patterns or private document paths.\n`);
