import { openStore } from "./db.ts";
import { Core } from "./core.ts";
import { Agent } from "./ai/agent.ts";
import { createModel } from "./ai/model.ts";
import { createApp } from "./server.ts";
import { Worker } from "./worker.ts";
if ((process.env.APP_SECRET || "").length < 32)
  throw new Error("Set APP_SECRET to a random value of at least 32 characters");
const db = await openStore({
  url: process.env.DATABASE_URL,
  production: process.env.NODE_ENV === "production",
  ca: process.env.DATABASE_SSL_CA,
});
const core = new Core(db),
  agent = new Agent(core, createModel(), process.env.APP_SECRET!),
  worker = new Worker(core, agent, process.env),
  server = createApp(core, agent, process.env);
const timer = setInterval(() => {
  worker.tick().catch(() => {
    process.stderr.write(
      "Background work could not complete; durable jobs remain queued.\n",
    );
  });
}, 300);
server.listen(Number(process.env.PORT || 4317), "0.0.0.0", () =>
  process.stdout.write("PayWella AI is listening. Financial rails: sandbox.\n"),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
  await db.close();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
