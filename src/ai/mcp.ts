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
import type { ToolSpec } from "./model.ts";
const empty = z.object({}).strict();
export async function connectTools(
  core: Core,
  owner: string,
  onPrepared: (value: Awaited<ReturnType<Core["prepare"]>>) => void,
  requestKey: string | null = null,
  onClear: () => void = () => {},
) {
  await core.getUser(owner);
  const registry = [
    {
      name: "get_balance",
      description:
        "Read the authenticated customer’s current available Naira balance. Use before giving any owned balance or affordability figure.",
      schema: empty,
      run: async () => {
        const w = await core.workspace(owner);
        return {
          availableKobo: w.availableKobo,
          display: naira(w.availableKobo),
          source: "sandbox_ledger",
        };
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
        "Read this organizer’s collection books and members, outstanding cash and funded principal. Cash held is not bank money.",
      schema: empty,
      run: async () => {
        const w = await core.workspace(owner);
        return { books: w.books, members: w.members };
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
        ],
        boundary:
          "Financial rails are simulated in this test environment. No crypto, cards, foreign accounts, loans or investments are connected. One PIN authorizes a reviewed plan; speech cannot approve it.",
      }),
    },
    {
      name: "prepare_plan",
      description:
        "Prepare ALL requested tasks together, 1–5, for private review. No execution. Integer kobo: two thousand naira is 200000. Preserve amounts and recipients across clarifications. Ask only genuinely missing details. Never choose a bank from account digits alone.",
      schema: PlanInput,
      run: async (args: unknown) => {
        const value = await core.prepare(owner, args, requestKey);
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
        readOnlyHint: !["prepare_plan", "cancel_plan"].includes(t.name),
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
