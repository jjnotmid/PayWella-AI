import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import {
  inspectOrganizerApplication,
  reviewOrganizerApplication,
} from "../src/organizer-applications.ts";

const option = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const id = process.argv.includes("--application")
  ? option("--application")
  : "";
const modes = ["--inspect", "--approve", "--reject"].filter((mode) =>
  process.argv.includes(mode),
);
if (!/^[a-f0-9-]{36}$/.test(id) || modes.length !== 1)
  throw Error(
    "Use --application <id> with exactly one of --inspect, --approve or --reject. Decisions also need --reason.",
  );
const db = await openStore({
  url: process.env.DATABASE_URL,
  production: process.env.NODE_ENV === "production",
  ca: process.env.DATABASE_SSL_CA,
});
try {
  const core = new Core(db);
  if (modes[0] === "--inspect") {
    if ((process.env.APP_SECRET || "").length < 32)
      throw Error(
        "The dedicated APP_SECRET is required to decrypt application evidence.",
      );
    const cipher = new Agent(
      core,
      {
        provider: "operator-only",
        async complete() {
          throw Error("No model is used for private document review.");
        },
      },
      process.env.APP_SECRET!,
    );
    const application = await inspectOrganizerApplication(core, cipher, id);
    const destination = resolve("private/organizer-reviews", id);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const filenames = [];
    for (const evidence of application.evidence) {
      const ext =
        evidence.mime === "application/pdf"
          ? ".pdf"
          : evidence.mime === "image/png"
            ? ".png"
            : ".jpg";
      const filename = (evidence.kind === "cac" ? "cac" : "address") + ext;
      await writeFile(
        resolve(destination, filename),
        Buffer.from(evidence.base64, "base64"),
        { mode: 0o600 },
      );
      filenames.push(filename);
    }
    const { evidence, ...details } = application;
    await writeFile(
      resolve(destination, "application.json"),
      JSON.stringify({ ...details, files: filenames }, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(
      "Private application evidence saved locally in " +
        destination +
        ". No cloud copy was made.\n",
    );
  } else {
    const reason = process.argv.includes("--reason") ? option("--reason") : "";
    const result = await reviewOrganizerApplication(
      core,
      id,
      modes[0] === "--approve" ? "approve" : "reject",
      reason,
    );
    process.stdout.write(
      "Organizer application " +
        result.status.toLowerCase() +
        ". This enables sandbox product access, not bank KYC approval.\n",
    );
  }
} finally {
  await db.close();
}
