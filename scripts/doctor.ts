const flags = {
  node24: process.versions.node.startsWith("24."),
  appSecret: (process.env.APP_SECRET || "").length >= 32,
  postgres: !!process.env.DATABASE_URL,
  aiProvider: process.env.AI_PROVIDER || "gemini",
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
};
process.stdout.write(JSON.stringify(flags, null, 2) + "\n");
if (!flags.node24 || !flags.appSecret) process.exitCode = 1;
