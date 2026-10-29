import { z } from "zod";
import type { ContributionAllocation } from "./ajo-allocation.ts";
export class AppError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}
export const money = z.number().int().min(100).max(100_000_000);
export const Language = z.enum(["en", "pcm", "yo", "ig", "ha"]);
export type Language = z.infer<typeof Language>;
export const Task = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bank_transfer"),
      amountKobo: money,
      bankCode: z.string().max(20),
      accountNumber: z.string().regex(/^\d{10}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("p2p"),
      amountKobo: money,
      recipientPhone: z.string().regex(/^234\d{10}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal_create"),
      name: z.string().trim().min(1).max(60),
      amountKobo: z.number().int().min(0).max(100_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal_deposit"),
      goalId: z.string().uuid(),
      amountKobo: money,
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal_withdraw"),
      goalId: z.string().uuid(),
      amountKobo: money,
    })
    .strict(),
  z
    .object({
      kind: z.literal("service"),
      productId: z.string().max(60),
      customer: z.string().min(6).max(30),
      amountKobo: money,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ajo_contribute"),
      memberId: z.string().uuid(),
      amountKobo: money,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ajo_cash"),
      memberId: z.string().uuid(),
      amountKobo: money,
      date: z.string().date(),
      sourceRow: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ajo_replace"),
      memberId: z.string().uuid(),
      amountKobo: money,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ajo_payout"),
      memberId: z.string().uuid(),
      amountKobo: money,
    })
    .strict(),
]);
export type Task = z.infer<typeof Task>;
export const PlanInput = z
  .object({ tasks: z.array(Task).min(1).max(5) })
  .strict();
export type QuotedTask = {
  id: string;
  input: Task;
  label: string;
  destination?: string;
  source: string | null;
  target: string | null;
  amountKobo: number;
  feeKobo: number;
  feeTarget?: string;
  cycleFeeBeforeKobo?: number;
  goalId?: string;
  dependsOn: number[];
  allocation?: ContributionAllocation;
  recipient?: {
    name: string;
    bankName: string;
    bankCode: string;
    accountNumber: string;
  };
};
export type PreparationProgress = {
  stage: "listening" | "reading" | "understanding" | "checking" | "ready";
  detail?: string;
  taskCount?: number;
  tasks?: { label: string; status: "checking" | "ready" }[];
};
export type Plan = {
  id: string;
  owner: string;
  revision: number;
  status: string;
  spec: QuotedTask[];
  digest: string;
  expiresAt: string;
  createdAt: string;
  tasks: TaskResult[];
};
export type TaskResult = {
  id: string;
  status: string;
  receipt?: string;
  error?: string;
};
export const naira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    amount / 100,
  );
export function safeInteger(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new AppError("INVALID_MONEY");
  return n;
}
