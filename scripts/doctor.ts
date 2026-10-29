import { spawnSync } from "node:child_process";
import { runtimeConfig } from "../src/config.ts";
let configurationValid = true;
try {
  runtimeConfig(process.env);
} catch {
  configurationValid = false;
}
const provider = process.env.AI_PROVIDER || "gemini",
  mediaProvider = process.env.MEDIA_PROVIDER || provider;
const flags = {
  configurationValid,
  node24: process.versions.node.startsWith("24."),
  appSecret: (process.env.APP_SECRET || "").length >= 32,
  postgres: !!process.env.DATABASE_URL,
  aiProvider: process.env.AI_PROVIDER || "gemini",
  mediaProvider,
  mediaKey: !!(mediaProvider === "meta"
    ? process.env.MODEL_API_KEY
    : process.env.GEMINI_API_KEY),
  voiceDecoder:
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 })
      .status === 0,
  aiKey: !!(process.env.AI_PROVIDER === "meta"
    ? process.env.MODEL_API_KEY
    : process.env.GEMINI_API_KEY),
  whatsapp: [
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_BUSINESS_ID",
  ].every((k) => !!process.env[k]),
  publicHttps: process.env.PUBLIC_ORIGIN?.startsWith("https://") || false,
  metaSubmission:
    provider === "meta" &&
    mediaProvider === "meta" &&
    !!process.env.MODEL_API_KEY,
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
    (mediaProvider === "meta" && !flags.voiceDecoder))
)
  process.exitCode = 1;
if (
  process.argv.includes("--submission") &&
  (!flags.metaSubmission ||
    !flags.postgres ||
    !flags.whatsapp ||
    !flags.publicHttps ||
    !flags.voiceDecoder)
)
  process.exitCode = 1;
