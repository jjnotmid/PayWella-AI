import { spawnSync } from "node:child_process";
import { runtimeConfig } from "../src/config.ts";
import { aiReadiness } from "../src/ai/readiness.ts";
let configurationValid = true;
try {
  runtimeConfig(process.env);
} catch {
  configurationValid = false;
}
const ai = aiReadiness(process.env),
  mediaProvider = ai.mediaProvider;
const flags = {
  configurationValid,
  node24: process.versions.node.startsWith("24."),
  appSecret: (process.env.APP_SECRET || "").length >= 32,
  postgres: !!process.env.DATABASE_URL,
  ...ai,
  voiceDecoder:
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 })
      .status === 0,
  whatsapp: [
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_BUSINESS_ID",
  ].every((k) => !!process.env[k]),
  publicHttps: process.env.PUBLIC_ORIGIN?.startsWith("https://") || false,
  metaSubmissionConfigured: ai.metaModelSelected && ai.aiKey,
  realPayments: false,
  whatsappCalling: false,
  samSegmentation:
    mediaProvider === "meta" &&
    process.env.SAM_LEDGER_CROP === "true" &&
    !!process.env.MODEL_API_KEY,
};
process.stdout.write(JSON.stringify(flags, null, 2) + "\n");
if (!flags.node24 || !flags.appSecret || !flags.configurationValid)
  process.exitCode = 1;
if (
  process.argv.includes("--integration") &&
  (!flags.postgres ||
    !flags.aiKey ||
    !flags.mediaKey ||
    !flags.whatsapp ||
    !flags.publicHttps ||
    !flags.visionConfigured ||
    (["meta", "groq"].includes(mediaProvider) && !flags.voiceDecoder))
)
  process.exitCode = 1;
if (
  process.argv.includes("--submission") &&
  (!flags.metaSubmissionConfigured ||
    !flags.postgres ||
    !flags.whatsapp ||
    !flags.publicHttps ||
    !flags.visionConfigured ||
    !flags.voiceDecoder)
)
  process.exitCode = 1;
