import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import type { Core } from "./core.ts";
type Statement = Awaited<ReturnType<Core["statement"]>>;
const amount = (kobo: number) =>
  (kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function statementPdf(value: Statement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 38 }),
      parts: Buffer[] = [];
    document.on("data", (part) => parts.push(part));
    document.on("end", () => resolve(Buffer.concat(parts)));
    document.on("error", reject);
    const heading = () => {
      document.rect(0, 0, 595, 842).fill("#FFFAF3");
      document.image(
        fileURLToPath(
          new URL("../web/public/paywella-logo.png", import.meta.url),
        ),
        38,
        27,
        {
          fit: [125, 48],
        },
      );
      document
        .fillColor("#082F27")
        .fontSize(18)
        .text("Naira account statement", 38, 96);
      document
        .fontSize(10)
        .text(value.name, 38, 126)
        .text(value.start + " to " + value.end, 38, 144);
      document
        .fontSize(10)
        .text("Opening balance: NGN " + amount(value.openingKobo), 38, 170)
        .text("Closing balance: NGN " + amount(value.closingKobo), 38, 186);
      document
        .fillColor("#657469")
        .fontSize(8)
        .text(
          "Amounts in NGN. Posted ledger entries only. Pending tasks are excluded.",
          38,
          212,
        );
      document.rect(38, 238, 519, 27).fill("#082F27");
      document.fillColor("#FFFAF3").fontSize(8);
      for (const [label, x] of [
        ["Date / reference", 47],
        ["Details / status", 196],
        ["Debit", 330],
        ["Credit", 404],
        ["Balance", 478],
      ] as const)
        document.text(label, x, 248, { width: 90 });
      document
        .fillColor("#657469")
        .fontSize(8)
        .text(
          "Test environment. This document does not evidence real bank deposits.",
          38,
          793,
          { width: 520 },
        );
    };
    heading();
    let y = 281;
    if (!value.entries.length)
      document
        .fillColor("#082F27")
        .fontSize(10)
        .text("No posted transactions in this period.", 47, y);
    for (const entry of value.entries) {
      document.fontSize(8);
      const descriptionHeight = document.heightOfString(entry.description, {
          width: 123,
        }),
        height = Math.max(70, descriptionHeight + 35);
      if (y + height > 778) {
        document.addPage();
        heading();
        y = 281;
      }
      document
        .fillColor("#082F27")
        .fontSize(8)
        .text(
          new Date(entry.date).toLocaleString("en-NG", {
            timeZone: "Africa/Lagos",
            dateStyle: "short",
            timeStyle: "short",
          }),
          47,
          y,
          { width: 140 },
        );
      document.fontSize(7).text(entry.reference, 47, y + 15, { width: 140 });
      document
        .fontSize(8)
        .text(entry.description, 196, y, { width: 123 })
        .fillColor("#657469")
        .fontSize(7)
        .text(entry.status, 196, y + descriptionHeight + 5, { width: 123 });
      document.fillColor("#082F27").fontSize(8);
      for (const [value, x] of [
        [entry.debitKobo, 330],
        [entry.creditKobo, 404],
        [entry.balanceKobo, 478],
      ] as const)
        document.text(value ? amount(value) : "0.00", x, y, {
          width: 70,
          align: "right",
        });
      document
        .moveTo(38, y + height - 15)
        .lineTo(557, y + height - 15)
        .strokeColor("#DFE5D7")
        .stroke();
      y += height;
    }
    document.end();
  });
}
