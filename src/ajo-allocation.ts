import { AppError } from "./contracts.ts";

const dayMs = 86400000;
export function lagosDate(at = Date.now()) {
  return new Date(at + 3600000).toISOString().slice(0, 10);
}
function day(value: string) {
  const n = Date.parse(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 10) !== value
  )
    throw new AppError("INVALID_AJO_PERIOD");
  return n;
}
export type ContributionTerms = {
  joinedDate: string;
  maturityDate: string;
  dailyKobo: number;
};
export type ContributionAllocation = {
  beforeKobo: number;
  afterKobo: number;
  dailyKobo: number;
  periods: { date: string; amountKobo: number; remainingKobo: number }[];
};
export function contributionCapacity(terms: ContributionTerms) {
  const count = (day(terms.maturityDate) - day(terms.joinedDate)) / dayMs + 1;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 366 ||
    !Number.isSafeInteger(terms.dailyKobo) ||
    terms.dailyKobo < 100 ||
    terms.dailyKobo > 100000000
  )
    throw new AppError("INVALID_AJO_PERIOD");
  return { days: count, amountKobo: count * terms.dailyKobo };
}
export function allocateContribution(
  terms: ContributionTerms,
  beforeKobo: number,
  amountKobo: number,
): ContributionAllocation {
  const capacity = contributionCapacity(terms);
  if (
    !Number.isSafeInteger(beforeKobo) ||
    beforeKobo < 0 ||
    !Number.isSafeInteger(amountKobo) ||
    amountKobo < 1
  )
    throw new AppError("INVALID_MONEY");
  if (beforeKobo + amountKobo > capacity.amountKobo)
    throw new AppError("AJO_CYCLE_EXCEEDED");
  const periods: ContributionAllocation["periods"] = [];
  let total = beforeKobo,
    left = amountKobo;
  while (left > 0) {
    const index = Math.floor(total / terms.dailyKobo),
      unpaid = terms.dailyKobo - (total % terms.dailyKobo),
      paid = Math.min(left, unpaid);
    periods.push({
      date: new Date(day(terms.joinedDate) + index * dayMs)
        .toISOString()
        .slice(0, 10),
      amountKobo: paid,
      remainingKobo: unpaid - paid,
    });
    total += paid;
    left -= paid;
  }
  return { beforeKobo, afterKobo: total, dailyKobo: terms.dailyKobo, periods };
}
export function contributionSummary(terms: ContributionTerms, total: number) {
  const capacity = contributionCapacity(terms);
  if (!Number.isSafeInteger(total) || total < 0 || total > capacity.amountKobo)
    throw new AppError("AJO_RECORD_REVIEW_REQUIRED", 409);
  const paidDays = Math.floor(total / terms.dailyKobo),
    partialKobo = total % terms.dailyKobo;
  return {
    contributedKobo: total,
    remainingKobo: capacity.amountKobo - total,
    paidDays,
    totalDays: capacity.days,
    partialKobo,
    nextDate:
      paidDays < capacity.days
        ? new Date(day(terms.joinedDate) + paidDays * dayMs)
            .toISOString()
            .slice(0, 10)
        : null,
    nextDayRemainingKobo:
      paidDays < capacity.days ? terms.dailyKobo - partialKobo : 0,
  };
}
