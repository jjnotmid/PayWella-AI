import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Core } from "../core.ts";
import { PlanInput, AppError, naira } from "../contracts.ts";
import type { PreparationProgress } from "../contracts.ts";
import { available } from "../ledger.ts";
import type { ToolSpec } from "./model.ts";
import { FeePolicy } from "../ajo-terms.ts";
import { cancelSchedule } from "../savings-schedules.ts";
import { errorCopy } from "../copy.ts";
import { assertBankSources } from "./bank-grounding.ts";
import type { BankContext } from "./bank-grounding.ts";
import { productHelp, productTopics } from "./product-help.ts";
const empty = z.object({}).strict();
const readOnlyTools = new Set([
  "get_balance",
  "get_account_details",
  "list_beneficiaries",
  "list_goals",
  "list_services",
  "get_history",
  "get_ajo_books",
  "get_product_help",
  "get_plan_status",
  "get_active_plans",
  "get_statement_summary",
  "check_affordability",
  "get_notification_status",
  "preview_ajo_invitation",
  "list_savings_schedules",
]);
export async function connectTools(
  core: Core,
  owner: string,
  onPrepared: (value: Awaited<ReturnType<Core["prepare"]>>) => void,
  requestKey: string | null = null,
  onClear: () => void = () => {},
  progress: (value: PreparationProgress) => Promise<void> = async () => {},
  onMembershipProposal: (id: string) => void = () => {},
  bankContext?: BankContext,
) {
  await core.getUser(owner);
  let transferClarificationRequired: string | null = null;
  async function guardBanks(tasks: any[]) {
    if (!bankContext) return;
    if (transferClarificationRequired)
      throw new AppError(transferClarificationRequired);
    try {
      await assertBankSources(core, owner, tasks, bankContext);
    } catch (error) {
      if (
        error instanceof AppError &&
        [
          "BANK_CONFIRMATION_REQUIRED",
          "ACCOUNT_CONFIRMATION_REQUIRED",
        ].includes(error.code)
      )
        transferClarificationRequired = error.code;
      throw error;
    }
  }
  const registry = [
    {
      name: "list_savings_schedules",
      description:
        "Read this owner's recurring savings instructions, their next date, approved amount, end date and recent settled or skipped runs. A skipped run never creates debt or catches up later without approval.",
      schema: empty,
      run: async () => ({
        schedules: await core.records(owner, "savings_schedule"),
        recentRuns: (await core.records(owner, "savings_run"))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20),
      }),
    },
    {
      name: "cancel_savings_schedule",
      description:
        "Stop future runs of one owned recurring savings instruction when explicitly requested. Does not withdraw savings or reverse completed transfers. Changed amounts or dates need a new goal_schedule proposal and private PIN approval, with replacesId set.",
      schema: z.object({ id: z.string().uuid() }).strict(),
      run: (args: any) => cancelSchedule(core, owner, args.id),
    },
    {
      name: "check_affordability",
      description:
        "Calculate whether this customer's currently available spending balance covers a supplied purchase price while keeping an explicitly requested cash buffer. Prices and buffer are integer kobo. Ask for an unknown price; do not guess one. This excludes held funds and separate savings, moves no money and is not a payment quote.",
      schema: z
        .object({
          priceKobo: z.number().int().min(100).max(100000000),
          keepAvailableKobo: z.number().int().min(0).max(100000000).default(0),
        })
        .strict(),
      run: async (args: { priceKobo: number; keepAvailableKobo: number }) => {
        const availableKobo = await core.db.transaction((q) =>
          available(q, "wallet:" + owner),
        );
        const requiredKobo = args.priceKobo + args.keepAvailableKobo;
        return {
          availableKobo,
          priceKobo: args.priceKobo,
          keepAvailableKobo: args.keepAvailableKobo,
          canAfford: availableKobo >= requiredKobo,
          remainingAfterPurchaseKobo: availableKobo - args.priceKobo,
          shortfallKobo: Math.max(0, requiredKobo - availableKobo),
          source: "sandbox_ledger",
          fundsReserved: false,
          paymentAuthorized: false,
        };
      },
    },
    {
      name: "get_notification_status",
      description:
        "Check the owner's WhatsApp reply or receipt notification status. A submitted notification is not proof of delivery, and delivery failure is not payment failure. Optionally inspect one owned receipt. Do not retry a financial task because its notification is unconfirmed; the receipt stays in private activity.",
      schema: z.object({ receiptId: z.string().uuid().optional() }).strict(),
      run: async (args: { receiptId?: string }) => {
        const receipt = args.receiptId
          ? await core.receipt(owner, args.receiptId)
          : null;
        const jobs = await core.db.query(
          "SELECT id,kind,status,created_at FROM jobs WHERE owner=$1 AND kind IN ('receipt','outbox')" +
            (receipt ? " AND id IN ($2,$3)" : "") +
            " ORDER BY created_at DESC LIMIT 10",
          receipt
            ? [
                owner,
                "receipt:" + receipt.taskId,
                "incoming-receipt:" + receipt.taskId,
              ]
            : [owner],
        );
        const jobField = core.db.postgres
          ? "data::jsonb->>'jobId'"
          : "json_extract(data,'$.jobId')";
        const deliveries = jobs.rows.length
          ? (
              await core.db.query(
                "SELECT data FROM records WHERE owner=$1 AND kind='whatsapp_delivery' AND " +
                  jobField +
                  " IN (" +
                  jobs.rows.map((_job, index) => "$" + (index + 2)).join(",") +
                  ")",
                [owner, ...jobs.rows.map((job) => job.id)],
              )
            ).rows.map((row) => JSON.parse(row.data))
          : [];
        return {
          ...(receipt
            ? {
                receiptId: receipt.id,
                paymentStatus: receipt.status,
                privateReceiptAvailable: true,
              }
            : {}),
          notifications: jobs.rows.map((job) => ({
            type: job.kind === "receipt" ? "receipt" : "reply",
            processingStatus: job.status,
            deliveryStatus:
              deliveries.find((row) => row.jobId === job.id)?.status ||
              "unconfirmed",
            createdAt: job.created_at,
          })),
          notice:
            "Only delivered or read confirms handset delivery. A failed or unconfirmed notification does not reverse or repeat a payment.",
        };
      },
    },
    {
      name: "get_balance",
      description:
        "Read the authenticated customer’s current available Naira balance. Use before giving any owned balance or affordability figure.",
      schema: empty,
      run: async () => {
        const availableKobo = await core.db.transaction((q) =>
          available(q, "wallet:" + owner),
        );
        return {
          availableKobo,
          display: naira(availableKobo),
          source: "sandbox_ledger",
        };
      },
    },
    {
      name: "get_account_details",
      description:
        "Read this customer’s sandbox funding details. These are test identifiers, not a live bank account. Never invent a funding amount.",
      schema: empty,
      run: () => core.fundingDetails(owner),
    },
    {
      name: "list_beneficiaries",
      description:
        "Read the owner’s saved bank recipients. Use only an unambiguous match; ask if several match.",
      schema: empty,
      run: async () => ({
        beneficiaries: await core.records(owner, "beneficiary"),
      }),
    },
    {
      name: "save_beneficiary",
      description:
        "Save an explicitly requested bank recipient for this owner after name enquiry. This does not transfer money.",
      schema: z
        .object({
          bankCode: z.string().max(20),
          accountNumber: z.string().regex(/^\d{10}$/),
          alias: z.string().trim().min(1).max(60).optional(),
        })
        .strict(),
      run: (args: any) =>
        core.saveBeneficiary(
          owner,
          args.bankCode,
          args.accountNumber,
          args.alias,
        ),
    },
    {
      name: "create_ajo_book",
      description:
        "Create an explicitly requested individual thrift collection book. Only an approved organizer can use this. No money moves.",
      schema: z
        .object({
          name: z.string().trim().min(1).max(60),
          feePolicy: FeePolicy,
          rules: z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
      run: (args: any) => core.createBook(owner, args.name, args),
    },
    {
      name: "preview_ajo_invitation",
      description:
        "Read an invitation's organizer name, daily-thrift rules, expiry and cycle fee before proposing membership. This never exposes other savers or joins the book.",
      schema: z
        .object({ invite: z.string().regex(/^[A-Za-z0-9]{8}$/) })
        .strict(),
      run: (args: any) => core.previewInvitation(owner, args.invite),
    },
    {
      name: "change_ajo_invitation",
      description:
        "Revoke or replace an invitation for an owned collection book only when explicitly requested. Existing member agreements and funds stay intact.",
      schema: z
        .object({
          bookId: z.string().uuid(),
          action: z.enum(["rotate", "revoke"]),
        })
        .strict(),
      run: (args: any) =>
        core.changeInvitation(owner, args.bookId, args.action),
    },
    {
      name: "join_ajo_book",
      description:
        "Prepare a private membership agreement using the supplied invitation, chosen daily amount and payout date. This does NOT join or accept fees: the customer must review and accept privately. Finish membership before preparing a new member contribution. Never choose their terms.",
      schema: z
        .object({
          invite: z.string().regex(/^[A-Za-z0-9]{8}$/),
          dailyKobo: z.number().int().min(100).max(100000000),
          maturityDate: z.string().date(),
          startDate: z
            .string()
            .date()
            .optional()
            .describe(
              "Agreed first contribution date. Omit for today; ask for the actual start when importing an existing book.",
            ),
        })
        .strict(),
      run: async (args: any) => {
        const proposal = await core.proposeMembership(owner, args);
        onMembershipProposal(proposal.id);
        return {
          proposalId: proposal.id,
          privateAgreementRequired: true,
          book: proposal.book,
          membershipCreated: false,
        };
      },
    },
    {
      name: "add_ajo_member",
      description:
        "An approved organizer can add a cash member to an owned book, with the supplied name, individual daily contribution and agreed payout date. This records no collections and creates no funded balance.",
      schema: z
        .object({
          bookId: z.string().uuid(),
          name: z.string().min(2).max(100),
          dailyKobo: z.number().int().min(100).max(100000000),
          maturityDate: z.string().date(),
          startDate: z.string().date().optional(),
          consentConfirmed: z
            .literal(true)
            .describe(
              "Only true after the organizer explicitly confirms this represented saver accepted the rules and fee. Never infer or invent consent.",
            ),
        })
        .strict(),
      run: (args: any) =>
        core.addMember(owner, args.bookId, {
          name: args.name,
          dailyKobo: args.dailyKobo,
          maturityDate: args.maturityDate,
          startDate: args.startDate,
          consentConfirmed: args.consentConfirmed,
        }),
    },
    {
      name: "get_statement_summary",
      description:
        "Read this owner’s posted NGN statement for a customer-requested date range. Pending payments are not posted. The downloadable PDF is in the private web activity page.",
      schema: z
        .object({ start: z.string().date(), end: z.string().date() })
        .strict(),
      run: (args: any) => core.statement(owner, args.start, args.end),
    },
    {
      name: "set_language",
      description:
        "Remember the language of a clearly spoken or written current message, or an explicit language request, so replies and private review buttons code-switch together. Do this before preparing a plan when the language changed. Keep the prior language for bare numbers and unclear fragments. Do not announce automatic switches. This never authorizes money. English en, Pidgin pcm, Yoruba yo, Igbo ig, Hausa ha.",
      schema: z
        .object({ language: z.enum(["en", "pcm", "yo", "ig", "ha"]) })
        .strict(),
      run: async (args: any) => {
        await core.db.query("UPDATE users SET language=$1 WHERE id=$2", [
          args.language,
          owner,
        ]);
        return { language: args.language };
      },
    },
    {
      name: "list_goals",
      description:
        "Read owned savings goals. Use their exact IDs to prepare deposits and withdrawals. Named funded creation uses goal_create.",
      schema: empty,
      run: async () => ({ goals: (await core.workspace(owner)).goals }),
    },
    {
      name: "list_services",
      description:
        "Read currently supported banks and service products, prices and identifier rules. Do not invent a plan or bank.",
      schema: empty,
      run: async () => {
        const w = await core.workspace(owner);
        return { banks: w.banks, products: w.products };
      },
    },
    {
      name: "get_history",
      description:
        "Read the owner’s last ten confirmed receipts. A draft is never a completed payment.",
      schema: empty,
      run: async () => ({
        receipts: (await core.workspace(owner)).receipts.slice(0, 10),
      }),
    },
    {
      name: "get_ajo_books",
      description:
        "Read owned collection books and memberships, daily contribution rates, covered days, partial-day shortfalls, remaining cycle contributions, outstanding cash and funded principal. Cash held is not bank money.",
      schema: empty,
      run: async () => {
        const w = await core.workspace(owner);
        return { books: w.books, members: w.members, imports: w.imports };
      },
    },
    {
      name: "get_product_help",
      description:
        "Read the actual PayWella product guide, supported steps and boundaries. Use for feature questions and troubleshooting rather than guessing or forcing a menu.",
      schema: z
        .object({
          topic: z.enum(productTopics as [string, ...string[]]).optional(),
        })
        .strict(),
      run: async (args: { topic?: keyof typeof productHelp }) => ({
        guide: args.topic ? productHelp[args.topic] : productHelp,
        features: [
          "bank transfers",
          "PayWella transfers",
          "savings goals",
          "privately approved daily or weekly savings schedules",
          "airtime",
          "data",
          "electricity",
          "individual Ajo records",
          "private review and receipts",
          "voice notes and Snap to Pay",
          "reviewed notebook imports for organizers",
          "PDF statements and saved recipients",
          "reply language preferences",
          "available-balance affordability checks",
          "receipt delivery checks",
        ],
        boundary:
          "Financial rails are simulated in this test environment. No crypto, cards, foreign accounts, loans or investments are connected. One PIN authorizes a reviewed plan; speech cannot approve it.",
        channels: {
          whatsappText: true,
          whatsappVoiceNotes: true,
          whatsappPictures: true,
          whatsappLiveCalling: false,
          privateWebApproval: true,
        },
      }),
    },
    {
      name: "prepare_plan",
      description:
        "Prepare ALL requested tasks together, 1–5, for private review. No execution. Integer kobo: two thousand naira is 200000. Preserve amounts and recipients across clarifications. Ask only genuinely missing details. Never choose a bank from account digits alone.",
      schema: PlanInput,
      run: async (args: unknown) => {
        await guardBanks(PlanInput.parse(args).tasks);
        const value = await core.prepare(
          owner,
          args,
          requestKey,
          undefined,
          progress,
        );
        onPrepared(value);
        return {
          status: "AWAITING_APPROVAL",
          planId: value.plan.id,
          tasks: value.plan.spec.map((t) => ({
            label: t.label,
            amountKobo: t.amountKobo,
            feeKobo: t.feeKobo,
          })),
          paymentAuthorized: false,
        };
      },
    },
    {
      name: "revise_plan",
      description:
        "Revise one owned unapproved plan when the customer changes its tasks. Include every task they still want. Pass the CURRENT revision from currentPlan or get_plan_status, never increment it yourself. The server creates the next revision. This invalidates the earlier review; it never executes payments.",
      schema: PlanInput.extend({
        id: z.string().uuid(),
        revision: z
          .number()
          .int()
          .positive()
          .describe(
            "The existing current revision being replaced. Do not add one.",
          ),
      }).strict(),
      run: async (args: any) => {
        await guardBanks(args.tasks);
        const value = await core.prepare(owner, { tasks: args.tasks }, null, {
          id: args.id,
          revision: args.revision,
        });
        onPrepared(value);
        return {
          status: "AWAITING_APPROVAL",
          planId: value.plan.id,
          revision: value.plan.revision,
          tasks: value.plan.spec.map((task) => ({
            label: task.label,
            destination: task.destination,
            amountKobo: task.amountKobo,
            feeKobo: task.feeKobo,
          })),
          paymentAuthorized: false,
        };
      },
    },
    {
      name: "get_active_plans",
      description:
        "Read this owner’s active or recent plan IDs and authoritative statuses. Use to inspect or cancel the current request without guessing an ID.",
      schema: empty,
      run: async () => ({ plans: (await core.workspace(owner)).plans }),
    },
    {
      name: "clear_unfinished_request",
      description:
        "Use when the customer cancels an unfinished conversation with no prepared plan. Clears earlier recipient and amount context. A prepared plan must be cancelled with cancel_plan instead.",
      schema: empty,
      run: async () => {
        onClear();
        return { status: "CLEARED", paymentAuthorized: false };
      },
    },
    {
      name: "get_plan_status",
      description:
        "Read one owned plan and its actual task statuses. Never infer completion from preparation.",
      schema: z.object({ id: z.string().uuid() }).strict(),
      run: async (args: any) => {
        const p = await core.plan(owner, args.id);
        return {
          id: p.id,
          revision: p.revision,
          status: p.status,
          tasks: p.tasks,
        };
      },
    },
    {
      name: "cancel_plan",
      description:
        "Cancel one owned unapproved plan. Cannot reverse submitted or completed payments.",
      schema: z.object({ id: z.string().uuid() }).strict(),
      run: async (args: any) => ({ plan: await core.cancel(owner, args.id) }),
    },
  ];
  const server = new Server(
    { name: "paywella-ai", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const specs: ToolSpec[] = registry.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown>,
  }));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: specs.map((t) => ({
      ...t,
      inputSchema: { ...t.inputSchema, type: "object" },
      annotations: {
        readOnlyHint: readOnlyTools.has(t.name),
        destructiveHint: false,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const tool = registry.find((t) => t.name === request.params.name);
      if (!tool) throw new AppError("TOOL_NOT_ALLOWED");
      const args = tool.schema.parse(request.params.arguments || {}),
        value = await tool.run(args);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error:
                error instanceof AppError
                  ? error.code
                  : error instanceof z.ZodError
                    ? "INVALID_TOOL_ARGUMENTS"
                    : "TOOL_FAILED",
              ...(error instanceof AppError
                ? { message: errorCopy(error.code) }
                : {}),
              ...(error instanceof z.ZodError
                ? {
                    fields: error.issues.slice(0, 8).map((issue) => ({
                      path: issue.path.join("."),
                      code: issue.code,
                    })),
                  }
                : {}),
            }),
          },
        ],
      };
    }
  });
  const [left, right] = InMemoryTransport.createLinkedPair(),
    client = new Client({ name: "paywella-agent", version: "0.1.0" });
  await Promise.all([server.connect(left), client.connect(right)]);
  return {
    specs,
    getClarification: () => transferClarificationRequired,
    readOnlyTools: readOnlyTools as ReadonlySet<string>,
    client,
    async call(name: string, args: unknown) {
      const result = await client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });
      const content = result.content as { type: string; text?: string }[];
      return JSON.parse(content.find((c) => c.type === "text")?.text || "{}");
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
