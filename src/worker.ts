import type { Core } from "./core.ts";
import type { Agent } from "./ai/agent.ts";
import { AppError } from "./contracts.ts";
import { createCapability, stamp, future } from "./security.ts";
import { errorCopy } from "./copy.ts";
import { sendWhatsApp, sendWhatsAppReceipt } from "./whatsapp.ts";
import { receiptImage } from "./receipt-image.ts";
export class Worker {
  core: Core;
  agent: Agent;
  env: NodeJS.ProcessEnv;
  busy = false;
  constructor(core: Core, agent: Agent, env: NodeJS.ProcessEnv) {
    this.core = core;
    this.agent = agent;
    this.env = env;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await Promise.all([
        this.core.drain(2),
        this.turn(),
        this.outbound(),
        this.receipt(),
      ]);
    } finally {
      this.busy = false;
    }
  }
  async turn() {
    const job = await this.core.claim("agent");
    if (!job) return;
    try {
      const input = this.agent.open(job.payload.sealed),
        user = await this.core.getUser(job.owner);
      let reply: any;
      if (!user.ready) {
        const cap = await this.core.onboardingLink(job.owner);
        reply = {
          text: "PayWella helps you send money, save, pay bills and manage Ajo in one conversation. Open your account securely to get started.",
          url: this.env.PUBLIC_ORIGIN + "/open#" + cap,
        };
      } else if (input.access) {
        const cap = await createCapability(
          this.core.db,
          job.owner,
          "workspace",
        );
        reply = {
          text: "Your secure account link is ready.",
          url: this.env.PUBLIC_ORIGIN + "/open#" + cap,
        };
      } else {
        const existing = (
          await this.core.db.query(
            "SELECT id FROM plans WHERE owner=$1 AND request_key=$2",
            [job.owner, job.id],
          )
        ).rows[0];
        if (existing) {
          const p = await this.core.plan(job.owner, existing.id);
          reply = {
            text: "Your review is ready.",
            prepared: {
              plan: p,
              capability: await createCapability(
                this.core.db,
                job.owner,
                "review",
                p.id,
                p.revision,
              ),
            },
          };
        } else reply = await this.agent.turn(job.owner, input.text, job.id);
        if (reply.prepared) {
          const p = reply.prepared.plan;
          reply.text =
            "Review these tasks together. No money has moved.\n" +
            p.spec
              .map(
                (t: any, i: number) =>
                  `${i + 1}. ${t.label}: NGN ${(t.amountKobo / 100).toFixed(2)}${t.destination ? " to " + t.destination : ""}`,
              )
              .join("\n");
          reply.url =
            this.env.PUBLIC_ORIGIN + "/open#" + reply.prepared.capability;
          delete reply.prepared.capability;
        }
      }
      await this.core.db.transaction(async (q) => {
        await this.core.put(q, job.id, job.owner, "reply", reply);
        await q.query(
          "UPDATE jobs SET status='DONE',lease_until=NULL WHERE id=$1",
          [job.id],
        );
        if (input.channel === "whatsapp")
          await this.core.enqueue(q, "out:" + job.id, "outbox", job.owner, {
            sealed: this.agent.seal({
              to: user.phone,
              text: reply.text + (reply.url ? "\n" + reply.url : ""),
            }),
          });
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "AI_UNAVAILABLE";
      await this.core.db.transaction(async (q) => {
        await this.core.put(q, job.id, job.owner, "reply", {
          error: code,
          text: errorCopy(code),
        });
        await q.query("UPDATE jobs SET status='FAILED' WHERE id=$1", [job.id]);
        const input = this.agent.open(job.payload.sealed);
        if (input.channel === "whatsapp") {
          const user = (
            await q.query("SELECT phone FROM users WHERE id=$1", [job.owner])
          ).rows[0];
          await this.core.enqueue(q, "out:" + job.id, "outbox", job.owner, {
            sealed: this.agent.seal({ to: user.phone, text: errorCopy(code) }),
          });
        }
      });
    }
  }
  async outbound() {
    const job = await this.core.claim("outbox");
    if (!job) return;
    // A reclaimed send may already have reached WhatsApp. Do not send it twice.
    if (job.attempts > 0) {
      await this.core.db.query("UPDATE jobs SET status='UNKNOWN' WHERE id=$1", [
        job.id,
      ]);
      return;
    }
    try {
      const input = this.agent.open(job.payload.sealed);
      await sendWhatsApp(this.env, input.to, input.text);
      await this.core.db.query("UPDATE jobs SET status='DONE' WHERE id=$1", [
        job.id,
      ]);
    } catch {
      await this.core.db.query(
        "UPDATE jobs SET status='UNKNOWN',lease_until=$1 WHERE id=$2",
        [future(30000), job.id],
      );
    }
  }
  async receipt() {
    if (!this.env.WHATSAPP_ACCESS_TOKEN || !this.env.WHATSAPP_PHONE_NUMBER_ID)
      return;
    const job = await this.core.claim("receipt");
    if (!job) return;
    if (job.attempts > 0) {
      await this.core.db.query("UPDATE jobs SET status='UNKNOWN' WHERE id=$1", [
        job.id,
      ]);
      return;
    }
    try {
      const user = await this.core.getUser(job.owner),
        receipt = await this.core.receipt(job.owner, job.payload.receiptId);
      await sendWhatsAppReceipt(this.env, user.phone, receiptImage(receipt));
      await this.core.db.query("UPDATE jobs SET status='DONE' WHERE id=$1", [
        job.id,
      ]);
    } catch {
      await this.core.db.query("UPDATE jobs SET status='UNKNOWN' WHERE id=$1", [
        job.id,
      ]);
    }
  }
}
