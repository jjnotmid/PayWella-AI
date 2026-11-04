import { AppError } from "../contracts.ts";
import type { Task } from "../contracts.ts";
import type { Core } from "../core.ts";
import { banks } from "../providers/sandbox.ts";

export type BankContext = { customerMessages: string[]; reviewedTasks: Task[] };
const spokenDigits: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
export function suppliedAccounts(messages: string[]) {
  const result = new Set<string>();
  for (const message of messages) {
    const numeric = message
      .toLowerCase()
      .replace(
        /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g,
        (word) => spokenDigits[word],
      );
    for (const group of numeric.match(/\d(?:[\d \t,-]*\d)?/g) || []) {
      const digits = group.replace(/\D/g, "");
      if (digits.length === 10) result.add(digits);
    }
  }
  return result;
}
const normalized = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const includesWords = (text: string, phrase: string) =>
  (" " + normalized(text) + " ").includes(" " + normalized(phrase) + " ");
const aliases: Record<string, string[]> = {
  opay: ["opay", "op pay", "op"],
  wema: ["wema", "wema bank"],
  gtbank: ["gtbank", "gtb", "gt bank", "guaranty trust"],
  moniepoint: ["moniepoint", "monie point"],
  firstbank: ["firstbank", "first bank"],
  access: ["access bank", "bank access"],
  uba: ["uba", "united bank for africa"],
  palmpay: ["palmpay", "palm pay"],
};

export function bankMentioned(code: string, messages: string[]) {
  return messages.some(
    (message) =>
      (aliases[code] || [code]).some((alias) =>
        includesWords(message, alias),
      ) ||
      (code === "access" && normalized(message) === "access"),
  );
}

export async function assertBankSources(
  core: Core,
  owner: string,
  tasks: Task[],
  context: BankContext,
) {
  const transfers = tasks.filter(
    (task): task is Extract<Task, { kind: "bank_transfer" }> =>
      task.kind === "bank_transfer",
  );
  if (!transfers.length) return;
  const saved = await core.records(owner, "beneficiary");
  const accounts = suppliedAccounts(context.customerMessages);
  for (const task of transfers) {
    const supplied = task.bankCode.trim().toLowerCase();
    const bank = banks.find(
      (bank) =>
        bank.code.toLowerCase() === supplied ||
        bank.name.toLowerCase() === supplied,
    );
    if (!bank) throw new AppError("INVALID_RECIPIENT");
    const reviewed = context.reviewedTasks.some(
      (previous) =>
        previous.kind === "bank_transfer" &&
        previous.bankCode === bank.code &&
        previous.accountNumber === task.accountNumber,
    );
    const namedBeneficiary = saved.find(
      (row) =>
        row.accountNumber === task.accountNumber &&
        row.bankCode === bank.code &&
        row.alias &&
        context.customerMessages.some((message) =>
          includesWords(message, row.alias),
        ),
    );
    if (!accounts.has(task.accountNumber) && !reviewed && !namedBeneficiary)
      throw new AppError("ACCOUNT_CONFIRMATION_REQUIRED");
    if (bankMentioned(bank.code, context.customerMessages)) continue;
    if (reviewed || namedBeneficiary) continue;
    const matches = saved.filter(
      (row) => row.accountNumber === task.accountNumber,
    );
    const beneficiary = matches.find((row) => row.bankCode === bank.code);
    if (
      beneficiary &&
      context.customerMessages.some(
        (message) =>
          (beneficiary.alias && includesWords(message, beneficiary.alias)) ||
          (matches.length === 1 && accounts.has(task.accountNumber)),
      )
    )
      continue;
    throw new AppError("BANK_CONFIRMATION_REQUIRED");
  }
}
