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
]);
export async function connectTools(
  core: Core,
  owner: string,
  onPrepared: (value: Awaited<ReturnType<Core["prepare"]>>) => void,
  requestKey: string | null = null,
  onClear: () => void = () => {},
  progress: (value: PreparationProgress) => Promise<void> = async () => {},
) {
  await core.getUser(owner);
  const registry = [
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
      schema: z.object({ name: z.string().trim().min(1).max(60) }).strict(),
      run: (args: any) => core.createBook(owner, args.name),
    },
    {
      name: "join_ajo_book",
      description:
        "Join a book with the customer’s supplied invitation, chosen daily contribution and agreed payout date. Never choose those terms for them. No funds move.",
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
      run: (args: any) =>
        core.joinBook(
          owner,
          args.invite,
          args.dailyKobo,
          args.maturityDate,
          args.startDate,
        ),
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
        })
        .strict(),
      run: (args: any) =>
        core.addMember(owner, args.bookId, {
          name: args.name,
          dailyKobo: args.dailyKobo,
          maturityDate: args.maturityDate,
          startDate: args.startDate,
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
        "Change the saved reply language only when the customer explicitly requests a preference change. Never infer consent for money from this. Supported: English, Pidgin, Yoruba, Igbo, Hausa.",
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
      description: "Explain actual supported PayWella features and boundaries.",
      schema: empty,
      run: async () => ({
        features: [
          "bank transfers",
          "PayWella transfers",
          "savings goals",
          "airtime",
          "data",
          "electricity",
          "individual Ajo records",
          "private review and receipts",
          "voice notes and Snap to Pay",
          "reviewed notebook imports for organizers",
          "PDF statements and saved recipients",
          "reply language preferences",
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
        "Revise one owned unapproved plan when the customer changes its tasks. Include every task they still want. This invalidates the earlier review; it never executes payments.",
      schema: PlanInput.extend({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      }).strict(),
      run: async (args: any) => {
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
        return { id: p.id, status: p.status, tasks: p.tasks };
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
