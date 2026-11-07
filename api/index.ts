import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { waitUntil, attachDatabasePool } from "@vercel/functions";
import { openStore } from "../src/db.ts";
import { Core } from "../src/core.ts";
import { Agent } from "../src/ai/agent.ts";
import { createModel } from "../src/ai/model.ts";
import { runtimeConfig } from "../src/config.ts";
import { createRequestHandler } from "../src/server.ts";
import { Worker } from "../src/worker.ts";
import { BackgroundRunner } from "../src/background.ts";

export const config = { api: { bodyParser: false } };

let runtime: ReturnType<typeof start> | undefined;
async function start() {
  const env = runtimeConfig(process.env);
  const db = await openStore({
    url: env.DATABASE_URL,
    production: true,
    ca: env.DATABASE_SSL_CA,
    initialize: false,
    preparePool: attachDatabasePool,
  });
  const core = new Core(db),
    agent = new Agent(core, createModel(env), env.APP_SECRET!),
    worker = new Worker(core, agent, env),
    background = new BackgroundRunner(worker);
  function wake() {
    return background.wake().catch(() => {
      process.stderr.write(
        "Background work interrupted; durable jobs remain queued.\n",
      );
    });
  }
  return {
    env,
    core,
    wake,
    handler: createRequestHandler(core, agent, env, () => waitUntil(wake())),
  };
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    runtime ||= start().catch((error) => {
      runtime = undefined;
      throw error;
    });
    const app = await runtime;
    if (
      new URL(req.url || "/", app.env.PUBLIC_ORIGIN).pathname ===
      "/internal/recover"
    ) {
      const supplied = Buffer.from(req.headers.authorization || ""),
        expected = Buffer.from("Bearer " + (app.env.CRON_SECRET || ""));
      if (
        req.method !== "GET" ||
        !app.env.CRON_SECRET ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.writeHead(403, { "cache-control": "no-store" });
        res.end();
        return;
      }
      await app.core.cleanup();
      waitUntil(app.wake());
      res.writeHead(202, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ accepted: true }));
      return;
    }
    await app.handler(req, res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(503, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "retry-after": "30",
      });
      res.end(
        JSON.stringify({
          error: "UNAVAILABLE",
          message:
            "PayWella is temporarily unavailable. Please try again shortly.",
        }),
      );
    } else res.end();
  }
}
