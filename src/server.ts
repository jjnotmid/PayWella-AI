import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Core } from "./core.ts";
import type { Agent } from "./ai/agent.ts";
import { AppError, PlanInput } from "./contracts.ts";
import { digest, future, stamp, token } from "./security.ts";
import { errorCopy } from "./copy.ts";
import { receiptPdf } from "./receipts.ts";
import { receiptImage } from "./receipt-image.ts";
import { verifyWhatsApp } from "./whatsapp.ts";
import { banks, products } from "./providers/sandbox.ts";
import { statementPdf } from "./statements.ts";

type Session = {
  owner: string;
  purpose: string;
  target: string | null;
  revision: number | null;
};
const uuid = z.string().uuid(),
  requestId = z.string().uuid();
async function body(req: IncomingMessage, max = 18000) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) throw new AppError("REQUEST_TOO_LARGE", 413);
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
export function createApp(core: Core, agent: Agent, env: NodeJS.ProcessEnv) {
  const origin = new URL(env.PUBLIC_ORIGIN || "http://localhost:4317").origin,
    production = env.NODE_ENV === "production";
  const limits = new Map<string, { count: number; until: number }>();
  async function session(req: IncomingMessage): Promise<Session> {
    const secret = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("pw_session="))
      ?.slice(11);
    if (!secret) throw new AppError("SESSION_REQUIRED", 401);
    const row = (
      await core.db.query(
        "SELECT * FROM sessions WHERE hash=$1 AND expires_at>$2",
        [digest(secret), stamp()],
      )
    ).rows[0];
    if (!row) throw new AppError("SESSION_REQUIRED", 401);
    return row as Session;
  }
  function cookie(res: ServerResponse, secret: string) {
    res.setHeader(
      "set-cookie",
      `pw_session=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${production ? "; Secure" : ""}`,
    );
  }
  function workspace(s: Session) {
    if (s.purpose !== "workspace") throw new AppError("FORBIDDEN", 403);
  }
  function planAccess(s: Session, id: string) {
    if (
      s.purpose !== "workspace" &&
      !(s.purpose === "review" && s.target === id)
    )
      throw new AppError("FORBIDDEN", 403);
  }
  return createServer(async (req, res) => {
    const rid = randomUUID();
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader(
      "permissions-policy",
      "camera=(), microphone=(self), geolocation=()",
    );
    if (production)
      res.setHeader("strict-transport-security", "max-age=31536000");
    try {
      const url = new URL(req.url || "/", origin),
        path = url.pathname,
        method = req.method || "GET";
      if (method === "GET" && path === "/health") {
        await core.db.query("SELECT 1");
        return json(res, {
          status: "ok",
          financialMode: "sandbox",
          aiConfigured: !!(env.AI_PROVIDER === "meta"
            ? env.MODEL_API_KEY
            : env.GEMINI_API_KEY),
          whatsappConfigured: !!(
            env.WHATSAPP_ACCESS_TOKEN &&
            env.WHATSAPP_APP_SECRET &&
            env.WHATSAPP_PHONE_NUMBER_ID
          ),
        });
      }
      if (method === "GET" && path === "/api/config")
        return json(res, {
          whatsappNumber: /^\d{8,15}$/.test(env.WHATSAPP_PUBLIC_NUMBER || "")
            ? env.WHATSAPP_PUBLIC_NUMBER
            : null,
          financialMode: "sandbox",
        });
      if (path === "/webhooks/whatsapp") {
        if (method === "GET") {
          if (
            !env.WHATSAPP_VERIFY_TOKEN ||
            url.searchParams.get("hub.mode") !== "subscribe" ||
            url.searchParams.get("hub.verify_token") !==
              env.WHATSAPP_VERIFY_TOKEN
          )
            throw new AppError("FORBIDDEN", 403);
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(url.searchParams.get("hub.challenge") || "");
          return;
        }
        if (method !== "POST") throw new AppError("NOT_FOUND", 404);
        const raw = await body(req, 250000);
        if (
          !verifyWhatsApp(
            raw,
            String(req.headers["x-hub-signature-256"] || ""),
            env.WHATSAPP_APP_SECRET || "",
          )
        )
          throw new AppError("FORBIDDEN", 403);
        const payload = JSON.parse(raw.toString());
        for (const entry of payload.entry || []) {
          if (entry.id !== env.WHATSAPP_BUSINESS_ID) continue;
          for (const change of entry.changes || []) {
            const value = change.value;
            if (
              value?.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID
            )
              continue;
            for (const message of value.messages || []) {
              if (
                !/^234\d{10}$/.test(message.from) ||
                !message.id ||
                message.id.length > 200
              )
                continue;
              const owner = await core.userForPhone(message.from),
                id = "wa:" + message.id;
              const text =
                message.type === "text"
                  ? String(message.text?.body || "").slice(0, 2000)
                  : String(message.image?.caption || "").slice(0, 500);
              const media =
                ["audio", "image"].includes(message.type) &&
                /^\d{1,40}$/.test(message[message.type]?.id || "")
                  ? { id: message[message.type].id, type: message.type }
                  : null;
              const selection = message.interactive?.list_reply?.id,
                language =
                  typeof selection === "string" &&
                  /^lang:(en|pcm|yo|ig|ha)$/.test(selection)
                    ? selection.slice(5)
                    : null;
              await core.db.transaction(async (q) => {
                const old = (
                  await q.query("SELECT id FROM events WHERE id=$1", [id])
                ).rows[0];
                if (old) return;
                const inserted = await q.query(
                  "INSERT INTO events VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
                  [id, owner, "inbound", null, stamp()],
                );
                if (!inserted.count) return;
                if (text || media || language)
                  await core.enqueue(q, id, "agent", owner, {
                    sealed: agent.seal({
                      text,
                      channel: "whatsapp",
                      access: text.trim().toLowerCase() === "open account",
                      ...(media ? { media } : {}),
                      ...(language ? { language } : {}),
                    }),
                  });
                else
                  await core.enqueue(q, "out:" + id, "outbox", owner, {
                    sealed: agent.seal({
                      to: message.from,
                      text: "Please send a text request, a voice note or a clear picture of payment details or an Ajo ledger.",
                    }),
                  });
              });
            }
          }
        }
        return json(res, { received: true });
      }
      if (path.startsWith("/api/")) {
        const authenticated =
          path === "/api/exchange" ? null : await session(req);
        const key = authenticated
            ? "owner:" + authenticated.owner
            : "entry:" + (req.socket.remoteAddress || "local"),
          now = Date.now(),
          limit = limits.get(key);
        if (!limit || limit.until < now)
          limits.set(key, { count: 1, until: now + 60000 });
        else if (++limit.count > 240) throw new AppError("REQUEST_LIMIT", 429);
        if (limits.size > 2000)
          for (const [k, v] of limits) if (v.until < now) limits.delete(k);
        if (method === "POST" && req.headers.origin !== origin)
          throw new AppError("FORBIDDEN", 403);
        const data =
          method === "POST"
            ? JSON.parse((await body(req)).toString() || "{}")
            : {};
        if (method === "POST" && path === "/api/exchange") {
          const cap = z
              .object({ token: z.string().min(40).max(60) })
              .strict()
              .parse(data),
            secret = token();
          const s = await core.db.transaction(async (q) => {
            const row = (
              await q.query(
                "SELECT * FROM capabilities WHERE hash=$1" +
                  (core.db.postgres ? " FOR UPDATE" : ""),
                [digest(cap.token)],
              )
            ).rows[0];
            if (!row || row.used || row.expires_at <= stamp())
              throw new AppError("LINK_EXPIRED", 401);
            await q.query("UPDATE capabilities SET used=1 WHERE hash=$1", [
              digest(cap.token),
            ]);
            await q.query("INSERT INTO sessions VALUES($1,$2,$3,$4,$5,$6)", [
              digest(secret),
              row.owner,
              row.purpose,
              row.target,
              row.revision,
              future(1800000),
            ]);
            return row;
          });
          cookie(res, secret);
          return json(res, { purpose: s.purpose, target: s.target });
        }
        const s = authenticated!;
        if (method === "GET" && path === "/api/session")
          return json(res, {
            purpose: s.purpose,
            target: s.target,
            user: await core.getUser(s.owner),
          });
        if (method === "POST" && path === "/api/logout") {
          await core.db.query("DELETE FROM sessions WHERE hash=$1", [
            digest(
              (req.headers.cookie || "")
                .split(";")
                .map((v) => v.trim())
                .find((v) => v.startsWith("pw_session="))!
                .slice(11),
            ),
          ]);
          res.setHeader(
            "set-cookie",
            "pw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return json(res, { ok: true });
        }
        if (method === "POST" && path === "/api/setup") {
          if (s.purpose !== "setup") throw new AppError("FORBIDDEN", 403);
          const input = z
            .object({
              name: z.string().min(2).max(100),
              pin: z.string().regex(/^\d{4}$/),
              confirmation: z.string(),
            })
            .strict()
            .refine((v) => v.pin === v.confirmation)
            .parse(data);
          const opened = await core.setup(s.owner, input.name, input.pin);
          const secret = token();
          await core.db.transaction(async (q) => {
            await q.query(
              "DELETE FROM sessions WHERE owner=$1 AND purpose=$2",
              [s.owner, "setup"],
            );
            await q.query(
              "INSERT INTO sessions VALUES($1,$2,$3,NULL,NULL,$4)",
              [digest(secret), s.owner, "workspace", future(1800000)],
            );
            if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
              const user = opened.user,
                funding = opened.funding;
              await core.enqueue(q, "welcome:" + s.owner, "outbox", s.owner, {
                sealed: agent.seal({
                  to: user.phone,
                  text: `Congratulations, ${user.name.split(" ")[0]}. Your account is ready.\n${funding.bankName}\nAccount: ${funding.accountNumber}\nYour opening test balance is NGN 500,000.\nThese are test details. Do not send real money.\nWhat would you like to do next?`,
                }),
              });
            }
          });
          cookie(res, secret);
          return json(res, await core.workspace(s.owner));
        }
        if (method === "GET" && path === "/api/workspace") {
          workspace(s);
          return json(res, await core.workspace(s.owner));
        }
        if (method === "GET" && path === "/api/statement.pdf") {
          workspace(s);
          const value = await core.statement(
            s.owner,
            z.string().date().parse(url.searchParams.get("start")),
            z.string().date().parse(url.searchParams.get("end")),
          );
          res.writeHead(200, {
            "content-type": "application/pdf",
            "content-disposition":
              'attachment; filename="PayWella-statement.pdf"',
          });
          res.end(await statementPdf(value));
          return;
        }
        if (path === "/api/beneficiaries") {
          workspace(s);
          if (method === "GET")
            return json(res, await core.records(s.owner, "beneficiary"));
          if (method === "POST") {
            const input = z
              .object({
                bankCode: z.string().max(20),
                accountNumber: z.string().regex(/^\d{10}$/),
              })
              .strict()
              .parse(data);
            return json(
              res,
              await core.saveBeneficiary(
                s.owner,
                input.bankCode,
                input.accountNumber,
              ),
              201,
            );
          }
        }
        if (method === "POST" && path === "/api/settings") {
          workspace(s);
          const input = z
            .object({ language: z.enum(["en", "pcm", "yo", "ig", "ha"]) })
            .strict()
            .parse(data);
          await core.db.query("UPDATE users SET language=$1 WHERE id=$2", [
            input.language,
            s.owner,
          ]);
          return json(res, { language: input.language });
        }
        if (method === "POST" && path === "/api/plans") {
          workspace(s);
          const result = await core.prepare(s.owner, data);
          return json(res, { plan: result.plan }, 201);
        }
        const planMatch = path.match(
          /^\/api\/plans\/([a-f0-9-]{36})(?:\/(approve|cancel|edit))?$/,
        );
        if (planMatch) {
          const id = uuid.parse(planMatch[1]);
          planAccess(s, id);
          if (method === "GET" && !planMatch[2])
            return json(res, {
              ...(await core.plan(s.owner, id)),
              catalogue: { banks, products },
            });
          if (method === "POST" && planMatch[2] === "edit") {
            const input = z
              .object({
                revision: z.number().int().positive(),
                tasks: PlanInput.shape.tasks,
              })
              .strict()
              .parse(data);
            if (s.purpose === "review" && s.revision !== input.revision)
              throw new AppError("REVIEW_CHANGED", 409);
            const result = await core.prepare(
              s.owner,
              { tasks: input.tasks },
              null,
              { id, revision: input.revision },
            );
            if (s.purpose === "review") {
              const secret = (req.headers.cookie || "")
                .split(";")
                .map((v) => v.trim())
                .find((v) => v.startsWith("pw_session="))!
                .slice(11);
              await core.db.query(
                "UPDATE sessions SET revision=$1 WHERE hash=$2",
                [result.plan.revision, digest(secret)],
              );
            }
            return json(res, {
              ...result.plan,
              catalogue: { banks, products },
            });
          }
          if (method === "POST" && planMatch[2] === "approve") {
            const input = z
              .object({
                pin: z.string().regex(/^\d{4}$/),
                revision: z.number().int().positive(),
              })
              .strict()
              .parse(data);
            if (s.purpose === "review" && s.revision !== input.revision)
              throw new AppError("REVIEW_CHANGED", 409);
            return json(
              res,
              await core.approve(s.owner, id, input.revision, input.pin),
              202,
            );
          }
          if (method === "POST" && planMatch[2] === "cancel")
            return json(res, await core.cancel(s.owner, id));
        }
        const receiptMatch = path.match(
          /^\/api\/receipts\/([a-f0-9-]{36})(\.(?:pdf|png))?$/,
        );
        const saveRecipient = path.match(
          /^\/api\/receipts\/([a-f0-9-]{36})\/save-recipient$/,
        );
        if (method === "POST" && saveRecipient) {
          const receipt = await core.receipt(
            s.owner,
            uuid.parse(saveRecipient[1]),
          );
          planAccess(s, receipt.planId);
          const input = z
            .object({ alias: z.string().trim().max(60).optional() })
            .strict()
            .parse(data);
          if (!receipt.recipient) throw new AppError("RECIPIENT_NOT_AVAILABLE");
          return json(
            res,
            await core.saveBeneficiary(
              s.owner,
              receipt.recipient.bankCode,
              receipt.recipient.accountNumber,
              input.alias,
            ),
          );
        }
        if (method === "GET" && receiptMatch) {
          const receipt = await core.receipt(
            s.owner,
            uuid.parse(receiptMatch[1]),
          );
          planAccess(s, receipt.planId);
          if (receiptMatch[2] === ".png") {
            res.writeHead(200, { "content-type": "image/png" });
            res.end(receiptImage(receipt));
            return;
          }
          if (receiptMatch[2]) {
            const pdf = await receiptPdf(receipt);
            res.writeHead(200, {
              "content-type": "application/pdf",
              "content-disposition":
                'attachment; filename="PayWella-receipt.pdf"',
            });
            res.end(pdf);
            return;
          }
          return json(res, receipt);
        }
        if (method === "POST" && path === "/api/assistant/reset") {
          workspace(s);
          const pending = (
            await core.db.query(
              "SELECT id FROM jobs WHERE owner=$1 AND kind='agent' AND status IN ('QUEUED','RUNNING')",
              [s.owner],
            )
          ).rows[0];
          if (pending) throw new AppError("ASSISTANT_BUSY", 409);
          await core.db.query(
            "DELETE FROM records WHERE owner=$1 AND kind='conversation'",
            [s.owner],
          );
          return json(res, { cleared: true });
        }
        if (method === "POST" && path === "/api/assistant") {
          workspace(s);
          const input = z
              .object({ text: z.string().trim().min(1).max(2000), requestId })
              .strict()
              .parse(data),
            id = s.owner + ":" + input.requestId;
          await core.enqueue(core.db, id, "agent", s.owner, {
            sealed: agent.seal({ text: input.text, channel: "web" }),
          });
          return json(res, { id }, 202);
        }
        if (method === "GET" && path.startsWith("/api/assistant/")) {
          workspace(s);
          const id =
            s.owner +
            ":" +
            requestId.parse(path.slice("/api/assistant/".length));
          const rows = await core.records(s.owner, "reply"),
            reply = rows.find((r) => r.id === id);
          if (!reply) {
            const job = (
              await core.db.query(
                "SELECT id,created_at FROM jobs WHERE id=$1 AND owner=$2",
                [id, s.owner],
              )
            ).rows[0];
            if (!job) throw new AppError("NOT_FOUND", 404);
            if (job.created_at < future(-86400000))
              throw new AppError("REQUEST_EXPIRED", 410);
          }
          const progress = (await core.records(s.owner, "progress")).find(
            (row) => row.id === id + ":progress",
          );
          return json(
            res,
            reply
              ? agent.open(reply.sealed)
              : {
                  pending: true,
                  ...(progress
                    ? { progress: agent.open(progress.sealed) }
                    : {}),
                },
          );
        }
        if (method === "POST" && path === "/api/ajo/books") {
          workspace(s);
          const input = z
            .object({ name: z.string().min(1).max(60) })
            .strict()
            .parse(data);
          return json(res, await core.createBook(s.owner, input.name), 201);
        }
        if (method === "POST" && path === "/api/ajo/join") {
          workspace(s);
          const input = z
            .object({
              invite: z.string().regex(/^[A-Za-z0-9]{8}$/),
              dailyKobo: z.number().int().min(100),
              maturityDate: z.string().date(),
              startDate: z.string().date().optional(),
            })
            .strict()
            .parse(data);
          return json(
            res,
            await core.joinBook(
              s.owner,
              input.invite,
              input.dailyKobo,
              input.maturityDate,
              input.startDate,
            ),
            201,
          );
        }
        if (method === "POST" && path === "/api/ajo/members") {
          workspace(s);
          const input = z
            .object({
              bookId: uuid,
              name: z.string().min(2).max(100),
              dailyKobo: z.number().int().min(100),
              maturityDate: z.string().date(),
              startDate: z.string().date().optional(),
            })
            .strict()
            .parse(data);
          return json(
            res,
            await core.addMember(s.owner, input.bookId, input),
            201,
          );
        }
        throw new AppError("NOT_FOUND", 404);
      }
      if (method !== "GET") throw new AppError("NOT_FOUND", 404);
      const root = resolve("dist"),
        file = resolve(
          root,
          "." + (path === "/" || path === "/open" ? "/index.html" : path),
        );
      if (!file.startsWith(root + "/")) throw new AppError("NOT_FOUND", 404);
      const content = await readFile(file).catch(() => {
        throw new AppError("NOT_FOUND", 404);
      });
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
      };
      res.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
      });
      res.end(content);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const code =
          error instanceof AppError
            ? error.code
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? "REQUEST_INVALID"
              : "UNAVAILABLE",
        status =
          error instanceof AppError
            ? error.status
            : code === "REQUEST_INVALID"
              ? 400
              : 500;
      json(
        res,
        { error: code, message: errorCopy(code), requestId: rid },
        status,
      );
    }
  });
}
