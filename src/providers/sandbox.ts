import { createHash } from "node:crypto";
import { AppError } from "../contracts.ts";
import type { Store } from "../db.ts";
export const banks = [
  { code: "wema", name: "Wema Bank" },
  { code: "opay", name: "OPay" },
  { code: "moniepoint", name: "Moniepoint" },
  { code: "gtbank", name: "GTBank" },
  { code: "access", name: "Access Bank" },
  { code: "firstbank", name: "First Bank" },
  { code: "uba", name: "UBA" },
  { code: "palmpay", name: "PalmPay" },
];
export const products = [
  {
    id: "mtn-airtime",
    name: "MTN airtime",
    category: "airtime",
    min: 10000,
    max: 5000000,
  },
  {
    id: "airtel-airtime",
    name: "Airtel airtime",
    category: "airtime",
    min: 10000,
    max: 5000000,
  },
  {
    id: "glo-airtime",
    name: "Glo airtime",
    category: "airtime",
    min: 10000,
    max: 5000000,
  },
  {
    id: "t2-airtime",
    name: "T2 airtime",
    category: "airtime",
    min: 10000,
    max: 5000000,
  },
  {
    id: "mtn-data-1",
    name: "MTN data bundle",
    category: "data",
    min: 100000,
    max: 100000,
  },
  {
    id: "ikeja-prepaid",
    name: "Ikeja Electric prepaid",
    category: "electricity",
    min: 100000,
    max: 50000000,
  },
  {
    id: "eko-prepaid",
    name: "Eko Electric prepaid",
    category: "electricity",
    min: 100000,
    max: 50000000,
  },
];
export type Outcome = {
  status: "settled" | "pending" | "failed";
  code?: string;
  token?: string;
};
export interface Rail {
  enquire(bank: string, number: string): Promise<string>;
  submit(reference: string, kind: string): Promise<Outcome>;
  lookup(reference: string): Promise<Outcome>;
}
export class SandboxRail implements Rail {
  db?: Store;
  constructor(db?: Store) {
    this.db = db;
  }
  outcomes = new Map<string, Outcome>();
  submissions = new Set<string>();
  async enquire(bank: string, number: string) {
    if (!banks.some((b) => b.code === bank) || !/^\d{10}$/.test(number))
      throw new AppError("INVALID_RECIPIENT");
    const n = createHash("sha256")
      .update(bank + number)
      .digest()[0];
    return ["Ada Okafor", "Tunde Adeyemi", "Amina Bello", "Chidi Nwosu"][n % 4];
  }
  async submit(reference: string, kind: string) {
    this.submissions.add(reference);
    if (!this.outcomes.has(reference)) {
      const known = this.db
        ? (
            await this.db.query(
              "SELECT data FROM records WHERE id=$1 AND kind='sandbox_operation'",
              ["rail:" + reference],
            )
          ).rows[0]
        : null;
      this.outcomes.set(
        reference,
        known
          ? JSON.parse(known.data)
          : {
              status: "settled",
              ...(kind === "service"
                ? {
                    token: Array.from(
                      createHash("sha256")
                        .update(reference)
                        .digest()
                        .subarray(0, 20),
                    )
                      .map((n) => n % 10)
                      .join(""),
                  }
                : {}),
            },
      );
    }
    const outcome = this.outcomes.get(reference)!;
    if (this.db)
      await this.db.query(
        "INSERT INTO records(id,kind,owner,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
        [
          "rail:" + reference,
          "sandbox_operation",
          "system",
          JSON.stringify(outcome),
        ],
      );
    return outcome;
  }
  async lookup(reference: string): Promise<Outcome> {
    if (this.outcomes.has(reference)) return this.outcomes.get(reference)!;
    const known = this.db
      ? (
          await this.db.query(
            "SELECT data FROM records WHERE id=$1 AND kind='sandbox_operation'",
            ["rail:" + reference],
          )
        ).rows[0]
      : null;
    return known ? JSON.parse(known.data) : { status: "pending" };
  }
}
