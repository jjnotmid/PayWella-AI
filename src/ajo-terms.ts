import { z } from "zod";
import { AppError } from "./contracts.ts";
import { contributionCapacity } from "./ajo-allocation.ts";
import { randomBytes } from "node:crypto";
export const FeePolicy = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("one_day") }).strict(),
  z
    .object({
      kind: z.literal("fixed"),
      amountKobo: z.number().int().min(100).max(100000000),
    })
    .strict(),
]);
export type FeePolicy = z.infer<typeof FeePolicy>;
export const Agreement = z
  .object({
    termsVersion: z.number().int().positive(),
    consent: z.literal(true),
  })
  .strict();
export type Agreement = z.infer<typeof Agreement>;
export function bookRules(value?: string) {
  if (
    value !== undefined &&
    (typeof value !== "string" || !value.trim() || value.length > 500)
  )
    throw new AppError("AJO_RULES_INVALID");
  return (
    value?.trim() ||
    "Each saver chooses their daily contribution and payout date. Recorded cash is not funded principal. Any agreed organizer fee is deducted once from the first payout."
  );
}
export function invitationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(8)]
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
}
export function cycleFee(policy: FeePolicy, dailyKobo: number) {
  return policy.kind === "one_day"
    ? dailyKobo
    : policy.kind === "fixed"
      ? policy.amountKobo
      : 0;
}
export function acceptedTerms(
  book: Record<string, any>,
  input: { dailyKobo: number; maturityDate: string; joinedDate: string },
  agreement: unknown,
) {
  const consent = Agreement.safeParse(agreement);
  if (!consent.success) throw new AppError("AJO_CONSENT_REQUIRED");
  if (!book.termsVersion || consent.data.termsVersion !== book.termsVersion)
    throw new AppError("AJO_TERMS_CHANGED", 409);
  const policy = FeePolicy.parse(book.feePolicy),
    feeKobo = cycleFee(policy, input.dailyKobo);
  if (feeKobo > 99999900) throw new AppError("AJO_FEE_TOO_HIGH");
  if (feeKobo >= contributionCapacity(input).amountKobo)
    throw new AppError("AJO_FEE_EXCEEDS_CYCLE");
  return {
    termsVersion: book.termsVersion,
    rules: book.rules,
    feePolicy: policy,
    agreedFeeKobo: feeKobo,
    consent: true,
  };
}
