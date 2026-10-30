import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { naira, AppError } from "./contracts.ts";
import type { Row } from "./db.ts";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const assets = fileURLToPath(new URL("../web/public/", import.meta.url));
const logo = readFileSync(resolve(assets, "paywella-logo.png")).toString(
  "base64",
);
const fonts = [
  "Manrope-Regular.ttf",
  "Manrope-Semibold.ttf",
  "NotoSans-Regular.ttf",
].map((file) => resolve(assets, "fonts", file));
function wrap(value: unknown, limit: number) {
  const words = String(value ?? "")
      .split(/\s+/)
      .flatMap(
        (word) => word.match(new RegExp(".{1," + limit + "}", "gu")) || [],
      ),
    lines: string[] = [];
  for (const word of words) {
    if (!lines.length || lines.at(-1)!.length + word.length + 1 > limit)
      lines.push(word);
    else lines[lines.length - 1] += " " + word;
  }
  return lines;
}
export function receiptImage(source: Row) {
  const receipt = source.savingsSchedule
    ? {
        ...source,
        amountKobo: source.savingsSchedule.amountKobo,
        label: "Recurring instruction: no one-off debit",
      }
    : source;
  if (receipt.status !== "SETTLED")
    throw new AppError("RECEIPT_NOT_READY", 409);
  const destination = wrap(receipt.destination || receipt.label, 47),
    date =
      new Date(receipt.createdAt).toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " WAT";
  const text = (
    value: unknown,
    x: number,
    y: number,
    size = 28,
    weight = 400,
    fill = "#082F27",
    anchor = "start",
  ) =>
    `<text x="${x}" y="${y}" font-family="${String(value).includes("₦") ? "Noto Sans" : "Manrope"}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escape(value)}</text>`;
  const coverage = receipt.allocation?.periods as
    | { date: string; remainingKobo: number }[]
    | undefined;
  const destinationBottom = 625 + (destination.length - 1) * 46,
    noteTitleY = destinationBottom + 62,
    noteValueY = noteTitleY + 45,
    noteEndY = coverage?.at(-1)?.remainingKobo ? noteValueY + 38 : noteValueY;
  const extra = receipt.electricityToken
    ? text("Electricity token", 85, noteTitleY, 22, 400, "#657469") +
      text(
        String(receipt.electricityToken).replace(/(.{4})(?=.)/g, "$1 "),
        85,
        noteValueY,
        30,
        600,
      )
    : coverage?.length
      ? text("Contribution dates", 85, noteTitleY, 22, 400, "#657469") +
        text(
          coverage[0].date +
            (coverage.length > 1 ? " to " + coverage.at(-1)!.date : ""),
          85,
          noteValueY,
          27,
          600,
        ) +
        (coverage.at(-1)!.remainingKobo
          ? text(
              naira(coverage.at(-1)!.remainingKobo) +
                " still due for " +
                coverage.at(-1)!.date,
              85,
              noteEndY,
              23,
              400,
              "#657469",
            )
          : "")
      : receipt.grossAmountKobo !== undefined
        ? text(
            "Principal before organizer fee",
            85,
            noteTitleY,
            22,
            400,
            "#657469",
          ) + text(naira(receipt.grossAmountKobo), 85, noteValueY, 30, 600)
        : receipt.savingsSchedule
          ? text(
              `${receipt.savingsSchedule.frequency} at 09:00 WAT`,
              85,
              noteTitleY,
              23,
              600,
            ) +
            text(
              receipt.savingsSchedule.startDate +
                " to " +
                receipt.savingsSchedule.endDate,
              85,
              noteValueY,
              26,
              600,
            )
          : "";
  const detailsY = Math.max(790, (extra ? noteEndY : destinationBottom) + 36),
    height = detailsY + 710;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}"><rect width="1080" height="${height}" fill="#082F27"/><rect x="36" y="36" width="1008" height="${height - 72}" rx="42" fill="#FFFAF3"/><image href="data:image/png;base64,${logo}" x="85" y="75" width="285" height="100"/><g font-family="Manrope">${text(receipt.kind === "ajo_cash" ? "COLLECTION RECORD" : "PAYMENT RECORD", 995, 130, 19, 600, "#657469", "end")}<path d="M88 225H992" stroke="#DFE5D7"/><circle cx="110" cy="290" r="23" fill="#DCEA9B"/><path d="m98 290 9 9 16-19" fill="none" stroke="#082F27" stroke-width="3"/>${text(receipt.kind === "ajo_cash" ? "Cash recorded successfully" : "Successfully completed", 151, 300, 25, 600)}${text("Amount", 85, 390, 25, 400, "#657469")}${text(naira(receipt.amountKobo), 85, 485, 76, 600)}${text(receipt.label, 85, 570, 27, 600)}${destination
    .map((line, i) => text(line, 85, 625 + i * 46, 30, 600))
    .join(
      "",
    )}${extra}<path d="M85 ${detailsY}H995" stroke="#DFE5D7"/>${text("Date and time", 85, detailsY + 55, 24, 400, "#657469")}${text(date, 85, detailsY + 106, 29, 600)}${text("Fee", 85, detailsY + 200, 25, 400, "#657469")}${text(naira(receipt.feeKobo), 995, detailsY + 200, 29, 600, "#082F27", "end")}<path d="M85 ${detailsY + 250}H995" stroke="#DFE5D7" stroke-dasharray="10 12"/>${text("Reference", 85, detailsY + 310, 24, 400, "#657469")}${wrap(
    receipt.reference,
    49,
  )
    .map((line, i) => text(line, 85, detailsY + 362 + i * 40, 26, 600))
    .join(
      "",
    )}<path d="M85 ${detailsY + 485}H995" stroke="#DFE5D7"/>${text("Thank you for using PayWella", 540, detailsY + 550, 27, 600, "#082F27", "middle")}${text("Test environment. No real bank payment was sent.", 540, detailsY + 605, 20, 400, "#657469", "middle")}</g></svg>`;
  return Buffer.from(
    new Resvg(svg, {
      font: {
        fontFiles: fonts,
        loadSystemFonts: false,
        defaultFontFamily: "Manrope",
      },
    })
      .render()
      .asPng(),
  );
}
