import { openStore } from "./db.ts";
import { Core } from "./core.ts";
import { Agent } from "./ai/agent.ts";
import { createModel } from "./ai/model.ts";
import { createApp } from "./server.ts";
import { Worker } from "./worker.ts";
import { runtimeConfig } from "./config.ts";
const env = runtimeConfig(process.env);
const db = await openStore({
  url: env.DATABASE_URL,
  production: env.NODE_ENV === "production",
  ca: env.DATABASE_SSL_CA,
});
const core = new Core(db),
  agent = new Agent(core, createModel(env), env.APP_SECRET!),
  worker = new Worker(core, agent, env),
  server = createApp(core, agent, env);
const timer = setInterval(() => {
  worker.tick().catch(() => {
    process.stderr.write(
      "Background work could not complete; durable jobs remain queued.\n",
    );
  });
}, 300);
const cleanup = setInterval(
  () =>
    core.cleanup().catch(() => {
      process.stderr.write("Temporary-state cleanup will retry.\n");
    }),
  3600000,
);
server.listen(Number(env.PORT || 4317), env.HOST || "0.0.0.0", () =>
  process.stdout.write("PayWella AI is listening. Financial rails: sandbox.\n"),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(cleanup);
  const deadline = setTimeout(() => process.exit(0), 25000);
  deadline.unref();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await Promise.all([closed, worker.stop()]);
  await db.close();
  clearTimeout(deadline);
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
